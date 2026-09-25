import "server-only";
import { Chess } from "chess.js";
import { config } from "./config";
import { getAiExplanation, setAiExplanation } from "./db";
import { readCoachingRules } from "./okf";
import { log } from "./log";
import {
  providerMeta,
  type AiExplanationKey,
  type LlmConnection,
} from "./llm-providers";
import type { LLMExplanation } from "./types";

/**
 * Two coaches, one rule.
 *
 * 1. **The engine coach is the baseline.** `fallbackExplain` is deterministic,
 *    offline and free. It is what every initial analysis writes into
 *    `positions.explanation`, so a library is fully explained with no API key in
 *    sight.
 * 2. **AI is an extra reading, on request.** `aiExplainPosition` calls a provider
 *    the *user* configured with the key that lives in *their* browser. It never
 *    replaces the engine text; it is stored beside it, so the same position can
 *    carry Claude's reading and GPT's at once.
 *
 * The invariant is unchanged in both: the engine is ground truth and the model
 * only explains it. Generated text that names an impossible move is discarded
 * before it can be cached or shown.
 */

/**
 * Token accounting.
 *
 * The only part of the app that costs money per use. Every provider call logs its
 * token counts and a running total, so "what did that cost?" has an answer.
 */
export interface LlmUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const usageGlobal = globalThis as unknown as { __chessdadLlmUsage?: LlmUsage };

