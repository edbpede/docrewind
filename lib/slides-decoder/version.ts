// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Slides (Punch) parser/decoder version stamps. Slides versions INDEPENDENTLY of
// Docs and Sheets: a Slides decode change bumps `SLIDES_PARSER_VERSION` and never
// invalidates cached Docs/Sheets data (and vice-versa). It lives in a
// `lib/slides-decoder` pure module so the decode pipeline and the storage layer
// share one source of truth.
//
// `SLIDES_MODEL_BASELINE` is nominal: unlike the Sheets `revisions/load` payload,
// the Slides payload observed in the live capture (2026-07-01) carries NO
// `modelVersion` field, and the opcodes are small stable integers (1/3/4/12/15/16/
// …) rather than modelVersion-tied obfuscated ids. The baseline is kept for parity
// with the other cores and to drive the same soft mismatch signal should a future
// payload ever start carrying a `modelVersion`.

/** Monotonic Slides decode-pipeline version. Bump on any decode/reconstruct change. */
export const SLIDES_PARSER_VERSION = 1;

/** Nominal Punch model baseline (wire carries no modelVersion; see file header). */
export const SLIDES_MODEL_BASELINE = 0;
