// SPDX-License-Identifier: AGPL-3.0-or-later
//
// validate-review-output.ts — Stage 2 disposal wrapper (plan §9). Reads
// review-raw.json (model output) + pr-context.json (trusted context), runs the
// pure disposal pipeline (lib/validate.ts), and writes review-final.json for the
// poster. Re-validates the model output against the ajv schema first (defense in
// depth — the wrapper already validated, but this stage is the authority).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BOT_MARKER,
  EMPTY_REVIEW_BODY,
  EMPTY_REVIEW_MODE,
  MAX_COMMENTS,
  SEVERITY_RANK,
  SEVERITY_THRESHOLD,
} from "./lib/config";
import { validateReviewOutput } from "./lib/schema";
import type { PrContext, ReviewRaw } from "./lib/types";
import { buildReviewFinal, emptyFailureFinal, type ValidateConfig } from "./lib/validate";

const cfg: ValidateConfig = {
  severityThreshold: SEVERITY_THRESHOLD,
  severityRank: SEVERITY_RANK,
  maxComments: MAX_COMMENTS,
  emptyReviewMode: EMPTY_REVIEW_MODE,
  emptyReviewBody: EMPTY_REVIEW_BODY,
  botMarker: BOT_MARKER,
};

export async function main(): Promise<void> {
  const dir = process.env.OUT_DIR ?? process.cwd();
  const context = JSON.parse(readFileSync(join(dir, "pr-context.json"), "utf8")) as PrContext;
  const raw = JSON.parse(readFileSync(join(dir, "review-raw.json"), "utf8")) as ReviewRaw;

  let final = emptyFailureFinal(context, cfg);
  if (raw.ok && raw.output) {
    // Authoritative re-validation before any anchoring/posting work.
    const validation = validateReviewOutput(raw.output);
    if (validation.ok) {
      final = buildReviewFinal(validation.value, context, cfg);
    } else {
      console.error(
        `[validate] model output failed re-validation: ${validation.errors.join("; ")}`,
      );
    }
  }

  writeFileSync(join(dir, "review-final.json"), `${JSON.stringify(final, null, 2)}\n`);
  console.log(
    `[validate] should_post=${final.should_post} comments=${final.comments.length} ` +
      `dropped=${final.dropped_or_uncertain_findings.length}`,
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
