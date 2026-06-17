// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ProgressView (plan Phase 5 Step 5e / Seam C+F). Counts/percent only — content-
// free by construction. Three phases via <Switch>/<Match>:
//   • "discovering" — indeterminate, only while a first checkpoint is pending.
//   • "fetching"    — determinate bar from `pct` (role=progressbar + aria values).
//   • "error"       — stall/timeout/terminal: the CLASSIFIED RetrievalError copy
//                     (never String(error), §13.7) + Retry/Cancel.
// It MUST NOT render an infinite "discovering": the App transitions a never-
// completing retrieval to the "error" phase (Seam F1) and passes it here.

import type { Component } from "solid-js";
import { createMemo, Match, Switch } from "solid-js";
import { errorTitle, percentLabel, strings } from "@/lib/i18n/strings";
import { type RetrievalErrorCategory, retrievalError } from "@/lib/retrieval/errors";

export type ProgressPhase = "discovering" | "fetching" | "error";

export interface ProgressViewProps {
  readonly phase: ProgressPhase;
  readonly pct: number;
  readonly errorCategory: RetrievalErrorCategory | null;
  readonly onRetry: () => void;
  readonly onCancel: () => void;
}

const ProgressView: Component<ProgressViewProps> = (props) => {
  // The error branch keys on `phase` (not the category) so an error state always
  // renders; a missing category falls back to a generic classified error rather
  // than rendering nothing.
  const category = createMemo<RetrievalErrorCategory>(
    () => props.errorCategory ?? "reconstruction-failure",
  );

  return (
    <div class="dr-card flex flex-col gap-2">
      <Switch>
        <Match when={props.phase === "discovering"}>
          <p class="dr-eyebrow">{strings.progress.discovering}</p>
          <div class="progress-track">
            <div class="progress-indeterminate" />
          </div>
        </Match>

        <Match when={props.phase === "fetching"}>
          {/* Label and figure are separate typographic roles: the tracked
              eyebrow names the work, the tabular-nums figure (in the bar's own
              indigo) carries the number — baseline-aligned like the replay
              counter/dateline row, so it reads as part of the same record. */}
          <div class="flex items-baseline justify-between gap-3">
            <p class="dr-eyebrow">{strings.progress.fetching}</p>
            <span class="dr-percent">{percentLabel(props.pct)}</span>
          </div>
          <div
            class="progress-track"
            role="progressbar"
            aria-label={strings.progress.fetching}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={props.pct}
          >
            <div class="progress-fill" style={{ width: `${props.pct}%` }} />
          </div>
        </Match>

        <Match when={props.phase === "error"}>
          <div class="flex flex-col gap-2">
            <p class="font-medium text-strike">{errorTitle(category())}</p>
            <p class="text-sm text-stone-700 dark:text-stone-300">
              {retrievalError(category()).userMessage}
            </p>
            <p class="text-xs text-stone-600 dark:text-stone-400">
              {retrievalError(category()).suggestedAction}
            </p>
            <div class="flex gap-2">
              <button type="button" class="btn-primary" onClick={() => props.onRetry()}>
                {strings.progress.retry}
              </button>
              <button type="button" class="btn-secondary" onClick={() => props.onCancel()}>
                {strings.progress.cancel}
              </button>
            </div>
          </div>
        </Match>
      </Switch>
    </div>
  );
};

export default ProgressView;
