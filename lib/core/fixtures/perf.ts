// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Perf-shaped fixture builder (plan T6 / R3). Generates a many-revision corpus
// near the PRD ~10k-revision budget (§17/§18) so tests can guard that `stateAt`
// stays a single O(N) filter with no per-revision physical mutation. True
// wall-clock/memory validation against real corpora is [BLOCKED:live]; the
// algorithmic-shape guard runs now. Deterministic (no Math.random).

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

export interface GeneratedCorpus {
  readonly changelog: ReadonlyArray<Record<string, unknown>>;
  readonly expectedFinalText: string;
}

/**
 * Build a corpus of `n` single-character appends. The i-th (0-indexed) insert
 * appends one char just before the EndOfBody sentinel (ibi = i + 1), so the
 * final text is the concatenation of the generated characters.
 */
export function buildLinearInsertCorpus(n: number): GeneratedCorpus {
  // Guard a non-negative safe integer so n=Infinity can't hang the loop and
  // n=NaN/-1 can't silently yield an empty corpus; n=0 stays a valid degenerate
  // case. TypeError mirrors the numeric-validation precedent in
  // lib/core/domain/ids.ts (asRevisionId rejects non-integer/Infinity the same way).
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new TypeError("buildLinearInsertCorpus: expected a non-negative safe integer");
  }
  const changelog: Array<Record<string, unknown>> = [];
  let expected = "";
  for (let i = 0; i < n; i++) {
    const char = ALPHABET[i % ALPHABET.length] ?? "a";
    changelog.push({ ty: "is", s: char, ibi: i + 1, revision_id: i + 1 });
    expected += char;
  }
  return { changelog, expectedFinalText: expected };
}
