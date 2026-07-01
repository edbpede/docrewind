// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Schema gate at the JSON -> decoder boundary (plan T2 / R1, PRD §9.4). The
// protocol layer calls detectSchema() on parsed JSON; on `{ kind: "unknown" }`
// the payload NEVER reaches the decoder — a typed diagnostic is emitted instead
// — so an unrecognized shape degrades safely and never corrupts playback. Only
// a recognized SchemaVersion proceeds to decodeOperations(parsed).

import type { SchemaVersion } from "./types";

/** Result of schema detection: a recognized version, or an explicit unknown. */
export type SchemaDetection = SchemaVersion | { readonly kind: "unknown" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fail-safe schema detection. Recognizes the provisional `json-changelog-v1`
 * shape — a record carrying a `changelog` array — and returns `unknown` for
 * anything else (including a `batchexecute`/protobuf-shaped or empty payload),
 * gating the hand-off to the decoder. PROVISIONAL — pending §24 capture.
 */
export function detectSchema(parsed: unknown): SchemaDetection {
  if (isRecord(parsed) && Array.isArray(parsed.changelog)) {
    return { kind: "json-changelog-v1" };
  }
  return { kind: "unknown" };
}
