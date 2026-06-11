// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bytes -> JSON boundary (plan T2 / R1). This is the ONLY place the `)]}'`
// anti-hijacking guard is stripped; the pure decoder consumes already-parsed
// JSON and never imports this module. Labeled PROVISIONAL — pending §24 — but
// safe to implement now: the guard string is standard Google behavior (A.3).

import { DEFAULT_TRANSPORT } from "./types";

// The standard Google anti-JSON-hijacking guard line (A.3). PROVISIONAL — §24.
// Single source of truth: tracks DEFAULT_TRANSPORT so a §24 change edits one site.
const GUARD_PREFIX = DEFAULT_TRANSPORT.guardPrefix;

/**
 * Fail-safe-strip the `)]}'` guard prefix (and a single trailing newline) if
 * present; pass the text through unchanged if absent. Never throws — a missing
 * guard is expected/tolerated, not an error.
 */
export function stripGuard(text: string): string {
  if (!text.startsWith(GUARD_PREFIX)) {
    return text;
  }
  const afterGuard = text.slice(GUARD_PREFIX.length);
  // Google emits the guard as its own line; drop one leading CR?LF if present.
  return afterGuard.replace(/^\r?\n/, "");
}

/**
 * Strip the guard then `JSON.parse`, returning parsed JSON for hand-off to
 * schema-detect -> decoder. Throws `SyntaxError` on malformed JSON (the caller
 * gates on schema detection before decoding).
 */
export function parseFramed(text: string): unknown {
  return JSON.parse(stripGuard(text));
}
