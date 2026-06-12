// SPDX-License-Identifier: AGPL-3.0-or-later
//
// NanoGPT client: model verification, structured call, retry + tiered fallback,
// and chain-of-thought suppression (plan §10). NanoGPT is OpenAI-compatible, so we
// drive it with the official `openai` SDK pointed at its base URL — but with three
// load-bearing deviations the SDK types don't express:
//
//   * `reasoning: { exclude: true }` is a NanoGPT extension, not a typed OpenAI
//     param, so it goes through a localized cast (no `any`).
//   * structured output comes back as a JSON *string* (sometimes already an
//     object on fallback models) and `strict` is advisory — Zod is the real gate.
//   * none of the requested model IDs are guaranteed to exist, so we verify against
//     GET /models at startup and degrade to a known-good default.
//
// The network surface is isolated behind `ChatTransport` so the retry/fallback
// logic is unit-testable with a fake transport and zero network I/O.

import OpenAI from "openai";
import type { Logger } from "./logger";
import type { ChatMessage } from "./prompt";
import { REVIEW_JSON_SCHEMA, type Review, reviewSchema } from "./schema";

/** Token usage echoed back for cost/observability logging. */
export interface TokenUsage {
  readonly prompt: number;
  readonly completion: number;
  readonly total: number;
}

export interface CompletionRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
}

export interface CompletionResult {
  /** Raw assistant content: a JSON string, or an already-parsed object. */
  readonly content: unknown;
  readonly usage?: TokenUsage;
}

/** Error carrying an HTTP-ish status so the retry layer can classify it. */
export interface StatusError {
  readonly status?: number;
  readonly headers?: Record<string, string> | Headers;
}

