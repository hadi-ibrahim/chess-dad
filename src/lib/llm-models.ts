import "server-only";
import { config } from "./config";
import { providerMeta, type LlmConnection, type ModelOption } from "./llm-providers";

/**
 * Ask a provider what models the caller's key can actually reach.
 *
 * This is a convenience for the Profiles screen, not part of analysis: a static
 * suggestion list goes stale the moment a provider ships something new, and a
 * `<datalist>` is a poor way to show a long list anyway. Each provider exposes a
 * "list models" endpoint, and the four wire kinds each answer differently, so the
 * parsing lives here next to the request shaping the analysis path already uses.
 *
 * Like the AI call, the key arrives in the request body, is used for this one
 * outbound call, and is never stored or logged.
 */

/** A ceiling on what is sent to the browser; some providers return hundreds. */
const MAX_MODELS = 300;

function redact(value: string, secret: string): string {
  if (!secret) return value;
  return value.split(secret).join("[redacted]");
}

async function getJson(
  url: string,
  init: RequestInit,
  secret: string,
  label: string
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    const err = e as Error;
    const message =
      err.name === "TimeoutError"
        ? `${label} did not answer within ${Math.round(config.llmTimeoutMs / 1000)}s.`
        : `${label} could not be reached: ${redact(err.message, secret)}`;
    throw new Error(message);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      // A body we cannot read is not worth a second failure.
    }
    throw new Error(
      `${label} API error ${res.status}${detail ? `: ${redact(detail, secret)}` : ""}`
    );
  }
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new Error(`${label} returned a response that was not JSON.`);
  }
}

/** Drop blanks and duplicates, cap the list, and sort it so it stays scannable. */
function tidy(options: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  const out: ModelOption[] = [];
  for (const option of options) {
    const id = option.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: option.label?.trim() || undefined });
    if (out.length >= MAX_MODELS) break;
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function listProviderModels(connection: LlmConnection): Promise<ModelOption[]> {
  const meta = providerMeta(connection.provider);
  if (!meta) throw new Error("Unknown provider.");

  const base = (connection.baseUrl || meta.defaultBaseUrl || "").replace(/\/+$/, "");
  const signal = AbortSignal.timeout(config.llmTimeoutMs);

  switch (meta.kind) {
    case "openai": {
      // OpenAI, DeepSeek and every OpenAI-compatible endpoint: `{ data: [{ id }] }`.
      const data = (await getJson(
        `${base}/models`,
        {
          method: "GET",
          headers: {
            ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}),
          },
          signal,
        },
        connection.apiKey,
        meta.label
      )) as { data?: { id?: string }[] };
      return tidy((data.data ?? []).map((m) => ({ id: String(m.id ?? "") })));
    }

    case "anthropic": {
      const data = (await getJson(
        `${base}/models?limit=100`,
        {
          method: "GET",
          headers: {
            "x-api-key": connection.apiKey,
            "anthropic-version": "2023-06-01",
          },
          signal,
        },
        connection.apiKey,
        meta.label
      )) as { data?: { id?: string; display_name?: string }[] };
      return tidy(
        (data.data ?? []).map((m) => ({ id: String(m.id ?? ""), label: m.display_name }))
      );
    }

    case "google": {
      const data = (await getJson(
        `${base}/models?pageSize=200`,
        { method: "GET", headers: { "x-goog-api-key": connection.apiKey }, signal },
        connection.apiKey,
        meta.label
      )) as {
        models?: {
          name?: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
          supportedActions?: string[];
        }[];
      };
      return tidy(
        (data.models ?? [])
          // The catalogue also carries embedding, image and TTS models, which
          // cannot answer a chat request. Keep only what can generate content.
          .filter((m) => {
            const methods = m.supportedGenerationMethods ?? m.supportedActions;
            if (!methods) return true;
            return methods.some((method) => /generate_?content/i.test(method));
          })
          .map((m) => ({
            id: String(m.name ?? "").replace(/^models\//, ""),
            label: m.displayName,
          }))
      );
    }

    case "ollama": {
      const data = (await getJson(
        `${base}/api/tags`,
        { method: "GET", headers: {}, signal },
        "",
        meta.label
      )) as { models?: { name?: string; model?: string }[] };
      return tidy((data.models ?? []).map((m) => ({ id: String(m.name ?? m.model ?? "") })));
    }
  }
}
