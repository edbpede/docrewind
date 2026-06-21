<!--
  HANDOFF — Document-Accurate Replay Fidelity
  Internal engineering handoff (not product docs). Safe to exclude from the
  product PR / main if you prefer; it lives in root per the handoff request.
-->

# Handoff — Document-Accurate Replay Fidelity

**Status:** Phase 0 + Phase 1 shipped on a branch. Phases 2–5 are **blocked** on a
live Google Docs wire capture (see [The hard blocker](#the-hard-blocker)).

**Branch:** `feat/replay-paragraph-blocks` (off `main`, pushed to `origin`)
**Commit:** `93666f3` — `feat(viewport): render the reconstructed replay document as paragraph blocks`
**PR (open when ready):** `https://github.com/edbpede/docrewind/pull/new/feat/replay-paragraph-blocks`

---

## 1. Goal

Make the replay/revision view (`entrypoints/replay/App.tsx` + `components/DocumentViewport.tsx`)
render the reconstructed document so it looks like the **actual Google Doc** being
replayed — real page, paragraphs, headings, bold/italic, alignment, lists, and
sized placeholders for tables/images — **without breaking** the pure reconstruction
core or the local-first / privacy guarantees.

### The reframing finding (why this is achievable)
The formatting we want **already arrives on the wire and is currently discarded.**
A rich Google Doc's `revisions/load` changelog carries (per `lib/fixtures/captured-rich.ts`
+ `lib/decoder/captured-rich.test.ts`):

- `as` / `astss` — **ApplyStyle** ops: `{ ty, st:"paragraph"|"text"|"list", si, ei, sm:{…} }`.
  `st` is the style scope; `sm` is the opaque style map carrying the real
  properties (bold/italic/font/size/alignment/heading level). Today the whole op
  degrades to `UnknownOp` via the open-world funnel (`lib/decoder/decode.ts`
  `default -> unknownOp`).
- `ae` / `te` / `ue` / `sue` — **entity** ops for embedded objects
  (image/table/footnote/equation/list): `ae` defines, `te` places at `spi`
  (string-position-index), `ue`/`sue` update `epm` (entity property map:
  dimensions, rows/cols). All currently dropped as `UnknownOp`, which is **why
  rich docs render flat** (images/tables vanish entirely).

**Hard limits (permanent non-goals):** image pixels and remote fonts are
unobtainable — `host_permissions` is `docs.google.com` only
(`scripts/check-no-foreign-hosts.sh` + `e2e/network-isolation.spec.ts` forbid any
other network target), and `DESIGN.md` mandates system-fonts-only. Images stay
sized placeholders; fonts map to system stacks.

---

## 2. The approved plan (authoritative)

Consensus plan produced via `ralplan` (Planner -> Architect -> Critic, two
rounds), deliberate mode (privacy/PII surface). **Read it before doing Phase 2+:**

- Final plan + ADR: `.gjc/plans/ralplan/2026-06-20-2221-baf5/pending-approval.md`
- Full stage history (planner, architect, critic, revision): `.gjc/plans/ralplan/2026-06-20-2221-baf5/stage-*.md`

Execution is tracked under `.gjc/ultragoal/` (goals.json + ledger.jsonl); the
Phase 0/1 stories (G001, G002) are `complete` with verified receipts. Evidence
artifacts live under `.gjc/ultragoal/artifacts/g001/` and `g002/`.

> Note: `.gjc/` is git-ignored (runtime state). The plan/artifacts are local to
> the machine that ran the workflow. The plan body is reproduced in the ADR if you
> need it portable.

---

## 3. Architecture spine & invariants (MUST hold every phase)

These are non-negotiable; every phase below is designed around them.

1. **Single-arg reconstruction.** `segmentsAt(model)` and the new `blocksAt(model)`
   take the model ONLY — no `t`/index. `modelAtRevisionIndex(index, n)`
   (`lib/reconstruction/snapshot.ts`) does ALL time-travel. Mixing the
   applied-count scale with the wire `RevisionId` scale corrupts the view (the
   original `tFromIndex` bug). **All new formatting lives on the model element**
   (like `suggestionState` today), so it time-travels for free. See the docblocks
   in `lib/reconstruction/render.ts` and `CLAUDE.md`.
2. **Frozen reconstructed text.** Formatting is purely additive. It must never
   change reconstructed text, character counts, or live/physical indices.
   `lib/reconstruction/render.test.ts` (concatenation invariant) and
   `lib/decoder/captured-live.test.ts` (end-of-timeline verbatim) must stay green.
3. **Closed-world stays closed.** `lib/reconstruction/apply.ts` switches over the
   typed `Operation` union with a `never` default — adding a union variant forces
   an apply arm AND a decode arm. `UnknownOp` remains the only escape hatch.
4. **Privacy by allowlist (R5 / PRD §13.7).** `sm`/`epm` MUST pass through an
   extractor whose OUTPUT TYPES are closed unions/numbers/booleans only — never the
   raw map, never verbatim text, no open string fields at the type level. Unknown
   shapes degrade to `UnknownOp` (which carries only opcode + byteLength).
5. **Pure core stays browser-free.** `lib/{decoder,reconstruction,timeline,domain,protocol,fixtures}`
   import no `#imports`/`browser`/`wxt`; the live `fetch` lives only in
   `entrypoints/background.ts`. Enforced by `scripts/check-pure-core.sh`.
6. **Coverage floor.** Any new file in `lib/decoder` or `lib/reconstruction` clears
   85% line+function from its first commit (`bunfig.toml`; Bun has no aggregate
   grace). `bun run test:coverage` gates decoder+reconstruction.
7. **SolidJS idioms.** Components run once; read signals in JSX; `<Index>`/`<Show>`
   (not `.map()`/ternaries); never destructure props; no `useState`/`useEffect`.
8. **Bun-only.** Never `npm`/`npx`/`pnpm`. `manifest.json` is generated by WXT
   (never hand-authored).

---

## 4. What's been done (Phase 0 + Phase 1)

### Phase 0 — page-geometry tokens (pure CSS)
- `uno.config.ts`: added `--dr-page-width: 816px` and `--dr-page-margin: 96px` to
  the shared `:root,:host` preflight; rewrote the `.dr-leaf` shortcut to consume
  them (`max-w-[var(--dr-page-width)]`, `lg:px/py-[var(--dr-page-margin)]`)
  replacing hardcoded literals. `.doc-column` intentionally unchanged (it is
  `w-full`, filling the leaf box by design — no width/margin literal to tokenize).
- Effect: one source of truth for the US-Letter page box; visually identical;
  unblocks the Phase 5 paper-appearance toggle.

### Phase 1 — paragraph blocks (zero new decode; the structural foundation)
The replay rendered as one flat `white-space: pre-wrap` slab. It now renders real
paragraph blocks, setting up Phase 2+ to attach paragraph/char style.

- **NEW `lib/reconstruction/blocks.ts`** — pure `blocksAt(model): readonly Block[]`.
  Wraps the **untouched** `segmentsAt(model)` and regroups its flat runs into
  `Block { kind: "paragraph"|"embed"; runs: readonly BlockRun[] }` where
  `BlockRun = Segment & { seq }` (global, contiguous, unique document-order seq).
  Rules:
  - `accepted-text`/`suggested-insert` runs split on `\n`, **keeping the `\n` on
    the left part** so no character is dropped — the plain concatenation invariant
    therefore mirrors `render.test.ts` exactly.
  - `marked-for-deletion` runs are kept WHOLE (struck text is excluded from
    `currentText`, so a suggestion-deleted paragraph mark must not forge a
    boundary).
  - `opaque-placeholder` -> its OWN `embed` block (deterministic boundaries; true
    inline-image fidelity deferred — plan decision).
  - A trailing `\n` emits a final empty paragraph (N newlines -> N+1 blocks).
- **NEW `lib/reconstruction/blocks.test.ts`** — bun:test, **100% line+function**.
  Covers the concatenation invariant over the `FIXTURES` corpus, paragraph
  splitting (N+1 / trailing / consecutive newlines), opaque-embed own-block,
  struck-run-kept-whole, contiguous-unique seq, and **snapshot-path == linear-path**
  (cadence=2; proves blocks derive purely from the time-traveled model).
- **`components/DocumentViewport.tsx`** — prop `segments` -> `blocks`. Render is
  now nested `<Index each={blocks}>` -> `<p class="doc-block">` / `<div class="doc-block-embed">`
  -> inner `<Index each={runs}>` -> `renderRun`. The writing-caret latch migrated
  from segment-array-index (`caretIndex`) to **last-match-in-document-order on the
  global run `seq`** (`caretSeq`). `renderRun(run, isLast)` takes ACCESSORS (reads
  inside reactive scopes — the `<Index>` position-keying contract) and strips one
  trailing `\n` from a block's last run for display via `shown()`. `measureCaret`
  still queries `.doc-caret`, so follow-scroll geometry is byte-identical.
  Author highlight still joins on `run.revisions`.
- **`entrypoints/replay/App.tsx`** — `currentSegments` (segmentsAt) ->
  `currentBlocks = createMemo(() => blocksAt(currentModel()))`; passes
  `blocks={currentBlocks()}`. Derivation stays OUT of the component.
- **`uno.config.ts`** — added `.doc-block` ("m-0 min-h-[1.8em]"; resets the `<p>`
  margin, keeps empty paragraphs visible; white-space/wrap/font/leading inherit
  from `.doc-column`) and `.doc-block-embed` ("my-1.5 block").
- **`test/replay.components.test.tsx`** — migrated 22 `DocumentViewport` render
  sites from `segments={X}` to `blocks={blocksOf(X)}` via a small documented
  `blocksOf` helper (wraps a flat single-line run list into one paragraph block
  with seq=index; mirrors blocksAt for newline-free runs). All caret/highlight/
  follow assertions unchanged.
- **NEW e2e regressions:** `e2e/replay-page-geometry.spec.ts` (token resolution +
  816/96 computed geometry + narrow-viewport fluid boundary) and
  `e2e/replay-blocks.spec.ts` (block structure + exact column-text integrity
  end-to-end). Both emit Ultragoal GUI evidence behind `*_EVIDENCE=1` env flags.

### Verification (all green, both stories Architect-approved CLEAR/CLEAR/CLEAR)
`bun run compile` · `bun run check` · `scripts/check-pure-core.sh` ·
`bun run test:logic` (324) · `bun run test:run` (215) ·
`bun run test:coverage` (blocks.ts 100/100; all decoder+reconstruction ≥85) ·
`bun run build` · `bun run test:e2e` (5) · `scripts/verify-manifest.sh` ·
`scripts/check-no-foreign-hosts.sh`.

---

## 5. The hard blocker

**Phase 2 (and 4) cannot start without a real, sanitized `revisions/load` capture
from a rich Google Doc.** Confirmed:

- The committed `lib/fixtures/captured-rich.ts` collapses every `sm`/`epm` map to
  `{}` (sanitization), so there are **no real key shapes in-repo**.
- The upstream grammar this decoder was ported from
  (`harvard-vpal/gdocrevisions/operation.py`) models only the text ops
  (`is/ds/mlti/iss/dss/msfd/usfd`) — it drops styles/entities exactly like we do,
  so it offers **no** `as`/`astss`/`ae`/`te`/`ue` field names.
- Google's internal `sm`/`epm` key names (what marks bold, heading level,
  alignment, list level, image width/height, table rows/cols) are **not publicly
  documented**.

