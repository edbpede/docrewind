// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Transport contracts for the Google Docs revisions endpoint (plan T2 / §19).
// Everything here is PROVISIONAL pending the §24 live capture: the grammar is
// source-confirmed (Appendix A.2) but the 2026 transport (framing, headers,
// token, discovery, op-code currency) is not. Unconfirmed fields carry the
// `Unconfirmed` sentinel so nothing is mistaken for a settled value, and the
// schema detector (schema-detect.ts) fails safe on any unrecognized shape.

/** Sentinel for a transport fact that the §24 live capture has not confirmed. */
export const UNCONFIRMED = "UNCONFIRMED" as const;
export type Unconfirmed = typeof UNCONFIRMED;

/**
 * Recognized changelog schema versions. detectSchema() returns one of these,
 * or `{ kind: "unknown" }`. Only a recognized version may reach the decoder.
 */
export type SchemaVersion = {
  // The `)]}'`-guarded JSON changelog modeled in Appendix A.2. The exact 2026
  // wire shape is provisional; the synthetic fixtures encode this contract.
  readonly kind: "json-changelog-v1";
};

/**
 * Tunable transport facts. Defaults are UNCONFIRMED except the two cheaply
 * fail-safe pieces the plan adopts (the `)]}'` guard string — standard Google
 * behavior, A.3 — and the multi-account `/u/{N}/` path variant, A.5). Every
 * field is PROVISIONAL until the §24 capture fills it in.
 */
export interface TransportConstants {
  // PROVISIONAL — pending §24 capture. `)]}'` guard (A.3, standard Google behavior).
  readonly guardPrefix: string;
  // PROVISIONAL — pending §24 capture. Required read headers (e.g. X-Same-Domain?).
  readonly requiredReadHeaders: readonly string[] | Unconfirmed;
  // PROVISIONAL — pending §24 capture. Whether reads need an XSRF/`at` token.
  readonly readTokenRequired: boolean | Unconfirmed;
  // PROVISIONAL — pending §24 capture. Revision-count discovery mechanism.
  readonly discoveryMechanism: string | Unconfirmed;
  // PROVISIONAL — pending §24 capture. Currently-valid operation `ty` codes.
  readonly knownOpCodes: readonly string[] | Unconfirmed;
}

/**
 * The default transport constants used until §24 capture lands. Deliberately
 * UNCONFIRMED for everything except the guard prefix (safe to ship).
 */
export const DEFAULT_TRANSPORT: TransportConstants = {
  guardPrefix: ")]}'", // PROVISIONAL — pending §24 capture (A.3 standard behavior)
  requiredReadHeaders: UNCONFIRMED, // PROVISIONAL — pending §24 capture
  readTokenRequired: UNCONFIRMED, // PROVISIONAL — pending §24 capture
  discoveryMechanism: UNCONFIRMED, // PROVISIONAL — pending §24 capture
  knownOpCodes: UNCONFIRMED, // PROVISIONAL — pending §24 capture
};
