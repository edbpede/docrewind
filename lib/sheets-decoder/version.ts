// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sheets parser/decoder version stamps (plan §6 Storage additivity / R9). Sheets
// versions INDEPENDENTLY of Docs: a Sheets decode change bumps
// `SHEETS_PARSER_VERSION` and never invalidates cached Docs data (and
// vice-versa). It lives in a `lib/sheets-decoder` pure module so the decode
// pipeline and the storage layer share one source of truth.
//
// `SHEETS_MODEL_BASELINE` is the Ritz `modelVersion` the decode grammar was
// reverse-engineered against (live capture 2026-06-30). The wire opcodes are
// obfuscated and tied to this version; a payload carrying a DIFFERENT
// modelVersion may have repurposed a known opcode (R9), so the decoder carries
// the runtime modelVersion through and the reconstruction core raises a soft
// fidelity signal on a mismatch — never throwing, but never claiming full
// fidelity.

/** Monotonic Sheets decode-pipeline version. Bump on any decode/reconstruct change. */
export const SHEETS_PARSER_VERSION = 1;

/** The captured Ritz `modelVersion` the decode grammar matches (2026-06-30). */
export const SHEETS_MODEL_BASELINE = 99;
