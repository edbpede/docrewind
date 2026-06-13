// SPDX-License-Identifier: AGPL-3.0-or-later
//
// run-goose-review.ts — Stage 2 model runner (plan §6.2, §10).
//
// Wires the REAL Goose CLI runner into the pure tiered-fallback orchestrator
// (lib/fallback.ts) with the authoritative ajv validator (lib/schema.ts) and the
// config ladder (lib/config.ts). Emits review-raw.json for the validator stage.
// The model has NO GitHub tools and NO secrets beyond the NanoGPT key Goose
// reads from OPENAI_API_KEY in the step env; its output is data only.
//
// Goose runs headless: `goose run --recipe ... --no-session --output-format json
// --model <candidate>`, one attempt per model, inside a global wall-clock budget
// enforced by the orchestrator (install/setup happens in an earlier, untimed
// workflow step so it is not charged against the budget).

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GLOBAL_BUDGET_MS,
  MIN_SUBSTANTIVE_SUMMARY,
  MODEL_PRIORITY,
  PER_ATTEMPT_TIMEOUT_MS,
  RETRIES_PER_MODEL,
} from "./lib/config";
import { type GooseRunner, type RunnerResult, runFallback } from "./lib/fallback";
import { validateReviewOutput } from "./lib/schema";

/** Spawn `goose run ...` for one model, resolving to a classified RunnerResult. */
function makeGooseRunner(recipePath: string, contextPath: string, diffPath: string): GooseRunner {
  return (model, timeoutMs) =>
    new Promise<RunnerResult>((resolve) => {
      const args = [
        "run",
        "--recipe",
        recipePath,
        "--params",
        `pr_context_file=${contextPath}`,
        "--params",
        `diff_file=${diffPath}`,
        "--no-session",
        "--output-format",
        "json",
        "--model",
        model,
      ];
      const child = spawn("goose", args, { env: process.env });
      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (r: RunnerResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ kind: "transport_error", detail: `timeout after ${timeoutMs}ms` });
      }, timeoutMs);

      child.stdout.on("data", (d) => {
        stdout += String(d);
      });
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", (err) => finish({ kind: "process_error", detail: err.message }));
      child.on("close", (code) => {
        if (code === 0) finish({ kind: "completed", stdout });
        else finish({ kind: "process_error", detail: `exit ${code}: ${stderr.slice(0, 500)}` });
      });
    });
}

export async function main(): Promise<void> {
  const dir = process.env.OUT_DIR ?? process.cwd();
  const recipePath = process.env.RECIPE_PATH ?? join(".goose", "recipes", "pr-review.yaml");
  const contextPath = join(dir, "pr-context.json");
  const diffPath = join(dir, "pr.diff");

  const raw = await runFallback({
    models: MODEL_PRIORITY,
    runner: makeGooseRunner(recipePath, contextPath, diffPath),
    validate: validateReviewOutput,
    now: () => Date.now(),
    perAttemptTimeoutMs: PER_ATTEMPT_TIMEOUT_MS,
    globalBudgetMs: GLOBAL_BUDGET_MS,
    retriesPerModel: RETRIES_PER_MODEL,
    minSubstantiveSummary: MIN_SUBSTANTIVE_SUMMARY,
  });

  writeFileSync(join(dir, "review-raw.json"), `${JSON.stringify(raw, null, 2)}\n`);
  console.log(
    raw.ok
      ? `[run-goose-review] ok via ${raw.model_used} (after ${raw.fallback_attempts} fallback(s))`
      : `[run-goose-review] no usable output: ${raw.reason}`,
  );
  // Non-blocking: even all-models-failed exits 0 so the PR is never broken.
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    // Still emit a non-blocking marker so the downstream stage degrades cleanly.
    const dir = process.env.OUT_DIR ?? process.cwd();
    writeFileSync(
      join(dir, "review-raw.json"),
      `${JSON.stringify({ ok: false, reason: "runner_exception", model_used: null, fallback_attempts: 0 }, null, 2)}\n`,
    );
  });
}