/** Cumulative token usage for this process. */
export function llmUsage(): LlmUsage {
  usageGlobal.__chessdadLlmUsage ??= {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  return usageGlobal.__chessdadLlmUsage;
}

interface TokenCounts {
  prompt?: number;
  completion?: number;
  total?: number;
}

function recordUsage(provider: string, model: string, tokens: TokenCounts): void {
  const usage = llmUsage();
  const promptTokens = tokens.prompt ?? 0;
  const completionTokens = tokens.completion ?? 0;
  const totalTokens = tokens.total ?? promptTokens + completionTokens;

  usage.calls += 1;
  usage.promptTokens += promptTokens;
  usage.completionTokens += completionTokens;
  usage.totalTokens += totalTokens;

  log.info("llm: call", {
    provider,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    cumulativeCalls: usage.calls,
    cumulativeTokens: usage.totalTokens,
  });
}

export interface ExplainInput {
  fen: string;
  playedSan: string;
  bestSan: string;
  evalBeforeCp: number; // mover's perspective
  evalAfterCp: number; // mover's perspective
  classification: string;
  motif: string | null;
  openingName: string;
  rating: number;
}

const SYSTEM = (rating: number) => `You are a patient, level-calibrated chess coach. Ground every claim in the engine data you are given and never contradict the engine's evaluation or best move — the engine is ground truth.

Rules:
- Explain the human idea ("why"), not just parrot the move.
- Use plain language suitable for a player rated about ${rating} (lichess/chess.com rating).
- 2-3 sentences, conversational, never condescending.
- Output strict JSON with exactly three string fields: "explanation", "key_lesson", "drill_suggestion".

Accuracy about the board, in priority order:
- You may only name a move that is legal in the position you were given. Before naming a
  capture, a check, or a threat, satisfy yourself that the move is legal there. A wrong
  square or a piece that cannot reach it is worse than saying nothing.
- If you are not certain a specific move is legal, describe the idea without naming the
  move ("the rook was undefended and could be taken"). Never invent a tactic.
- Prefer the moves you were given (the move played and the engine's choice) over moves you
  infer. They are the only ones you can rely on.
- Do not claim a line continues in a particular way unless you can see it is forced.`;

function buildUserPrompt(i: ExplainInput): string {
  return [
    `Position (FEN): ${i.fen}`,
    `Player's move: ${i.playedSan || "(none)"}`,
    `Engine's best move: ${i.bestSan}`,
    `Evaluation before the move (player's perspective, centipawns): ${i.evalBeforeCp}`,
    `Evaluation after the move (player's perspective, centipawns): ${i.evalAfterCp}`,
    `Move classification: ${i.classification}`,
    `Tactical motif (if any): ${i.motif ?? "none"}`,
    `Opening: ${i.openingName || "unknown"}`,
    ``,
    `Explain why the player's move was ${i.classification}, what idea they missed, and suggest one concrete drill.`,
  ].join("\n");
}

/**
 * Moves named in generated text that cannot actually be played.
 *
 * The app's stated principle is that the model explains engine output and cannot
 * hallucinate chess facts. It can. Measured over 25 freshly generated
 * explanations, **3 of the 21 that named a move contained an illegal one** (~14%),
 * and every failure had the same shape — a "they can simply take it" claim where
 * the capturing piece could not reach the square:
 *
 *   * "White's knight on e2 can simply take it with Nxd5" — no knight on e2, and
 *     the only knight (c3) cannot capture on an empty d5;
 *   * "trades queens — after Qxb3 axb3" — e5 to b3 is not a queen move;
 *   * "take your queen with Nxc2 or Nxd3" — from c4 neither is a knight move.
 *
 * A wrong tactic stated confidently is worse than a plainer true sentence, so an
 * explanation that fails this check is discarded.
 *
 * Deliberately conservative, to avoid discarding good explanations:
 *   * only unambiguous MOVE tokens are judged, so a bare square reference
 *     ("your queen on b5") is not mistaken for a named move — this under-reports;
 *   * a move is accepted if it is legal in the given position, or after the played
 *     move, or after the engine's move, so legitimate continuations pass.
 */
const MOVE_TOKEN =
  /\b(?:O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?)\b/g;

export function illegalMovesNamed(
  text: string,
  fen: string,
  playedSan: string,
  bestSan: string
): string[] {
  const named = [...new Set(text.match(MOVE_TOKEN) ?? [])];
  if (named.length === 0) return [];

  const legal = new Set<string>();
  let parsed = false;
  const collect = (position: string) => {
    try {
      for (const m of new Chess(position).moves({ verbose: true })) legal.add(m.san);
      parsed = true;
    } catch {
      // A position that will not parse cannot reject anything.
    }
  };

  collect(fen);
  // If the position itself is unreadable there is no basis to judge, so judge
  // nothing rather than rejecting every move the text happens to name.
  if (!parsed) return [];

  for (const move of [playedSan, bestSan]) {
    if (!move) continue;
    try {
      const after = new Chess(fen);
      after.move(move);
      collect(after.fen());
    } catch {
      // The caller's move may be unplayable in isolation; the base position stands.
    }
  }

  return named.filter((token) => !legal.has(token));
}

function parseExplanation(content: string): LLMExplanation {
  try {
    const obj = JSON.parse(content) as Partial<LLMExplanation>;
    return {
      explanation: String(obj.explanation ?? "").trim() || "No explanation available.",
      key_lesson: String(obj.key_lesson ?? "").trim(),
      drill_suggestion: String(obj.drill_suggestion ?? "").trim(),
    };
  } catch {
    return {
      explanation: content.trim().slice(0, 600) || "No explanation available.",
      key_lesson: "",
      drill_suggestion: "",
    };
  }
}

const MATE_CP = 10_000; // the engine's mate scores are stored as +/-100000 cp

function fmtCp(cp: number): string {
  if (Math.abs(cp) >= MATE_CP) return cp > 0 ? "a forced mate" : "a forced mate against you";
  const pawns = (cp / 100).toFixed(2);
  const sign = cp >= 0 ? "+" : "";
  return `${sign}${pawns}`;
}

/**
 * Motif tags are detector keys, not English: they need a noun phrase before they
 * can sit in a sentence. "The pattern involved a tactical." was the old output.
 */
const MOTIF_PHRASES: Record<string, string> = {
  "hung-piece": "a hung piece",
  "missed-capture": "a missed capture",
  "missed-mate": "a missed mate",
  tactical: "a tactical opportunity",
};

/** Motif-specific lessons, used only when the OKF rule has no lesson text. */
const MOTIF_LESSONS: Record<string, string> = {
  "hung-piece": "Check whether your move leaves a piece where it can simply be taken.",
  "missed-capture": "Scan every capture before you commit: material was available here.",
  "missed-mate": "With the king exposed, calculate forcing moves first — checks, captures, threats.",
  tactical: "Look for your opponent's forcing reply before you commit to a plan.",
};

/** Article-free motif names for drill text ("Solve 10 hung piece puzzles"). */
const MOTIF_TOPICS: Record<string, string> = {
  "hung-piece": "hung piece",
  "missed-capture": "missed capture",
  "missed-mate": "missed mate",
  tactical: "tactical opportunity",
};

/**
 * Deterministic, offline coaching grounded in the OKF knowledge base.
 * Always available; keeps explanations working with no API key.
 *
 * Exported for testing: this text is user-visible on every review screen, and it
 * has shipped nonsense before ("the engine preferred Kh8 instead of Kh8" on a
 * forced move where the player and the engine agreed).
 */
export function fallbackExplain(i: ExplainInput): LLMExplanation {
  const rules = readCoachingRules();
  const lostPawns = Math.max(0, (i.evalBeforeCp - i.evalAfterCp) / 100).toFixed(1);
  const cls = i.classification;

  const verb =
    cls === "blunder"
      ? "blundered"
      : cls === "mistake"
        ? "made a mistake"
        : cls === "miss"
          ? "missed a winning chance"
          : cls === "inaccuracy"
            ? "played an inaccuracy"
            : cls === "forced"
              ? "had only one legal move"
              : cls === "book"
                ? "played a book move"
                : "chose a suboptimal move";

  // Never compare a move to itself: "the engine preferred Kh8 instead of Kh8" was
  // real output, on a forced move where the player and the engine agreed. A
  // *missing* played move is different — the engine's choice is still worth naming.
  const agrees = Boolean(i.playedSan) && i.playedSan === i.bestSan;
  const bestPhrase =
    i.bestSan && !agrees
      ? `The engine preferred ${i.bestSan} instead of ${i.playedSan || "your move"}.`
      : "";

  // Mate scores are sentinels, not evaluations: "+999.98 to +999.98 (a 0.0-pawn
  // swing)" was nonsense that appeared in 242 stored explanations.
  const mateBefore = Math.abs(i.evalBeforeCp) >= MATE_CP;
  const mateAfter = Math.abs(i.evalAfterCp) >= MATE_CP;
  const evalPhrase =
    mateBefore || mateAfter
      ? !mateBefore && mateAfter
        ? "This handed the opponent a forced mate."
        : mateBefore && !mateAfter
          ? "This let a forced mate slip."
          : "A forced mate was already on the board."
      : `This changed the evaluation from ${fmtCp(i.evalBeforeCp)} to ${fmtCp(i.evalAfterCp)}` +
        ` (a ${lostPawns}-pawn swing).`;

  const motifPhrase = i.motif
    ? ` The pattern was ${MOTIF_PHRASES[i.motif] ?? i.motif.replace(/-/g, " ")}.`
    : "";

  // Which way the game was going decides what the lesson should say: "you let an
  // advantage slip" is wrong (and was previously printed) for a player who was
  // already worse.
  const contextPhrase =
    i.evalBeforeCp >= 50
      ? " You had the better position before this move."
      : i.evalBeforeCp <= -50
        ? " You were already worse, so the practical aim was to hold."
        : "";

  const rule = rules[cls];
  const keyLesson =
    rule?.lesson?.trim() ||
    MOTIF_LESSONS[i.motif ?? ""] ||
    "Before moving, look for your opponent's threats and your own forcing moves.";

  const drillSuggestion =
    rule?.drill?.trim() ||
    (i.motif
      ? `Solve 10 ${MOTIF_TOPICS[i.motif] ?? i.motif.replace(/-/g, " ")} puzzles, then replay this position and find ${i.bestSan || "the best move"}.`
      : `Replay this position and try to find ${i.bestSan || "the best move"} on your own before checking the engine.`);

  return {
    explanation: `On your move you ${verb}. ${bestPhrase} ${evalPhrase}${contextPhrase}${motifPhrase}`
      .replace(/\s+/g, " ")
      .trim(),
    key_lesson: keyLesson,
    drill_suggestion: drillSuggestion,
  };
}

// ---------------------------------------------------------------------------
// AI providers
// ---------------------------------------------------------------------------

/**
 * A failure the user can act on.
 *
 * `connection` means the provider could not be used at all (bad key, unreachable,
 * rate-limited), so trying the next position would fail identically and the route
 * stops. `content` means the call worked but the answer was unusable (empty text,
 * an invented move), so the next position is still worth trying.
 */
export class AiRequestError extends Error {
  readonly kind: "connection" | "content";
  constructor(message: string, kind: "connection" | "content" = "connection") {
    super(message);
    this.name = "AiRequestError";
    this.kind = kind;
  }
}

/** Defensive: a provider must never be able to echo a key into an error we show. */
function redact(value: string, secret: string): string {
  if (!secret) return value;
  return value.split(secret).join("[redacted]");
}

/**
 * What a user sees when a call runs out of time.
 *
 * Slow reasoning models are the usual cause, and the fix is a per-connection
 * timeout on the Profiles tab, so the message says that instead of only naming a
 * number of seconds.
 */
function timeoutMessage(label: string, timeoutMs: number): string {
  return (
    `${label} did not finish within ${Math.round(timeoutMs / 1000)}s. ` +
    `Slow reasoning models can need longer — raise the timeout for this provider on the Profiles tab.`
  );
}

interface TokenUsage {
  prompt?: number;
  completion?: number;
  total?: number;
}

interface ProviderReply {
  text: string;
  model: string;
}

async function postJson(
  url: string,
  init: RequestInit,
  secret: string,
  label: string,
  timeoutMs: number
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = e as Error;
    const message =
      err.name === "TimeoutError"
        ? timeoutMessage(label, timeoutMs)
        : `${label} could not be reached: ${redact(err.message, secret)}`;
    throw new AiRequestError(message, "connection");
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      // A body we cannot read is not worth a second failure.
    }
    throw new AiRequestError(
      `${label} API error ${res.status}${detail ? `: ${redact(detail, secret)}` : ""}`,
      "connection"
    );
  }
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new AiRequestError(`${label} returned a response that was not JSON.`, "connection");
  }
}

