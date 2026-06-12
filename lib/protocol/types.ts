// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Transport contracts for the Google Docs revisions endpoint (plan T2 / §19).
// CONFIRMED by the §24 live capture (2026-06-12; see docs/protocol-capture.md):
// the grammar is source-confirmed (Appendix A.2) AND the 2026 transport (framing,
// headers, token, discovery, op-code currency) was observed on the wire. No
// stop-condition fired. Fields below now carry the captured values; the
// `Unconfirmed` sentinel and the fail-safe schema detector (schema-detect.ts)
// remain so any FUTURE drift in this volatile, undocumented surface degrades
// safely rather than silently.

/** Sentinel for a transport fact the §24 capture has not (or no longer) confirmed. */
export const UNCONFIRMED = "UNCONFIRMED" as const;
export type Unconfirmed = typeof UNCONFIRMED;

/**
 * Recognized changelog schema versions. detectSchema() returns one of these,
 * or `{ kind: "unknown" }`. Only a recognized version may reach the decoder.
 */
export type SchemaVersion = {
  // The `)]}'`-guarded JSON changelog modeled in Appendix A.2. CONFIRMED 2026-06-12:
  // the top-level payload is an object `{ chunkedSnapshot, changelog }`; `changelog`
  // is an array of 9-element revision tuples `[op, time, sessionId, revisionId,
  // userId, …]`. detectSchema keys on the `changelog` array, so the sibling
  // `chunkedSnapshot` (the base-state style scaffolding) does not affect detection.
  readonly kind: "json-changelog-v1";
};

/**
 * Tunable transport facts. CONFIRMED by the §24 capture (2026-06-12) except where
 * a field is deliberately conservative. Each field stays `| Unconfirmed`-typed so
 * a future regression can be re-flagged without a structural change.
 */
export interface TransportConstants {
  // CONFIRMED (A.3): the `)]}'` anti-JSON-hijacking guard line is present.
  readonly guardPrefix: string;
  // CONFIRMED (A.7, §24 Q3): a plain credentialed read needs NO custom header
  // (no `X-Same-Domain`) — the empty list is the captured minimal set.
  readonly requiredReadHeaders: readonly string[] | Unconfirmed;
  // CONFIRMED (A.7, §24 Q4): reads need NO XSRF/`at` token — only the session cookie.
  readonly readTokenRequired: boolean | Unconfirmed;
  // CONFIRMED (A.4, §24 Q5): the current revision count is published in the editor
  // bootstrap as `"revision":N`; out-of-range `end` ⇒ HTTP 400 is the fallback signal.
  readonly discoveryMechanism: string | Unconfirmed;
  // CONFIRMED (A.2/A.8, §24 Q7): text/structure ops the decoder recognizes. The
  // live capture also surfaced `as` (ApplyStyle), intentionally isolated via the
  // decoder's open-world UnknownOp path (it carries no body text).
  readonly knownOpCodes: readonly string[] | Unconfirmed;
}

/**
 * The default transport constants, filled from the §24 live capture (2026-06-12).
 * The schema detector and the `| Unconfirmed` typing remain the safety net for
 * future drift in this undocumented surface.
 */
export const DEFAULT_TRANSPORT: TransportConstants = {
  guardPrefix: ")]}'", // CONFIRMED 2026-06-12 (A.3)
  requiredReadHeaders: [], // CONFIRMED 2026-06-12 — none required (§24 Q3)
  readTokenRequired: false, // CONFIRMED 2026-06-12 — cookie-only read (§24 Q4)
  discoveryMechanism: "revision-count-metadata", // CONFIRMED 2026-06-12 (§24 Q5)
  knownOpCodes: ["is", "ds", "mlti", "iss", "dss", "msfd", "usfd"], // CONFIRMED (A.2); `as` isolated
};
