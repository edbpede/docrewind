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

/** Live state for the engagement gate — sampled before any DOM work is done. */
export interface EngagementState {
  /** Does the current URL parse to a grading/submission route at all? */
  readonly routeApplicable: boolean;
  /** Is our affordance currently up (mounted by us and not yet removed by us)? */
  readonly uiUp: boolean;
}

/**
 * Whether the reconcile machinery should be ENGAGED at all: run reconcile passes
 * and keep the slow backstop interval armed.
 *
 * Engaged on any grading/submission route (the anchor may still be resolving, so
 * passes must retry), and while our UI is up even after the route stopped applying
 * (one more pass is owed to tear it down). On every other Classroom page —
 * home, stream, class list, settings — the affordance can never apply, so no
 * reconcile pass may run and no backstop may tick: the only permitted idle cost
 * is the URL check that produced `routeApplicable`.
 */
export function isEngaged(state: EngagementState): boolean {
  return state.routeApplicable || state.uiUp;
}
