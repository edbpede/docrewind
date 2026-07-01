# DocRewind synthetic fixtures

The single canonical fixtures home (plan R12), shared by the decoder and
reconstruction tests. These validate the **grammar + reconstruction logic**
against the source-confirmed Appendix A.2 prose — they are not live captures.

## Three-tier acceptance scheme (R4)

The §15.3 text-equality claim is split into three honestly-labeled tiers:

- **`[x:hand-derived]`** — `expectedFinalText` in `corpus.ts` is computed **by
  hand** from the A.2 splice/pop/tombstone rules; each fixture's `a2RuleNotes`
  cites the rule applied. It is **never** computed by running `apply.ts` and
  snapshotting its output (that would be a tautology). This is the real
  (weak-but-honest) correctness signal.
- **`[x:internal]`** — decode → reconstruct self-consistency and snapshot-scrub
  round-trip (`stateAt(end)` === linear replay), exercised in the reconstruction
  tests.
- **`[BLOCKED:live]`** — equality versus a **real** document's current text.
  This requires the §24 live capture and is escalated to the maintainer; it is
  **not** claimed in Phase 3.

## No `gdocrevisions` sample data (R4)

These fixtures deliberately do **not** copy any `harvard-vpal/gdocrevisions`
sample data or test vectors: doing so would copy MIT-licensed material (which
would have to carry attribution) **and** be a tautology, since our decoder is
itself ported from that grammar. If any such byte were ever used it would carry
the MIT attribution header and be labeled a *consistency* check, never an
*independence* check (PRD §11.6).

## Contents

- `corpus.ts` — hand-authored fixtures: single insert/delete, nested `mlti`,
  suggestion lifecycle (`iss`/`msfd`/`usfd`), suggestion delete (`dss`), opaque
  positioning, unknown-op isolation, and a multi-revision simple corpus.
- `perf.ts` — a builder for a ~10k-revision corpus used to guard the O(N)
  `stateAt` shape (no per-revision physical mutation).