/**
 * Read a streamed response line by line, handing each line to the provider's
 * parser as it arrives.
 *
 * Streaming is what makes a slow model survivable: without it a long generation
 * is indistinguishable from a dead connection, and an intermediary proxy is free
 * to cut an idle one. The call is still bounded — by the per-connection timeout,
 * which is exactly the knob a user raises for a model that thinks for a while —
 * but nothing is killed merely for taking time.
 *
 * Five providers means four line formats (SSE for OpenAI-kind, Anthropic and
 * Gemini; NDJSON for Ollama), so this only extracts lines; each caller reads the
 * event it expects.
 */
async function streamProviderResponse(
  url: string,
  init: RequestInit,
  secret: string,
  label: string,
  timeoutMs: number,
  onLine: (line: string) => void
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = e as Error;
    const message =
      err.name === "TimeoutError"
        ? timeoutMessage(label, timeoutMs)
        : `${label} could not be reached: ${redact(err.message, secret)}`;
    throw new AiRequestError(message, "connection");
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      // A body we cannot read is not worth a second failure.
    }
    throw new AiRequestError(
      `${label} API error ${res.status}${detail ? `: ${redact(detail, secret)}` : ""}`,
      "connection"
    );
  }
  if (!res.body) throw new AiRequestError(`${label} returned an empty response.`, "connection");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line) onLine(line);
      }
    }
    const tail = (buffer + decoder.decode()).replace(/\r$/, "");
    if (tail) onLine(tail);
  } catch (e) {
    const err = e as Error;
    // Aborting a body read can surface as either name depending on where the
    // signal fired, so both are treated as the timeout they are.
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new AiRequestError(timeoutMessage(label, timeoutMs), "connection");
    }
    throw new AiRequestError(
      `${label} stream ended unexpectedly: ${redact(err.message, secret)}`,
      "connection"
    );
  }
}

