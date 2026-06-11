// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Text extraction (plan T4 / R3). A single O(N) filter over the flat model — no
// per-revision physical mutation. `stateAt(t)` is the time-travel primitive;
// `currentText` is `stateAt(+infinity)`.

import type { DocumentModel } from "./model";

/**
 * Reconstruct the visible body text as of revision `t`. Includes a character
 * when it was inserted at or before `t`, was not yet (accepted-)deleted at `t`,
 * and is not a suggestion marked for deletion. Suggested-insert text IS visible.
 * The EndOfBody sentinel and opaque slots contribute no text.
 *
 * NOTE: `suggestionState` is the element's final state, so suggestion visibility
 * for a strictly-earlier `t` is approximate; insert/delete time-travel is exact.
 */
export function stateAt(model: DocumentModel, t: number): string {
  let out = "";
  for (const el of model.chars) {
    if (el.kind !== "char") {
      continue;
    }
    const insertedByT = el.insertRevision <= t;
    const liveAtT = el.deleteRevision === null || el.deleteRevision > t;
    const notSuggestedDelete = el.suggestionState !== "marked-for-deletion";
    if (insertedByT && liveAtT && notSuggestedDelete) {
      out += el.char;
    }
  }
  return out;
}

/** The current (end-of-timeline) visible text. */
export function currentText(model: DocumentModel): string {
  return stateAt(model, Number.MAX_SAFE_INTEGER);
}
