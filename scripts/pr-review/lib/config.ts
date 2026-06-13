// SPDX-License-Identifier: AGPL-3.0-or-later
//
// config.ts — single source of tunable knobs for the PR reviewer (plan §9, §10).
//
// Every value is overridable via environment variable so operators can tune
// noise/cost without code edits (plan: "config-driven so order/membership can
// change without code edits"). Defaults match the maintainer decisions recorded
// in the plan: 3-tier :thinking ladder, medium+ severity gate, MAX_COMMENTS 25
// runaway backstop (schema ceiling 50), 240s per-attempt, 15-min global budget,
// empty-review = post the note.

import type { Severity } from "./types";

const num = (name: string, fallback: number): number => {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (name: string, fallback: string): string => {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? fallback : v;
};

/** Hidden HTML marker appended to every body we post, so we recognise our own. */
export const BOT_MARKER = "<!-- docrewind-pr-reviewer -->";

export const BOT_LOGIN = str("BOT_LOGIN", "github-actions[bot]");

/** Max bytes of reconstructed diff fed to the model before per-file truncation. */
export const MAX_DIFF_BYTES = num("MAX_DIFF_BYTES", 256 * 1024);

/** Runaway/abuse backstop (NOT a low active cap). Schema hard ceiling is 50. */
export const MAX_COMMENTS = Math.min(num("MAX_COMMENTS", 25), 50);

/** Post findings at this severity or above; `low` is dropped unless lowered here. */
export const SEVERITY_THRESHOLD: Severity = ((): Severity => {
  const v = str("SEVERITY_THRESHOLD", "medium").toLowerCase();
  return v === "low" || v === "medium" || v === "high" || v === "critical" ? v : "medium";
})();

export const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** "note" (default) posts the no-suggestions note; "silent" posts nothing. */
export type EmptyReviewMode = "note" | "silent";
export const EMPTY_REVIEW_MODE: EmptyReviewMode =
  str("EMPTY_REVIEW_MODE", "note") === "silent" ? "silent" : "note";

export const EMPTY_REVIEW_BODY = "Review completed. No suggestions at this time.";

/** Maintainer-specified 3-tier ladder (all verified tool_calling on NanoGPT). */
export const MODEL_PRIORITY: readonly string[] = (() => {
  const raw = process.env.MODEL_PRIORITY;
  if (raw && raw.trim() !== "") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [
    "deepseek/deepseek-v4-pro-cheaper:thinking",
    "xiaomi/mimo-v2.5-pro:thinking",
    "minimax/minimax-m3:thinking",
  ];
})();

/** One attempt per model by default (the validator, not retries, is the net). */
export const RETRIES_PER_MODEL = num("RETRIES_PER_MODEL", 0);

/** Per-attempt timeout (ms). Reasoning models' first-token latency can be tens of s. */
export const PER_ATTEMPT_TIMEOUT_MS = num("PER_ATTEMPT_TIMEOUT", 240) * 1000;

/** Global wall-clock budget (ms) across the whole fallback loop. */
export const GLOBAL_BUDGET_MS = num("GLOBAL_BUDGET_MIN", 15) * 60 * 1000;

/** A legitimate-empty review needs a summary at least this long (anti-degenerate). */
export const MIN_SUBSTANTIVE_SUMMARY = num("MIN_SUBSTANTIVE_SUMMARY", 40);
