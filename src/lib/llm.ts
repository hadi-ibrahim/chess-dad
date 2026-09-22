import "server-only";
import { config } from "./config";
import { getLlmCache, setLlmCache } from "./db";
import { readCoachingRules } from "./okf";
import type { LLMExplanation } from "./types";

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
- Output strict JSON with exactly three string fields: "explanation", "key_lesson", "drill_suggestion".`;

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

async function deepseekExplain(i: ExplainInput): Promise<LLMExplanation> {
  const url = `${config.deepseekBaseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      messages: [
        { role: "system", content: SYSTEM(i.rating) },
        { role: "user", content: buildUserPrompt(i) },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(config.llmTimeoutMs),
  });
  if (!res.ok) {
    throw new Error(`DeepSeek API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  return parseExplanation(content);
}

async function ollamaExplain(i: ExplainInput): Promise<LLMExplanation> {
  const url = `${config.ollamaBaseUrl}/api/chat`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollamaModel,
      messages: [
        { role: "system", content: SYSTEM(i.rating) },
        { role: "user", content: buildUserPrompt(i) },
      ],
      format: "json",
      stream: false,
    }),
    signal: AbortSignal.timeout(config.llmTimeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return parseExplanation(data.message?.content ?? "{}");
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

function fmtCp(cp: number): string {
  const pawns = (cp / 100).toFixed(2);
  const sign = cp >= 0 ? "+" : "";
  return `${sign}${pawns}`;
}

/**
 * Deterministic, offline coaching fallback grounded in the OKF knowledge base.
 * Always available; keeps explanations working with no API key.
 */
function fallbackExplain(i: ExplainInput): LLMExplanation {
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
            : "chose a suboptimal move";

  const bestPhrase = i.bestSan
    ? `The engine preferred ${i.bestSan} instead of ${i.playedSan || "your move"}.`
    : "";
  const evalPhrase =
    `This changed the evaluation from ${fmtCp(i.evalBeforeCp)} to ${fmtCp(i.evalAfterCp)}` +
    ` (a ${lostPawns}-pawn swing).`;

  const motifPhrase = i.motif
    ? ` The pattern involved a ${i.motif.replace(/-/g, " ")}.`
    : "";

  const rule = rules[cls];
  const keyLesson =
    rule?.lesson?.trim() ||
    (i.motif
      ? `Before moving, check whether your move leaves a piece undefended or misses a ${i.motif.replace(/-/g, " ")}.`
      : "Before moving, look for your opponent's threats and your own forcing moves.");

  const drillSuggestion =
    rule?.drill?.trim() ||
    (i.motif
      ? `Solve 10 ${i.motif.replace(/-/g, " ")} puzzles, then replay this position and find ${i.bestSan || "the best move"}.`
      : `Replay this position and try to find ${i.bestSan || "the best move"} on your own before checking the engine.`);

  return {
    explanation: `On your move you ${verb}. ${bestPhrase} ${evalPhrase}${motifPhrase}`.replace(/\s+/g, " ").trim(),
    key_lesson: keyLesson,
    drill_suggestion: drillSuggestion,
  };
}

export async function explainPosition(i: ExplainInput): Promise<LLMExplanation> {
  const cached = getLlmCache(i.fen);
  if (cached) return cached;

  let result: LLMExplanation;
  try {
    if (config.llmProvider === "deepseek" && config.deepseekApiKey) {
      result = await deepseekExplain(i);
    } else if (config.llmProvider === "ollama") {
      result = await ollamaExplain(i);
    } else {
      result = fallbackExplain(i);
    }
  } catch {
    // Any LLM failure degrades gracefully to the deterministic coach.
    result = fallbackExplain(i);
  }

  setLlmCache(i.fen, result.explanation, result.key_lesson, result.drill_suggestion, config.llmProvider);
  return result;
}
