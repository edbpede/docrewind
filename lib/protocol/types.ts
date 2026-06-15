// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Transport contracts for the Google Docs revisions endpoint (plan T2 / §19).
// CONFIRMED by the §24 live capture (2026-06-12):
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
  // CONFIRMED (A.2/A.8, §24 Q7): text/suggestion ops the decoder recognizes. The
  // simple-doc capture surfaced `as` (ApplyStyle); the 2026-06-12 rich/suggesting
  // -doc capture (Firefox) additionally surfaced embedded-object entity ops
  // (`ae`/`te`/`ue`) and suggestion style/entity ops (`astss`/`sue`). ALL of those
  // are intentionally isolated via the decoder's open-world UnknownOp path (see
  // `liveOpaqueOpCodes`) — embedded objects ride in-band as ae+te+ue but carry no
  // body text, so omitting them leaves the reconstructed character stream aligned.
  readonly knownOpCodes: readonly string[] | Unconfirmed;
  // CONFIRMED live (§24 Q7) but NOT structurally decoded — recorded so the
  // open-world UnknownOp path is documented rather than silent. `as` = ApplyStyle;
  // `ae`/`te`/`ue` = add/place/update embedded-object entity; `astss` = apply
  // style to a suggestion range; `sue` = suggested entity update.
  readonly liveOpaqueOpCodes: readonly string[] | Unconfirmed;
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
  knownOpCodes: ["is", "ds", "mlti", "iss", "dss", "msfd", "usfd"], // CONFIRMED (A.2/§24 Q7); decoded
  // CONFIRMED live 2026-06-12 (§24 Q7) — present on the wire, isolated as UnknownOp.
  liveOpaqueOpCodes: ["as", "ae", "te", "ue", "astss", "sue"],
};
