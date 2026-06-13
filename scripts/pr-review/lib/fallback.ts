// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fallback.ts — pure tiered-fallback orchestration (plan §10).
//
// The model proposes; deterministic code disposes. This module owns the
// "try each model once, within a global wall-clock budget, mapping every
// failure mode to the next model" logic — with the Goose runner, the schema
// validator, and the clock all INJECTED so the control flow is unit-tested
// without a live model. Ground truth (model_used, fallback_attempts) is written
// by THIS code, overwriting whatever the model self-reported.
//
// Failure categories (any -> advance): transport/API error, process error,
// no extractable final_output JSON (incl. "model answered in prose, not a tool
// call"), schema-invalid output, and degenerate-empty output. A LEGITIMATE
// empty review (substantive summary OR a non-empty dropped list) is NOT a
// failure — that distinction is the single tested rule that lets the low-noise
// mandate coexist with the ladder.

import type { ReviewOutput, ReviewRaw } from "./types";

/** Outcome of one Goose invocation, as seen by the orchestrator. */
export type RunnerResult =
  | { kind: "transport_error"; detail?: string }
  | { kind: "process_error"; detail?: string }
  | { kind: "completed"; stdout: string };

export type GooseRunner = (model: string, timeoutMs: number) => Promise<RunnerResult>;

export type SchemaValidate = (
  value: unknown,
) => { ok: true; value: ReviewOutput } | { ok: false; errors: string[] };

export interface FallbackDeps {
  models: readonly string[];
  runner: GooseRunner;
  validate: SchemaValidate;
  /** Injected clock (ms). Defaults to Date.now via the wrapper, mocked in tests. */
  now: () => number;
  perAttemptTimeoutMs: number;
  globalBudgetMs: number;
  retriesPerModel: number;
  minSubstantiveSummary: number;
}

/**
 * Extract the final structured object from Goose's stdout. The exact
 * `--output-format json` envelope is not pinned by Goose's docs (an M0 task), so
 * the extractor is deliberately tolerant: it first tries the documented
 * "last line is the final JSON" shape, then falls back to a balanced-brace scan
 * from the end. Returns null when no JSON object is recoverable — which is
 * exactly the "model emitted prose instead of calling final_output" case, mapped
 * by the caller to a fallback, never to a silent empty.
 */
export function extractFinalOutput(stdout: string): unknown {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;

  // 1. Whole output is the JSON object.
  const whole = tryParse(trimmed);
  if (whole !== undefined && typeof whole === "object") return whole;

  // 2. Last non-empty line is the JSON object (Goose docs).
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const parsed = tryParse(line);
    if (parsed !== undefined && typeof parsed === "object") return parsed;
    break; // only the genuinely-last content line qualifies as "the last line"
  }

  // 3. Balanced-brace scan: find the last top-level {...} block.
  const end = trimmed.lastIndexOf("}");
  if (end !== -1) {
    let depth = 0;
    for (let i = end; i >= 0; i -= 1) {
      const ch = trimmed[i];
      if (ch === "}") depth += 1;
      else if (ch === "{") {
        depth -= 1;
        if (depth === 0) {
          const block = tryParse(trimmed.slice(i, end + 1));
          if (block !== undefined && typeof block === "object") return block;
          break;
        }
      }
    }
  }
  return null;
}

/**
 * A run is DEGENERATE (category 4 -> fallback) iff it has no comments, a
 * thin/empty summary, AND an empty dropped list. The model demonstrably did not
 * engage. Anything with a substantive summary OR a non-empty dropped list is a
 * legitimate empty review and is accepted.
 */
export function isDegenerate(output: ReviewOutput, minSummary: number): boolean {
  return (
    output.comments.length === 0 &&
    output.summary.trim().length < minSummary &&
    output.dropped_or_uncertain_findings.length === 0
  );
}

/**
 * Run the tiered fallback. Returns ReviewRaw with ground-truth model_used /
 * fallback_attempts. Never throws for a model failure — only genuinely
 * unexpected runner exceptions propagate.
 */
export async function runFallback(deps: FallbackDeps): Promise<ReviewRaw> {
  const deadline = deps.now() + deps.globalBudgetMs;

  for (let i = 0; i < deps.models.length; i += 1) {
    const model = deps.models[i];
    if (model === undefined) continue;

    for (let attempt = 0; attempt <= deps.retriesPerModel; attempt += 1) {
      // Global budget guard: stop if we can't fit another full attempt.
      if (deps.now() + deps.perAttemptTimeoutMs > deadline) {
        return { ok: false, reason: "budget_exhausted", model_used: null, fallback_attempts: i };
      }

      const res = await deps.runner(model, deps.perAttemptTimeoutMs);
      if (res.kind === "transport_error" || res.kind === "process_error") continue; // cat 1/2

      const extracted = extractFinalOutput(res.stdout);
      if (extracted === null) continue; // cat 4: prose, not a final_output tool call

      const validation = deps.validate(extracted);
      if (!validation.ok) continue; // cat 3: schema-invalid

      if (isDegenerate(validation.value, deps.minSubstantiveSummary)) continue; // cat 4

      const output: ReviewOutput = {
        ...validation.value,
        model_used: model, // CODE is the source of truth, overwriting self-report.
        fallback_attempts: i, // models that failed before this success.
      };
      return { ok: true, output, model_used: model, fallback_attempts: i };
    }
  }

  return {
    ok: false,
    reason: "all_models_failed",
    model_used: null,
    fallback_attempts: deps.models.length,
  };
}