/**
 * Models that reject or ignore `temperature`.
 *
 * Reasoning-capable endpoints have treated it as unsupported since OpenAI's
 * o-series, and the current flagships inherit that: the GPT-5/GPT-6 families,
 * Anthropic's adaptive thinking, and DeepSeek's reasoner. Sending it anyway is a
 * 400 on some of them, so it is matched by name rather than assumed. Omitting it
 * only gives up sampling control, which this app never needed.
 */
const REASONING_MODEL = /^(o[1-9]|gpt-5|gpt-6|gpt-chat-latest|deepseek-reasoner)/i;

function isReasoningModel(model: string): boolean {
  return REASONING_MODEL.test(model.trim());
}

/**
 * Send one position to one provider.
 *
 * This is the only place the app fetches a host derived from user input, and it
 * is reached only after `sanitizeConnection()` has validated the URL — see
 * `llm-providers.ts`.
 */
async function callProvider(
  connection: LlmConnection,
  i: ExplainInput,
  timeoutMs: number
): Promise<ProviderReply> {
  const meta = providerMeta(connection.provider);
  if (!meta) throw new AiRequestError("Unknown provider.", "connection");

  const model = (connection.model || meta.defaultModel).trim();
  const system = SYSTEM(i.rating);
  const user = buildUserPrompt(i);
  const base = (connection.baseUrl || meta.defaultBaseUrl || "").replace(/\/+$/, "");

  switch (meta.kind) {
    case "openai": {
      // Reasoning-class models reject or ignore `temperature`, and DeepSeek's
      // thinking mode ignores it too, so it is only sent when it will actually be
      // honoured rather than pretending to control sampling.
      const sendTemperature =
        !isReasoningModel(model) && !(meta.supportsThinkingToggle && connection.thinking);
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(sendTemperature ? { temperature: 0.4 } : {}),
      };
      // DeepSeek turns reasoning ON by default upstream and its length is
      // unbounded: one measured call returned 24,699 reasoning tokens over 119s,
      // billed as output and past any sane timeout. Off unless asked for.
      if (meta.supportsThinkingToggle && !connection.thinking) {
        body.thinking = { type: "disabled" };
      }
      if (meta.supportsJsonMode) body.response_format = { type: "json_object" };

      if (connection.provider === "custom") {
        // A user-supplied endpoint is the one thing we cannot assume supports
        // streaming, so it stays a single request; the known providers stream.
        const data = (await postJson(
          `${base}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}),
            },
            body: JSON.stringify(body),
          },
          connection.apiKey,
          meta.label,
          timeoutMs
        )) as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        recordUsage(meta.id, model, {
          prompt: data.usage?.prompt_tokens,
          completion: data.usage?.completion_tokens,
          total: data.usage?.total_tokens,
        });
        return { text: data.choices?.[0]?.message?.content ?? "", model };
      }

      let text = "";
      let usage: TokenUsage = {};
      await streamProviderResponse(
        `${base}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}),
          },
          body: JSON.stringify({
            ...body,
            stream: true,
            // Asks the provider to close the stream with a usage block; a provider
            // that ignores it simply reports no tokens rather than failing.
            stream_options: { include_usage: true },
          }),
        },
        connection.apiKey,
        meta.label,
        timeoutMs,
        (line) => {
          if (!line.startsWith("data:")) return;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") return;
          let event: {
            choices?: { delta?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
          };
          try {
            event = JSON.parse(payload);
          } catch {
            return;
          }
          const delta = event.choices?.[0]?.delta?.content;
          if (typeof delta === "string") text += delta;
          if (event.usage) {
            usage = {
              prompt: event.usage.prompt_tokens,
              completion: event.usage.completion_tokens,
              total: event.usage.total_tokens,
            };
          }
        }
      );
      recordUsage(meta.id, model, usage);
      return { text, model };
    }

    case "anthropic": {
      let text = "";
      const usage: TokenUsage = {};
      await streamProviderResponse(
        `${base}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": connection.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            // No temperature: Claude 5's adaptive thinking is always on for the
            // flagship models, and thinking rejects a temperature other than 1.
            system,
            messages: [{ role: "user", content: user }],
            stream: true,
          }),
        },
        connection.apiKey,
        meta.label,
        timeoutMs,
        (line) => {
          if (!line.startsWith("data:")) return;
          const payload = line.slice(5).trim();
          if (!payload) return;
          let event: {
            type?: string;
            delta?: { text?: string };
            message?: { usage?: { input_tokens?: number } };
            usage?: { output_tokens?: number };
          };
          try {
            event = JSON.parse(payload);
          } catch {
            return;
          }
          if (event.type === "content_block_delta" && typeof event.delta?.text === "string") {
            text += event.delta.text;
          }
          if (event.type === "message_start") usage.prompt = event.message?.usage?.input_tokens;
          if (event.type === "message_delta") usage.completion = event.usage?.output_tokens;
        }
      );
      recordUsage(meta.id, model, usage);
      return { text: text.trim(), model };
    }

    case "google": {
      let text = "";
      const usage: TokenUsage = {};
      await streamProviderResponse(
        `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          // A header, never `?key=`: a URL is the easiest thing to end up in a log.
          headers: { "Content-Type": "application/json", "x-goog-api-key": connection.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: {
              temperature: 0.4,
              responseMimeType: "application/json",
            },
          }),
        },
        connection.apiKey,
        meta.label,
        timeoutMs,
        (line) => {
          if (!line.startsWith("data:")) return;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") return;
          let event: {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
            usageMetadata?: {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              totalTokenCount?: number;
            };
          };
          try {
            event = JSON.parse(payload);
          } catch {
            return;
          }
          for (const part of event.candidates?.[0]?.content?.parts ?? []) {
            if (typeof part.text === "string") text += part.text;
          }
          const meta2 = event.usageMetadata;
          if (meta2) {
            usage.prompt = meta2.promptTokenCount;
            usage.completion = meta2.candidatesTokenCount;
            usage.total = meta2.totalTokenCount;
          }
        }
      );
      recordUsage(meta.id, model, usage);
      return { text: text.trim(), model };
    }

    case "ollama": {
      let text = "";
      const usage: TokenUsage = {};
      await streamProviderResponse(
        `${base}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            format: "json",
            stream: true,
          }),
        },
        "",
        meta.label,
        timeoutMs,
        (line) => {
          if (!line.trim()) return;
          let event: {
            message?: { content?: string };
            done?: boolean;
            prompt_eval_count?: number;
            eval_count?: number;
          };
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (typeof event.message?.content === "string") text += event.message.content;
          if (event.done) {
            usage.prompt = event.prompt_eval_count;
            usage.completion = event.eval_count;
          }
        }
      );
      recordUsage(meta.id, model, usage);
      return { text: text.trim(), model };
    }
  }
}

export interface AiExplainResult extends LLMExplanation {
  provider: string;
  model: string;
  /** True when this exact provider+model already had an answer for the position. */
  cached: boolean;
}

export interface AiCallOptions {
  /**
   * A ceiling for this one call, on top of the connection's own timeout. The batch
   * route uses it so a long game cannot run past the request's time budget.
   */
  timeoutMs?: number;
}

/**
 * Explain one position with one provider connection.
 *
 * A cache hit for the *same* provider and model is free and returns immediately,
 * which is what makes re-analysing a game cheap. A different model is a different
 * call, and the two answers coexist — that is how a user compares providers.
 */
export async function aiExplainPosition(
  i: ExplainInput,
  connection: LlmConnection,
  key: AiExplanationKey,
  opts: AiCallOptions = {}
): Promise<AiExplainResult> {
  const meta = providerMeta(connection.provider);
  const model = (connection.model || meta?.defaultModel || "").trim();

  // A connection may set its own timeout for a slow model; the batch ceiling only
  // ever lowers it, never raises it.
  const configured = connection.timeoutMs > 0 ? connection.timeoutMs : config.llmTimeoutMs;
  const timeoutMs = Math.max(
    5_000,
    Math.min(configured, opts.timeoutMs ?? Number.POSITIVE_INFINITY)
  );

  const cached = getAiExplanation(key, connection.provider, model);
  if (cached) {
    return {
      explanation: cached.explanation,
      key_lesson: cached.key_lesson,
      drill_suggestion: cached.drill_suggestion,
      provider: cached.provider,
      model: cached.model,
      cached: true,
    };
  }

  const reply = await callProvider(connection, i, timeoutMs);
  const parsed = parseExplanation(reply.text);
  if (!parsed.explanation || parsed.explanation === "No explanation available.") {
    throw new AiRequestError(
      `${meta?.label ?? connection.provider} returned no explanation.`,
      "content"
    );
  }

  // A confidently wrong tactic is worse than a plainer true sentence, and unlike
  // the offline coach there is no second text to fall back to — the engine coach
  // is already on screen. So the answer is refused rather than stored.
  const invented = illegalMovesNamed(parsed.explanation, i.fen, i.playedSan, i.bestSan);
  if (invented.length > 0) {
    log.warn("ai: explanation named moves that are not legal here — discarded", {
      invented,
      fen: i.fen,
      playedSan: i.playedSan,
      bestSan: i.bestSan,
      provider: connection.provider,
      model,
    });
    throw new AiRequestError(
      "The model named moves that are not legal in this position, so its answer was discarded.",
      "content"
    );
  }

  setAiExplanation({
    fen: key.fen,
    played_uci: key.playedUci,
    classification: key.classification,
    rating_band: key.ratingBand,
    provider: connection.provider,
    model,
    explanation: parsed.explanation,
    key_lesson: parsed.key_lesson,
    drill_suggestion: parsed.drill_suggestion,
  });

  return { ...parsed, provider: connection.provider, model, cached: false };
}
