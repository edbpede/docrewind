// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rich segment rendering (plan Phase 5 Seam D / Step 2). `stateAt` yields plain
// text only; this module derives STRUCTURED segments so the viewport can render
// suggestions distinctly and keep opaque structures as labeled placeholders
// (§9.6), while staying PURE and Bun-testable.
//
// SINGLE-ARG by design: `segmentsAt(model)` renders the SUPPLIED model at its
// final state — the model is ALREADY time-traveled by `modelAtRevisionIndex`,
// exactly mirroring `textAtRevisionIndex(i) = currentText(modelAtRevisionIndex(i))`,
// which applies NO second time-cut. There is deliberately NO `t`/index parameter:
// `currentIndex` is an APPLIED-COUNT while `stateAt`'s `t` is the wire `RevisionId`
// scale, and mixing them corrupts the view (the original `tFromIndex` bug). The
// final-state visibility rule below mirrors `text.ts`'s `liveAtT` +
// `notSuggestedDelete` predicate exactly.

import type { OpaqueStructure } from "../decoder/types";
import { opaqueLabel } from "../i18n/strings";
import type { DocumentModel, SuggestionState } from "./model";

/**
 * One rendered run. `fromRevision` / `toRevision` are the run's first / last
 * element's `insertRevision` — provenance only, NEVER a render-time time-cut.
 * Because a run coalesces contiguous same-kind chars regardless of which revision
 * wrote each, a run can straddle several revisions: `fromRevision` is the revision
 * that opened it, `toRevision` the revision that most recently extended its tail.
 * The replay caret uses the pair to find the run the current revision touched (it
 * either opened a fresh run or appended onto an existing one).
 *
 * `revisions` lists EVERY revision that contributed a char to the run (deduped,
 * order-insignificant), including the ones in the middle that `fromRevision` /
 * `toRevision` don't name. Author highlighting needs this so a contributor whose
 * edit landed inside a coalesced run is attributed, not just the two endpoints.
 */
export type Segment =
  | {
      readonly kind: "accepted-text";
      readonly text: string;
      readonly fromRevision: number;
      readonly toRevision: number;
      readonly revisions: readonly number[];
    }
  | {
      readonly kind: "suggested-insert";
      readonly text: string;
      readonly fromRevision: number;
      readonly toRevision: number;
      readonly revisions: readonly number[];
    }
  | {
      readonly kind: "marked-for-deletion";
      readonly text: string;
      readonly fromRevision: number;
      readonly toRevision: number;
      readonly revisions: readonly number[];
    }
  | {
      readonly kind: "opaque-placeholder";
      readonly structure: OpaqueStructure;
      readonly label: string;
    };

/** The three text-bearing segment kinds (opaque placeholders carry no text). */
type TextKind = "accepted-text" | "suggested-insert" | "marked-for-deletion";

/** Map a live char's suggestion state to its text-segment kind. */
function textKindFor(state: SuggestionState): TextKind {
  switch (state) {
    case "none":
      return "accepted-text";
    case "suggested-insert":
      return "suggested-insert";
    case "marked-for-deletion":
      return "marked-for-deletion";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

interface TextRun {
  kind: TextKind;
  text: string;
  fromRevision: number;
  toRevision: number;
  // Every revision that wrote a char into this run, deduped. Endpoints alone
  // miss contributors whose edit coalesced into the middle of the run.
  revisions: Set<number>;
}

/**
 * Derive the structured segments for a (already time-traveled) document model.
 *
 * Visibility mirrors `currentText` exactly: an accepted-deleted element
 * (`deleteRevision !== null`) is tombstoned out of the final state and is not
 * rendered. Live text is grouped into runs by kind (accepted vs. suggested-insert
 * vs. marked-for-deletion). Opaque slots become labeled placeholders; the
 * EndOfBody sentinel is skipped.
 *
 * Invariant (proven in the test): the concatenated text of the `accepted-text`
 * and `suggested-insert` segments equals `currentText(model)` — `marked-for-deletion`
 * runs are rendered separately and are NOT part of the visible text, exactly as
 * `text.ts` excludes them.
 *
 * BASE CONTENT: pre-existing/template content seeded from a `chunkedSnapshot`
 * carries the pre-history revision id (0) on its chars, so it groups into ordinary
 * `accepted-text` runs and renders as the full document context — its only
 * distinction is the revision id (`fromRevision`/`toRevision`/`revisions` of 0).
 * The viewport joins authorship and the playback caret on REAL revision ids (≥1),
 * so base content is naturally rendered but never attributed to a fetched author
 * and never carries a caret — exactly right for content no captured revision wrote.
 */
export function segmentsAt(model: DocumentModel): readonly Segment[] {
  const segments: Segment[] = [];
  let run: TextRun | null = null;

  function flush(): void {
    if (run !== null) {
      segments.push({
        kind: run.kind,
        text: run.text,
        fromRevision: run.fromRevision,
        toRevision: run.toRevision,
        revisions: [...run.revisions],
      });
      run = null;
    }
  }

  for (const el of model.chars) {
    // Accepted-deleted elements are gone from the final state (mirrors `liveAtT`).
    if (el.deleteRevision !== null) {
      flush();
      continue;
    }
    switch (el.kind) {
      case "eob": {
        // The EndOfBody sentinel contributes neither text nor a placeholder.
        flush();
        break;
      }
      case "opaque": {
        flush();
        // A suggestion-removed structure is not part of the final document.
        if (el.suggestionState !== "marked-for-deletion") {
          segments.push({
            kind: "opaque-placeholder",
            structure: el.structure,
            label: opaqueLabel(el.structure),
          });
        }
        break;
      }
      case "char": {
        const kind = textKindFor(el.suggestionState);
        if (run !== null && run.kind === kind) {
          run.text += el.char;
          // Coalescing across revisions: the run's tail now belongs to this char's
          // revision, so the caret can find the run a later revision extended.
          run.toRevision = el.insertRevision;
          run.revisions.add(el.insertRevision);
        } else {
          flush();
          run = {
            kind,
            text: el.char,
            fromRevision: el.insertRevision,
            toRevision: el.insertRevision,
            revisions: new Set([el.insertRevision]),
          };
        }
        break;
      }
      default: {
        const _exhaustive: never = el;
        void _exhaustive;
        break;
      }
    }
  }
  flush();
  return segments;
}