Building the allowlist against guessed key names would be a speculative placeholder
that silently extracts nothing from real wire data — explicitly forbidden by the
plan ("a new sanitized richer fixture with real `sm`/`epm` key shapes is REQUIRED
and lands BEFORE Phase 2 decode wiring").

### How to unblock (requires an authenticated browser session — only a human can)
1. Open a throwaway rich Google Doc. Add: a heading (H1/H2), some bold + italic +
   underlined text, a centered and a right-aligned paragraph, a bulleted AND a
   numbered list, an image, and a 2x3 table. Make ~10 edits across a couple of
   sessions so there are multiple revisions and at least one tracked-change
   (Suggesting mode) edit.
2. In that tab's devtools Network panel, capture the `…/revisions/load?...`
   response body (the `)]}'`-framed JSON changelog). Also grab the `/edit`
   bootstrap if you want discovery realism. (Filter the Network panel to
   `revisions/load`, right-click -> Copy -> Copy response.)
3. Hand the raw body to the next agent / commit it to a scratch path. It will be
   **sanitized** following `lib/fixtures/captured-rich.ts` conventions:
   - `time` -> synthetic monotonic stamps; `userId` -> "user-redacted";
     `sessionId` -> "sess-redacted"; entity/suggestion ids -> "kix.redacted-*".
   - Keep the real **op shapes** (`as`/`astss`/`ae`/`te`/`ue`/`sue`) and the real
     `sm`/`epm` **key names**, but replace any free-text values with synthetic
     in-domain placeholders (e.g. real bold-key with value `true`, real
     heading-key with value `1`). Never commit verbatim document text or real ids.
   - Verify end-to-end text reconstruction still equals the source's visible text
     (as `captured-live.test.ts` does), then add the sanitized fixture + update
     `RICH_DOC_UNKNOWN_OPCODES` expectations.

Until that fixture lands, the only Phase-2-adjacent thing that can be written is
the allowlist module's **privacy mechanism shell** — but it is hollow without the
key names, so it is intentionally NOT started.

---

## 6. Remaining phases (from the approved plan)

Order: 2 -> 3 chain after 1; 4 after 1 (independent of 2/3); 5 after 0
(independent of 1–4). Phase 5 is the next thing that is NOT blocked.

### Phase 5 — document-true appearance toggle (UNBLOCKED — do this next if you want progress without the capture)
- New persisted setting `docAppearance: "theme"|"paper"` in `lib/settings.ts`
  (default "theme").
- Apply as a `data-doc-appearance` attribute on the `.dr-leaf` root in
  `DocumentViewport`; `uno.config.ts` `.doc-*`/`.dr-leaf` consume new
  `--dr-page-bg`/`--dr-page-ink` vars, with a `[data-doc-appearance=paper]`
  override pinning white paper / dark ink even under `.dark` (so dark UI chrome +
  white page coexist).
- `components/theme-sync.ts` `useThemeSync` stays the SOLE `.dark` driver
  (unchanged). `components/ThemeControl.tsx` gains an ADDITIVE control; existing
  3-state widget + its tests stay unchanged.
- Acceptance: paper + `.dark` -> white sheet/dark ink, chrome stays dark; default
  byte-identical to today; setting persists across reload. Depends only on Phase 0.

### Phase 2 — paragraph-scope `as`/`astss` decode (BLOCKED on the fixture)
1. **First deliverable (independent):** NEW pure `lib/decoder/style-allowlist.ts`
   `extractParagraphMarks(sm: unknown): ParagraphMarks | null`, adversarially
   tested against malicious `sm` (verbatim-text keys must be dropped; output keys
   must be a subset of the closed allowlist; non-object -> null). OUTPUT TYPE is
   closed: `ParagraphMarks = { headingLevel?: 0|1|2|3|4|5|6; alignment?:
   "left"|"center"|"right"|"justify"; lineSpacing?: number; listLevel?: number;
   listKind?: "bullet"|"ordered" }` — no open string field at the type level.
2. Add `ApplyStyle` to the `Operation` union (`lib/decoder/types.ts`) +
   a `decode.ts` arm (validate `st`/`si`/`ei`, run `sm` through the allowlist;
   empty extraction -> `unknownOp`).
3. `lib/reconstruction/model.ts`: add `block?: ParagraphMarks` to `TextChar`.
   **CRITICAL:** also edit `cloneElement` (hand-copies fields, ~78-110) to copy
   `block?` (exactOptionalPropertyTypes-safe) or `cloneModel`'s every-100-revision
   snapshot silently drops formatting on scrub. Add a clone-fidelity test and
   extend snapshot-path==linear-path to FORMATTED chars.
4. `lib/reconstruction/apply.ts`: add `applyStyle()` (a clone of `markRange`
   walking live positions `si..ei`) + a switch arm. **Marks are immutable-by-
   replacement + interned/frozen** (assign a fresh frozen object; never mutate in
   place) so the shallow `cloneElement` copy is alias-safe and `marksEqual`
   collapses to `===`. Add an alias test.
5. `blocksAt` reads the block's style from the resolved paragraph-style char and
   emits `heading`/`list` block kinds (widen `BlockKind`).
6. Resolve OPEN QUESTION: which char carries paragraph style — the trailing
   paragraph-mark `\n` or the first char? Confirm against the richer fixture wire
   shape before wiring (this gates the block-style resolution contract).

### Phase 3 — char-scope marks (BLOCKED on the fixture; depends on Phase 2)
- `model.ts`: add `marks?: TextMarks` to `TextChar` (+ `cloneElement` copy).
  `TextMarks = { bold?; italic?; underline?; strikethrough?: boolean; fontFamily?:
  <closed enum>; fontSizePt?: number }` — fontFamily closed enum (no open string).
- `decode.ts` arm for `as`/`astss` `st:"text"` via `extractTextMarks`.
  `apply.ts` `applyStyle` `st:"text"` sets `el.marks` over the range (fresh frozen).
- `render.ts` coalescing: extend the run-break condition (currently kind +
  monotonic-forward) with a `marksEqual` check so a run also breaks when adjacent
  marks differ. Note the run-count growth; `marksEqual` is O(1) on interned marks.
  `Segment` text kinds gain optional `marks`.
- `DocumentViewport` renders marks as inline style. NEW pure `fontStack(family)`
  mapping the closed family enum to a system stack (no network, testable).

### Phase 4 — entity ops `ae`/`te`/`ue`(+`sue`) -> block embeds (BLOCKED on the fixture; depends on Phase 1)
- `types.ts`: `AddEntity`/`PlaceEntity`/`UpdateEntity`; NEW
  `lib/decoder/entity-allowlist.ts` -> `EntityProps { widthPx?; heightPx?; rows?;
  cols?: number; structure: OpaqueStructure }` (no open string fields).
- `apply.ts`: an entity registry mutated DURING `applyRevision` — `ae` records
  props, `te` inserts an `OpaqueSlot` at `te.spi` via `insertOpaque` baking a props
  snapshot + id, `ue` mutates the placed slot. All entity state time-travels with
  the model (no render-time correlation; single-arg preserved).
- `blocksAt` emits embed blocks: image -> aspect-ratio sized placeholder (NO
  pixels), table -> skeleton grid from rows/cols (NO cell text), footnote/equation/
  list -> labeled block. Update `captured-rich.test.ts` / `RICH_DOC_UNKNOWN_OPCODES`
  (those opcodes become recognized).
- NON-GOALS: image pixels, remote fonts, table cell text.

---

## 7. Open research / decisions to confirm (mostly need the fixture)
1. **`sm` key names** for headingLevel, alignment, lineSpacing, listLevel/listKind,
   bold/italic/underline/strikethrough, fontFamily, fontSizePt. (Phase 2/3.)
2. **`epm` key names** for image width/height and table rows/cols. (Phase 4.)
3. **Paragraph-style char**: trailing `\n` paragraph-mark vs first char. (Phase 2.)
4. **fontFamily enum scope**: a fixed family->system-stack table (closed enum,
   safest, recommended) vs a sanitized any-string mapping. (Phase 3.)
5. **List rendering**: styled paragraphs with a render-time bullet/number glyph +
   `listLevel` indentation (glyph NOT in model text -> preserves text-equality;
   recommended) vs semantic `<ol>`/`<ul>`. (Phase 2.)
6. **Diagnostics**: a content-free counts-by-opcode counter (recognized-style-ops
   vs degraded-to-UnknownOp), on-device, never transmitted, no ids/text/map
   contents — to prove fidelity decoding actually ran on a real doc.

---

## 8. Verification & workflow notes for the next agent

### Commands (Bun-only)
- `bun run compile` (tsc) · `bun run check` (biome --write) · `bun run test:logic`
  (bun pure) · `bun run test:run` (vitest) · `bun run test:coverage` (85% gate) ·
  `bun run build` then `bun run test:e2e` (Playwright; build first) ·
  `scripts/check-pure-core.sh` · `scripts/check-no-foreign-hosts.sh` ·
  `scripts/verify-manifest.sh`.
- Test-runner split (trips people up): pure logic -> bun:test in
  `lib/{decoder,reconstruction,…}`; components/storage -> vitest in `test/**` and
  `lib/*.test.ts`; assembled extension -> Playwright in `e2e/**`. A new bun-only
  `lib/` subtree must also be added to `vitest.config.ts` `exclude` + the
  `test:logic` path list in `package.json` (NOT needed for files inside the
  existing `lib/reconstruction` / `lib/decoder` dirs).

### Re-running the planning/execution workflow
- Phase 2+ should go back through `ralplan` only if the approach changes; the
  existing plan already covers it. To execute, use `ultragoal` (it gates each
  story behind a hardened completion gate: ai-slop sweep + architect review +
  executor QA/red-team with live surface evidence).

### Ultragoal completion-gate evidence contract (hard-won; saves hours)
The `gjc ultragoal checkpoint --status complete` validator is strict. For a
GUI/web surface it requires a transcript AND a non-uniform screenshot:
- **Screenshot MUST be JPEG, not PNG.** The check (`hasNonUniformImageBytes` in
  the runtime) samples the **inflated PNG scanlines**; the airy light UI has large
  flat regions, so a PNG reads as ~98% single-byte and is rejected. A JPEG entropy
  stream is high-variance and passes (the existing e2e specs already capture JPEG
  under `*_EVIDENCE=1`).
- **Automation transcript** (`browser-run.json`) must include `tool` (e.g.
  "playwright") and `actions[]` with `type` and `timestamp` (NOT `action`/`ts`).
- **CLI replay** is conservative: `bun -e` only accepts a `console.log("literal")`
  body (no `fs`). Don't claim a CLI surface for non-CLI work; mark it
  `not_applicable`.
- **Algorithm/math surface** accepts a `test-report` artifact (a captured
  `bun test …` output file is fine; non-live -> just needs to be non-empty).
- `--gjc-goal-json` wants the GJC goal-mode snapshot (`{ goal: { objective,
  status:"active", updatedAt } }`) with a FRESH timestamp, not the
  `.gjc/ultragoal/goals.json` record.
- Agent tools cannot write under `.gjc/**` (runtime-owned); emit evidence from
  inside test/scripts via `node:fs`, or use the sanctioned `gjc` CLI.

---

## 9. File map

| Area | Path | State |
|---|---|---|
| Block grouping (pure) | `lib/reconstruction/blocks.ts` | NEW (Phase 1) |
| Block tests | `lib/reconstruction/blocks.test.ts` | NEW (Phase 1, 100% cov) |
| Viewport render | `components/DocumentViewport.tsx` | CHANGED (blocks + caretSeq) |
| Replay orchestrator | `entrypoints/replay/App.tsx` | CHANGED (currentBlocks) |
| Styles | `uno.config.ts` | CHANGED (page tokens + doc-block) |
| Component tests | `test/replay.components.test.tsx` | CHANGED (blocksOf migration) |
| Geometry regression | `e2e/replay-page-geometry.spec.ts` | NEW (Phase 0) |
| Block regression | `e2e/replay-blocks.spec.ts` | NEW (Phase 1) |
| Segment renderer (UNTOUCHED) | `lib/reconstruction/render.ts` | reference contract |
| Model + tombstones | `lib/reconstruction/model.ts` | Phase 2/3 edit point (`cloneElement`!) |
| Apply (closed-world) | `lib/reconstruction/apply.ts` | Phase 2/3/4 edit point (`markRange`/`insertOpaque` precedents) |
| Decode funnel | `lib/decoder/decode.ts` | Phase 2/4 edit point |
| Op union | `lib/decoder/types.ts` | Phase 2/4 edit point |
| Rich fixture (sm/epm = {}) | `lib/fixtures/captured-rich.ts` | needs a real-shapes sibling |
| Design system | `DESIGN.md` | page spec + system-fonts-only |
| Repo rules | `AGENTS.md` / `CLAUDE.md` | invariants + test split |

---

## 10. TL;DR for the next person
1. Phase 0 + Phase 1 are done, verified, and pushed on `feat/replay-paragraph-blocks`.
2. The replay now renders real paragraph blocks; all reconstruction invariants hold.
3. To go further you NEED a sanitized rich-doc `revisions/load` capture (Section 5).
   It is the gate for Phases 2 and 4.
4. Phase 5 (paper-appearance toggle) is the only remaining phase that is NOT
   blocked — a good standalone next step.
5. Honor the Section 3 invariants and the Section 8 gate contract; don't fabricate
   wire-key shapes.
