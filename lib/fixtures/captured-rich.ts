// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SANITIZED rich/suggesting-doc fixture (PRD §11.5, §15.3; §24 Q7 follow-up).
//
// Op SHAPES confirmed from a §24 follow-up LIVE capture (2026-06-12, Firefox 151
// over the firefox-devtools MCP, throwaway "Testdokument" with an image, table,
// footnote, equation, bulleted list, and a Suggesting-mode tracked change). The
// live `revisions/load` changelog for that doc
// (revisions 1..140) surfaced FIVE op codes the decoder had not yet seen on the
// wire, all isolated via the open-world UnknownOp path:
//   • ae  — AddEntity        { ty, et:"inline"|"list", id, epm }  (embedded object)
//   • te  — place entity      { ty, id, spi }                      (in-stream, spi)
//   • ue  — UpdateEntity      { ty, id, epm, et }
//   • astss — apply style to a suggestion range { ty, st, si, ei, sm }
//   • sue — suggested entity update            { ty, sugid, id, epm, et }
// Embedded objects (image/table/footnote/equation/list) therefore ride IN-BAND as
// ae+te+ue entity ops (A.8), NOT as out-of-band payloads; lists also carry an
// `as` style op with `st:"list"`. Suggestions are the inline ops the grammar
// already models — `iss` (insert) and `msfd` (mark-for-deletion) were both present
// live (15× and 1× respectively); `dss`/`usfd` were not exercised by this doc.
//
// SANITIZATION (PRD §11.5, §13.7): this fixture is a COMPACT, curated sample that
// reproduces those real op shapes with throwaway synthetic text and structural
// placeholders — `time` → synthetic monotonic stamps, `sessionId` →
// "sess-redacted", `userId` → "user-redacted", entity/suggestion ids →
// "kix.redacted-*"/"suggest.redacted-*", and the bulky opaque style/entity maps
// (`sm`/`epm`, ignored by the text decoder) collapsed to `{}`. The full 140-tuple
// live changelog reconstructs to the document's exact visible text; that
// end-to-end check was run during capture; this committed sample keeps the repo
// free of any
// real session changelog while still exercising the live op grammar.

import type { CapturedFixture } from "./captured";

// One curated changelog (live 9-element tuple envelope: [op, time, sessionId,
// revisionId, userId, …]) exercising text, an embedded entity (ae+te+ue), a
// suggested insert (iss), suggestion-style/entity ops (astss/sue), and a
// mark-for-deletion suggestion (msfd). The five entity/suggestion-entity ops are
// expected to degrade to UnknownOp; `iss`/`msfd` decode to their typed variants.
const CHANGELOG: readonly unknown[] = [
  [
    { ty: "is", s: "Draft ", ibi: 1 },
    1700000000000,
    "sess-redacted",
    1,
    "user-redacted",
    0,
    null,
    null,
    false,
  ],
  [
    { ty: "is", s: "text", ibi: 7 },
    1700000001000,
    "sess-redacted",
    2,
    "user-redacted",
    0,
    null,
    null,
    false,
  ],
  // AddEntity: defines an inline embedded object (e.g. an image) out-of-stream.
  [
    { ty: "ae", et: "inline", id: "kix.redacted-img", epm: {} },
    1700000002000,
    "sess-redacted",
    3,
    "user-redacted",
    0,
    null,
    null,
    false,
  ],
  // Places the entity into the character stream at string-position-index `spi`.
  [
    { ty: "te", id: "kix.redacted-img", spi: 11 },
    1700000003000,
    "sess-redacted",
    4,
    "user-redacted",
    0,
    null,
    null,
    false,
  ],
  // UpdateEntity: mutates the entity's (opaque) property map.
  [
    { ty: "ue", id: "kix.redacted-img", epm: {}, et: "inline" },
    1700000004000,
    "sess-redacted",
    5,
    "user-redacted",
    0,
    null,
    null,
    false,
  ],
  // Suggestion insert (tracked change): text is part of the suggested document.
  [
    { ty: "iss", s: " plus suggestion", ibi: 11 },
    1700000005000,
    "sess-redacted",
    6,
    "user-redacted",
    0,
    null,
    null,
    false,
  ],
  // Apply-style over a suggestion range (carries an opaque style map).
  [
    { ty: "astss", st: "paragraph", si: 1, ei: 1, sm: {} },
    1700000006000,
    "sess-redacted",
    7,
    "user-redacted",
    0,
    null,
    null,
    false,
  ],
  // Suggested entity update: carries a suggestion id (`sugid`).
  [
    { ty: "sue", sugid: "suggest.redacted-1", id: "kix.redacted-img", epm: {}, et: "inline" },
    1700000007000,
    "sess-redacted",
    8,
    "user-redacted",
    0,
    null,
    null,
    false,
  ],
  // Mark-for-deletion suggestion over "Draft " (positions 1..6, inclusive).
  [
    { ty: "msfd", si: 1, ei: 6 },
    1700000008000,
    "sess-redacted",
    9,
    "user-redacted",
    0,
    null,
    null,
    false,
  ],
];

/**
 * The reconstructed end-of-timeline text: the `iss` suggestion text is included
 * and the `msfd`-marked "Draft " span is excluded from the accepted-view text
 * (existing reconstruction semantics) — the five entity/suggestion-entity ops are
 * isolated and contribute no characters, so the surrounding text stays aligned.
 */
export const CAPTURED_RICH_DOC: CapturedFixture = {
  name: "live-rich-doc (entity ae/te/ue + suggestion iss/msfd + astss/sue)",
  capturedAt: "2026-06-12",
  envelope: { changelog: CHANGELOG },
  expectedFinalText: "text plus suggestion",
};

/** The op codes this fixture proves are isolated via the open-world UnknownOp path. */
export const RICH_DOC_UNKNOWN_OPCODES = ["ae", "te", "ue", "astss", "sue"] as const;
