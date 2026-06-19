// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Synthetic fixture corpus (plan T6 / R4, R12). The single canonical fixtures
// home, shared by the decoder + reconstruction tests.
//
// IMPORTANT (R4): every `expectedFinalText` is computed BY HAND from the
// Appendix A.2 prose splice/pop/tombstone rules — NEVER by running apply.ts and
// snapshotting its output (that would be a tautology). `a2RuleNotes` records the
// rule applied per fixture. These fixtures deliberately do NOT copy any
// `gdocrevisions` sample data/vectors: that would copy MIT-licensed material and
// be a tautology (our decoder is itself ported from that grammar).
//
// Live-wire validation against a real document's current text remains
// [BLOCKED:live] on the §24 capture (see README.md).

/** One hand-authored fixture: a wire changelog + its hand-derived end text. */
export interface Fixture {
  readonly name: string;
  readonly changelog: ReadonlyArray<Record<string, unknown>>;
  readonly expectedFinalText: string;
  readonly a2RuleNotes: string;
}

export const FIXTURES: readonly Fixture[] = [
  {
    name: "single-insert",
    changelog: [{ ty: "is", s: "Hello", ibi: 1, revision_id: 1 }],
    expectedFinalText: "Hello",
    a2RuleNotes: "is splices s at ibi-1 (1-indexed); empty doc -> 'Hello'.",
  },
  {
    name: "single-delete",
    changelog: [
      { ty: "is", s: "Hello world", ibi: 1, revision_id: 1 },
      { ty: "ds", si: 1, ei: 6, revision_id: 2 },
    ],
    expectedFinalText: "world",
    a2RuleNotes: "ds pops the inclusive si..ei range; 'Hello ' (1..6) -> 'world'.",
  },
  {
    name: "nested-mlti",
    changelog: [
      {
        ty: "mlti",
        revision_id: 1,
        mts: [
          { ty: "is", s: "ab", ibi: 1 },
          { ty: "mlti", mts: [{ ty: "is", s: "c", ibi: 3 }] },
        ],
      },
    ],
    expectedFinalText: "abc",
    a2RuleNotes: "mlti recurses depth-first; 'ab' then 'c' before EOB -> 'abc'.",
  },
  {
    name: "suggestion-lifecycle (iss/msfd/usfd)",
    changelog: [
      { ty: "is", s: "Hello", ibi: 1, revision_id: 1 },
      { ty: "is", s: " world", ibi: 6, revision_id: 2 },
      { ty: "ds", si: 1, ei: 6, revision_id: 3 },
      { ty: "iss", s: "!", ibi: 6, revision_id: 4 },
      { ty: "msfd", si: 1, ei: 5, revision_id: 5 },
      { ty: "usfd", si: 1, ei: 5, revision_id: 6 },
    ],
    expectedFinalText: "world!",
    a2RuleNotes:
      "iss is a visible suggested insert; msfd hides 'world' WITHOUT deleting; usfd restores -> 'world!'.",
  },
  {
    name: "suggestion-delete (dss)",
    changelog: [
      { ty: "is", s: "abcdef", ibi: 1, revision_id: 1 },
      { ty: "dss", si: 1, ei: 3, revision_id: 2 },
    ],
    expectedFinalText: "def",
    a2RuleNotes:
      "dss marks 1..3 ('abc') for suggested deletion (hidden from current text), not a hard pop -> 'def'.",
  },
  {
    name: "opaque-positioning",
    changelog: [
      { ty: "is", s: "AB", ibi: 1, revision_id: 1 },
      { ty: "opaque", structure: "image", position: 2, revision_id: 2 },
      { ty: "is", s: "C", ibi: 4, revision_id: 3 },
    ],
    expectedFinalText: "ABC",
    a2RuleNotes:
      "opaque occupies a position slot (between A and B) but renders no text; later insert sees the shifted positions -> 'ABC'.",
  },
  {
    name: "unknown-op-isolation",
    changelog: [
      { ty: "is", s: "Hi", ibi: 1, revision_id: 1 },
      { ty: "zz_future_op", payload: "ignored", revision_id: 2 },
      { ty: "is", s: "!", ibi: 3, revision_id: 3 },
    ],
    expectedFinalText: "Hi!",
    a2RuleNotes:
      "an unrecognized op is isolated as UnknownOp and never mutates text; surrounding inserts -> 'Hi!'.",
  },
  {
    name: "multi-revision-corpus",
    changelog: [
      { ty: "is", s: "The quick fox", ibi: 1, revision_id: 1 },
      { ty: "is", s: " brown", ibi: 10, revision_id: 2 },
    ],
    expectedFinalText: "The quick brown fox",
    a2RuleNotes:
      "second insert at ibi=10 splices ' brown' before the space preceding 'fox' -> 'The quick brown fox'.",
  },
  {
    name: "template-base via rplc (revision-1 bulk load)",
    changelog: [
      { ty: "rplc", snapshot: [{ ty: "is", s: "Question: ", ibi: 1 }], revision_id: 1 },
      { ty: "is", s: "Answer", ibi: 11, revision_id: 2 },
    ],
    expectedFinalText: "Question: Answer",
    a2RuleNotes:
      "rplc resets the body then applies its embedded snapshot ('Question: ', 10 chars); the rev-2 insert at ibi=11 (the live position past the template) appends -> 'Question: Answer'. Dropping rplc loses the base and misplaces every later edit (the 'garbled' bug).",
  },
];