/** Network seam: the real impl wraps the OpenAI SDK; tests inject a fake. */
export interface ChatTransport {
  listModelIds(): Promise<string[]>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

/** Fatal: invalid key (401) or insufficient balance (402). Maps to exit 1. */
export class NanoGptAuthError extends Error {
  override readonly name = "NanoGptAuthError";
}

/** All models exhausted without a valid structured response. Maps to exit 3. */
export class NanoGptExhaustedError extends Error {
  override readonly name = "NanoGptExhaustedError";
}

export interface NanoGptOptions {
  readonly transport: ChatTransport;
  readonly logger: Logger;
  /** Max transient retries per model before moving on. */
  readonly maxRetries?: number;
  /** Backoff base in ms (1s default; overridable for fast tests). */
  readonly backoffBaseMs?: number;
  /** Sleep hook, overridable in tests to avoid real timers. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const FATAL_AUTH = new Set([401, 402]);

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as StatusError).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function retryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("headers" in error)) {
    return undefined;
  }
  const headers = (error as StatusError).headers;
  if (!headers) {
    return undefined;
  }
  const raw = headers instanceof Headers ? headers.get("retry-after") : headers["retry-after"];
  if (!raw) {
    return undefined;
  }
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

function isContextLengthError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    const message = (error as { message?: unknown }).message;
    if (code === "context_length_exceeded") {
      return true;
    }
    if (typeof message === "string" && /context length|maximum context|too long/i.test(message)) {
      return true;
    }
  }
  return false;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Strip chain-of-thought, then parse content (string or object) into JSON. */
function parseContent(content: unknown): unknown {
  if (typeof content === "string") {
    const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    return JSON.parse(cleaned);
  }
  return content;
}

/**
 * Parse + schema-validate a response. Returns null on ANY failure (malformed
 * JSON or wrong shape) so both route through the single re-ask / fallback path.
 */
function tryParseReview(content: unknown): Review | null {
  try {
    const parsed = reviewSchema.safeParse(parseContent(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Verify the configured model priority list against GET /models for observability,
 * then return the FULL tiered list unchanged. The tiered list is authoritative:
 * verification only logs which models are unconfirmed (e.g. a future rename) — it
 * never drops a model or substitutes a different one. A model that is genuinely
 * uncallable is handled at request time by per-model runtime fallback (§10). If
 * the /models endpoint itself fails, we log and proceed with the full list.
 */
export async function resolveModels(
  transport: ChatTransport,
  priority: readonly string[],
  logger: Logger,
): Promise<string[]> {
  const models = [...priority];
  try {
    const available = new Set(await transport.listModelIds());
    const unconfirmed = models.filter((model) => !available.has(model));
    if (unconfirmed.length > 0) {
      logger.warn("some configured models are not listed by /models; trying them anyway", {
        unconfirmed,
      });
    }
    logger.info("model priority", { models });
  } catch (error) {
    logger.warn("models endpoint failed; proceeding with configured list", {
      error: String(error),
    });
  }
  return models;
}

/**
 * Request a review, walking the model priority list. Per model: retry transient
 * errors with backoff (honoring Retry-After), one re-ask on invalid structured
 * output, then fall back to the next model. Fail fast on auth errors.
 */
export async function requestReview(
  models: readonly string[],
  messages: readonly ChatMessage[],
  options: NanoGptOptions,
): Promise<{ review: Review; model: string }> {
  const { transport, logger } = options;
  const maxRetries = options.maxRetries ?? 3;
  const backoffBase = options.backoffBaseMs ?? 1000;
  const sleep = options.sleep ?? defaultSleep;

  for (const model of models) {
    let reAsked = false;

    for (let attempt = 0; ; attempt++) {
      try {
        const result = await transport.complete({ model, messages });
        if (result.usage) {
          logger.info("nanogpt usage", { model, ...result.usage });
        }
        const parsed = tryParseReview(result.content);
        if (parsed) {
          logger.info("review accepted", { model });
          return { review: parsed, model };
        }
        // Invalid structured output: one re-ask on this model, then next model.
        if (!reAsked) {
          reAsked = true;
          logger.warn("invalid structured output; re-asking once", { model });
          continue;
        }
        logger.warn("invalid structured output after re-ask; next model", { model });
        break;
      } catch (error) {
        const status = statusOf(error);
        if (status !== undefined && FATAL_AUTH.has(status)) {
          throw new NanoGptAuthError(`NanoGPT auth/balance error (status ${status})`);
        }
        if (isContextLengthError(error)) {
          logger.warn("context-length exceeded; next model", { model });
          break;
        }
        if (status !== undefined && RETRYABLE.has(status) && attempt < maxRetries) {
          const wait = retryAfterMs(error) ?? backoffBase * 2 ** attempt + Math.floor(attempt * 50);
          logger.warn("transient error; retrying", { model, status, attempt, waitMs: wait });
          await sleep(wait);
          continue;
        }
        logger.warn("model failed; next model", { model, status, error: String(error) });
        break;
      }
    }
  }

  throw new NanoGptExhaustedError("all NanoGPT models failed to produce a valid review");
}

/** Build the real OpenAI-SDK-backed transport pointed at NanoGPT. */
export function createOpenAiTransport(apiKey: string, timeoutMs = 90_000): ChatTransport {
  const client = new OpenAI({
    apiKey,
    baseURL: "https://nano-gpt.com/api/v1",
    timeout: timeoutMs,
  });

  return {
    async listModelIds(): Promise<string[]> {
      const page = await client.models.list();
      return page.data.map((model) => model.id);
    },
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      // The SDK type omits `reasoning`; build the body untyped and cast once so
      // the NanoGPT extension reaches the wire without `any`.
      const body = {
        model: req.model,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        response_format: REVIEW_JSON_SCHEMA,
        reasoning: { exclude: true },
        temperature: 0,
        stream: false,
      };
      const completion = await client.chat.completions.create(
        body as unknown as Parameters<typeof client.chat.completions.create>[0],
      );
      const choice = (completion as OpenAI.Chat.Completions.ChatCompletion).choices[0];
      const usageRaw = (completion as OpenAI.Chat.Completions.ChatCompletion).usage;
      const usage: TokenUsage | undefined = usageRaw
        ? {
            prompt: usageRaw.prompt_tokens,
            completion: usageRaw.completion_tokens,
            total: usageRaw.total_tokens,
          }
        : undefined;
      const content = choice?.message.content ?? "";
      return usage ? { content, usage } : { content };
    },
  };
}
