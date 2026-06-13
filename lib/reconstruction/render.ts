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
 * One rendered run. `fromRevision` is the run's first element's `insertRevision`
 * — provenance only, NEVER a render-time time-cut.
 */
export type Segment =
  | { readonly kind: "accepted-text"; readonly text: string; readonly fromRevision: number }
  | { readonly kind: "suggested-insert"; readonly text: string; readonly fromRevision: number }
  | { readonly kind: "marked-for-deletion"; readonly text: string; readonly fromRevision: number }
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
 */
export function segmentsAt(model: DocumentModel): readonly Segment[] {
  const segments: Segment[] = [];
  let run: TextRun | null = null;

  function flush(): void {
    if (run !== null) {
      segments.push({ kind: run.kind, text: run.text, fromRevision: run.fromRevision });
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
        } else {
          flush();
          run = { kind, text: el.char, fromRevision: el.insertRevision };
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
