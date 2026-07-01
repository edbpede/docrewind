// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PURE lifecycle decision for the Google Classroom "Replay revisions" affordance.
// No DOM / WXT / browser here — the content script observes the live state, hands
// these booleans in, and applies the returned action. Extracted so the resilience
// rule is unit-tested without a browser.
//
// Why this exists (the bug it fixes): on the submission-status view the button is
// injected as a sibling of Classroom's own attachment-card `<a>`. Classroom's Wiz
// renderer prunes that foreign node during the post-load render churn (the visible
// "flicker"), yet WXT's `ui.mounted` stays truthy after an *external* removal. The
// old reconcile only re-mounted when the ANCHOR changed or left the DOM, so once our
// host was pruned while the anchor persisted, the button was gone for good. The fix
// is to treat a disconnected host as "needs remount" and to never tear the button
// down merely because the anchor blinked out for a frame while the view still applies.

/** What the content script should do this reconcile pass. */
export type ReconcileAction = "mount" | "remove" | "none";

/** Live state the content script observes each reconcile pass. */
export interface ReconcileState {
  /** Does the current location call for the affordance at all (right view + ids)? */
  readonly applicable: boolean;
  /** Does WXT currently consider the UI mounted (its `mounted` value is set)? */
  readonly mounted: boolean;
  /** Is our injected host element still attached to the document? */
  readonly hostConnected: boolean;
  /** Did the mount anchor resolve this pass? `false` during transient SPA churn. */
  readonly anchorPresent: boolean;
  /** Did the resolved anchor change identity since we last mounted (student switch)? */
  readonly anchorChanged: boolean;
}

/**
 * Decide the next lifecycle action for the Classroom affordance.
 *
 * - `"remove"` only when the view stops applying — never for a transient missing
 *   anchor (that transience is the flicker we are fixing).
 * - `"mount"` when nothing is up, when our host was pruned out from under us while
 *   WXT still believes it is mounted, or when the anchor identity changed.
 * - `"none"` when already correctly mounted, or while the anchor has momentarily
 *   blinked out but the view still applies (hold what is up; a later pass re-anchors).
 */
export function decideReconcile(state: ReconcileState): ReconcileAction {
  if (!state.applicable) return state.mounted ? "remove" : "none";
  if (!state.anchorPresent) return "none";
  if (!state.mounted || !state.hostConnected || state.anchorChanged) return "mount";
  return "none";
}
