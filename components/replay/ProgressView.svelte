<script lang="ts" module>
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // ProgressView (plan Phase 5 Step 5e / Seam C+F). Counts/percent only — content-
  // free by construction. Three phases:
  //   • "discovering" — indeterminate, only while a first checkpoint is pending.
  //   • "fetching"    — determinate bar from `pct` (role=progressbar + aria values).
  //   • "error"       — stall/timeout/terminal: the CLASSIFIED RetrievalError copy
  //                     (never String(error), §13.7) + Retry/Cancel.
  // It MUST NOT render an infinite "discovering": the App transitions a never-
  // completing retrieval to the "error" phase (Seam F1) and passes it here.
  //
  // Tone (redesign): reassuring, not alarming. The error state leads with a calm
  // alert mark and a plain title/explanation/next-step, never a red shout.

  import type { RetrievalErrorCategory } from "@/lib/core/retrieval/errors";

  export type ProgressPhase = "discovering" | "fetching" | "error";

  export interface ProgressViewProps {
    readonly phase: ProgressPhase;
    readonly pct: number;
    readonly errorCategory: RetrievalErrorCategory | null;
    readonly onRetry: () => void;
    readonly onCancel: () => void;
  }
</script>

<script lang="ts">
  import { IconAlert, IconHistory } from "@/components/common/icons";
  import { errorTitle, percentLabel, strings } from "@/lib/core/i18n/strings";
  import { retrievalError } from "@/lib/core/retrieval/errors";

  const { phase, pct, errorCategory, onRetry, onCancel }: ProgressViewProps = $props();

  // The error branch keys on `phase` (not the category) so an error state always
  // renders; a missing category falls back to a generic classified error rather
  // than rendering nothing.
  const category = $derived<RetrievalErrorCategory>(errorCategory ?? "reconstruction-failure");
</script>

<div class="dr-card flex flex-col gap-3.5">
  {#if phase === "discovering"}
    <div class="flex items-center gap-2.5">
      <IconHistory size={20} class="shrink-0 text-brand-text" />
      <p class="dr-subheading">{strings.progress.discovering}</p>
    </div>
    <div class="progress-track">
      <div class="progress-indeterminate dr-indeterminate"></div>
    </div>
  {:else if phase === "fetching"}
    <!-- Label and figure are separate typographic roles: the name of the work
         on the left, the tabular-nums figure (in the brand accent) on the
         right — baseline-aligned like the replay counter/dateline row. -->
    <div class="flex items-baseline justify-between gap-3">
      <p class="dr-subheading">{strings.progress.fetching}</p>
      <span class="dr-percent">{percentLabel(pct)}</span>
    </div>
    <div
      class="progress-track"
      role="progressbar"
      aria-label={strings.progress.fetching}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div class="progress-fill" style:width={`${pct}%`}></div>
    </div>
  {:else if phase === "error"}
    <div class="flex items-start gap-3">
      <IconAlert size={22} class="mt-0.5 shrink-0 text-danger" />
      <div class="flex flex-col gap-1.5">
        <p class="dr-subheading">{errorTitle(category)}</p>
        <p class="dr-body text-ink-secondary text-pretty">
          {retrievalError(category).userMessage}
        </p>
        <p class="dr-muted text-pretty">{retrievalError(category).suggestedAction}</p>
        <div class="mt-1.5 flex flex-wrap gap-2">
          <button type="button" class="btn-primary" onclick={() => onRetry()}>
            {strings.progress.retry}
          </button>
          <button type="button" class="btn-secondary" onclick={() => onCancel()}>
            {strings.progress.cancel}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
