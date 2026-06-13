// SPDX-License-Identifier: AGPL-3.0-or-later
//
// nanogpt-direct.ts — the documented degradation path (plan Option C / A′, §6.4,
// §15.2). Feature-flagged via REVIEW_BACKEND=nanogpt-direct. If Goose's
// tool-calling proves unreliable for the chosen models (an M0 risk), this calls
// NanoGPT's OpenAI-compatible /chat/completions directly with strict
// `response_format: json_schema`, bypassing Goose's final_output tool entirely.
//
// The deterministic validator (lib/schema.ts) — not this path's own strict mode
// — remains the authority, so flipping the backend changes only HOW the JSON is
// produced, not what is allowed to post. fetch is injected so the HTTP contract
// is unit-tested without a live key. Reasoning is kept in `message.reasoning`,
// separate from the structured `message.content`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const STRICT_SCHEMA_PATH = join(
  here,
  "..",
  "..",
  "..",
  "schema",
  "review-output.strict.schema.json",
);

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface NanoGptDeps {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export type DirectResult =
  | { ok: true; output: unknown; reasoning: string | null }
  | { ok: false; reason: string };

/** Load the generated strict schema variant (fully-required, nullable optionals). */
export function loadStrictSchema(): object {
  return JSON.parse(readFileSync(STRICT_SCHEMA_PATH, "utf8")) as object;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null; reasoning?: string | null } }>;
}

/**
 * Call NanoGPT's OpenAI-compatible chat-completions with strict JSON-schema
 * structured output. Returns the parsed (but not yet schema-validated) object,
 * or a typed failure the caller maps to a fallback.
 */
export async function callNanoGptDirect(
  messages: readonly ChatMessage[],
  deps: NanoGptDeps,
): Promise<DirectResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = deps.baseUrl ?? "https://nano-gpt.com/api/v1";
  const body = {
    model: deps.model,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: { name: "review_output", strict: true, schema: loadStrictSchema() },
    },
  };

  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${deps.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, reason: `network_error: ${err instanceof Error ? err.message : err}` };
  }

  if (!res.ok) return { ok: false, reason: `http_${res.status}` };

  let json: ChatResponse;
  try {
    json = (await res.json()) as ChatResponse;
  } catch {
    return { ok: false, reason: "response_not_json" };
  }

  const message = json.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    return { ok: false, reason: "empty_content" };
  }

  let output: unknown;
  try {
    output = JSON.parse(content);
  } catch {
    return { ok: false, reason: "content_not_json" };
  }
  return { ok: true, output, reasoning: message?.reasoning ?? null };
}
