<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Handoff — finish Google Sheets replay (live capture + the capture-gated arms)

> **You are an executing agent running locally on macOS** with browser access via
> the **authenticated-session runbook** (Helium/Chromium CDP, or Firefox MCP).
> The Sheets replay feature is **built and fully green on unit/component/e2e + both
> MV3 builds**, on branch **`feat/sheets-support`**. What remains can only be done
> with a *live authenticated Google session*: confirm four scope-bounding probes,
> reverse-engineer four un-captured op families, validate end-to-end in a real
> browser, and pin the real wire bytes as fixtures.
>
> Work the phases in order. Each ends with a **checkpoint** you must verify before
> continuing. Do not weaken any gate or fabricate a capture — if an action can't be
> triggered, record that and leave the op `SheetsUnknownOp` (it already degrades to
> a calm fidelity notice).
>
> **This file is a transient handoff — delete it before the PR merges.**

---

## 0. Ground truth + setup

- Plan: `.omc/plans/sheets-full-support-plan.md`
- Wire-format findings (extend this as you capture): `.omc/plans/sheets-ritz-format-findings.md`
- Authenticated-browser runbook: you have it (Part A Helium/CDP, Part B Firefox MCP).
  Everywhere it targets the **Docs** test doc, swap in the **Sheets** targets below.

**Sheets targets** (from the findings capture):
- Controlled / throwaway (use this to capture single ops): `1Uon749mO7jlN2MLxr1fPWwt0QjtKXhxq4n5ckNknWA8`
- Read-only test sheet: `1Nn7RedsBpqcwARNdeCfL_HIvuSLkV-ybSwfTXlqzJGg`
- Edit URL shape: `https://docs.google.com/spreadsheets/d/<ID>/edit`

```bash
cd <your-checkout>/docrewind
git fetch origin && git checkout feat/sheets-support && git pull --ff-only
bun install --frozen-lockfile
bun run build            # → .output/chrome-mv3  (load this unpacked)
bun run build:firefox    # → .output/firefox-mv3 (Part B)
```

**Bun-only.** Never npm/pnpm/yarn. Privacy invariant is load-bearing: `permissions`
stays `["storage"]`, `host_permissions` stays `["*://docs.google.com/*"]`, no new
host/network target, system fonts only. Diagnostics/fixtures are **content-free**:
opcodes, byte lengths, shapes — never cell text.

---

## 1. What is already DONE (do not redo)

- Parallel pure cores: `lib/sheets-decoder/` (grammar) + `lib/sheets-reconstruction/`
  (grid model, `apply` with a closed-world `never` gate, snapshot via the shared
  `lib/replay-core` spine, `render`, `number-format`, summary/timeline extractors).
- Routing: `DocumentKind` discriminator through `lib/docs-url`, `lib/protocol/endpoints`,
  `lib/messaging`, `lib/worker/pipeline` (sheets pipeline), `lib/replay/load`
  (kind-branched load + publish), storage (`lib/store` / `lib/db` / `lib/db.memory`
  with an independent `SHEETS_PARSER_VERSION` + kind-aware active pointer;
  `lib/db.contract` covers legacy-doc / sheet / stub).
- Entrypoints: same-host `*://docs.google.com/spreadsheets/*` content-script match,
  background fetch/discovery/identity threaded by kind, parse worker kind branch,
  Classroom embedded-sheet detection.
- UI: `components/GridViewport.tsx` (row-virtualized accessible `<table>`,
  formulas-as-text, number-format rendering, calm §9 fidelity notice),
  `components/SheetTabs.tsx`, `entrypoints/replay/App.tsx` `currentGrid` memo (Docs
  memos untouched). Summary page + colophon derive per-kind.

**Opcodes already decoded** (`lib/sheets-decoder/types.ts` → `SHEETS_OPCODE`,
matched against `modelVersion` baseline **99** in `lib/sheets-decoder/version.ts`):

| Opcode | Meaning |
|---|---|
| `4444216` | transaction wrapper |
| `21299578` | cell mutation (value/formula/clear + bold + number-format) |
| `21350203` | add sheet |
| `26812461` | rename sheet |
| `24502104` / `25037233` | insert / delete rows-cols |
| `25813757` | cell-style-adjust (recognized inert) |
| `28950036` | settings (inert) |
| `25104121` / `149980211` | snapshot/metadata markers (inert) |
| anything else | `SheetsUnknownOp` → fidelity notice |

**Still gated (your mission):** the four probes + **merge / conditional-format /
chart / image** opcodes, plus a live end-to-end run and real-bytes fixtures.

---

## 2. Phase 1 — Authenticated browser + the existing feature live

Bring up the authenticated session per the runbook (Part A Helium/CDP preferred),
but with the **Chromium build of DocRewind** loaded and the **Sheets** target:

```bash
EXT="$(pwd)/.output/chrome-mv3"
SHEET="https://docs.google.com/spreadsheets/d/1Uon749mO7jlN2MLxr1fPWwt0QjtKXhxq4n5ckNknWA8/edit"
# …runbook Phase 1–3 (copy profile, launch real Helium with --load-extension="$EXT",
#   agent-browser connect 9222)…
agent-browser open "$SHEET" && agent-browser wait --load networkidle
agent-browser get title       # must be the sheet's real title, NOT "Sign in"
agent-browser screenshot /tmp/dr-sheet-1-button.png
```

**Checkpoint 1a — button injection.** The screenshot shows DocRewind's
**"Replay revisions"** button in the Sheets toolbar (the content script now matches
`/spreadsheets/`). If absent: confirm `entrypoints/docs.content.tsx` `matches`
includes `*://docs.google.com/spreadsheets/*` and the build is fresh.

**Checkpoint 1b — replay end-to-end.** Click the button (it `sendMessage`s
`activateReplay` with `kind:"sheet"`; background opens `replay.html?...&kind=sheet`).
On the replay tab, verify:
- the grid renders cell values, a formula shows as its text (e.g. `=SUM(...)`),
- the **sheet tabs** switch sheets,
- scrubbing the timeline rebuilds the grid per revision,
- if anything degraded, the calm "Some content couldn't be fully reconstructed"
  notice appears (and only then).

Capture `agent-browser screenshot /tmp/dr-sheet-2-replay.png`. Record pass/fail per
bullet in your write-up.

> If the replay tab can't be reached via agent-browser tab control, open
> `chrome-extension://<id>/replay.html?doc=<ID>&kind=sheet` directly.

---

## 3. Phase 2 — Pin the REAL wire bytes as fixtures (strongest regression)

The findings capture saved raw `revisions/load` bodies on the original machine:
`/tmp/sheets-rev-full.json` and `/tmp/own-rev-full.json`. Re-capture fresh ones now
(authoritative), from the authenticated tab's console (or `agent-browser` JS eval):

```js
// Run in the authenticated docs.google.com tab. Same-origin, credentialed.
async function dump(id) {
  // 1) discover the revision count from the bootstrap
  const boot = await (await fetch(`https://docs.google.com/spreadsheets/d/${id}/edit`, {credentials:"include"})).text();
  const n = Number((boot.match(/"revision":(\d+)/) || [])[1]);
  // 2) pull the whole changelog
  const body = await (await fetch(`https://docs.google.com/spreadsheets/d/${id}/revisions/load?id=${id}&start=1&end=${n}`, {credentials:"include"})).text();
  return { n, body };          // body is `)]}'`-framed JSON — exactly what the pipeline consumes
}
const out = await dump("1Uon749mO7jlN2MLxr1fPWwt0QjtKXhxq4n5ckNknWA8");
console.log(out.n, out.body.length); copy(out.body);   // paste into a file
```

Save raw bodies under `.omc/captures/` (gitignored scratch) — e.g.
`.omc/captures/own-rev-full.txt`. Then validate against the **real** bytes:

```bash
mkdir -p .omc/captures   # put the raw framed body file(s) here
bun -e '
  import { parseFramed } from "./lib/protocol/framing";
  import { runSheetsPipelineOverBodies } from "./lib/worker/pipeline";
  import { decodeSheetsOperations } from "./lib/sheets-decoder/decode";
  const raw = await Bun.file(".omc/captures/own-rev-full.txt").text();
  const res = runSheetsPipelineOverBodies([raw]);   // string body → parseFramed internally
  console.log("pipeline:", res.kind, res.kind === "ok" ? `${res.revisions.length} revs` : res.reason);
  // opcode census — which op families actually appear, and which are UNKNOWN:
  const parsed = parseFramed(raw);
  const revs = decodeSheetsOperations(parsed);
  const tally = {};
  const walk = (op) => { tally[op.op] = (tally[op.op]??0)+1; if (op.op==="txn") op.ops.forEach(walk); };
  for (const r of revs) r.operations.forEach(walk);
  console.log("op census:", tally);
  console.log("unknown opcodes:", revs.flatMap(r=>r.operations).filter(o=>o.op==="unknown").map(o=>o.opCode));
'
```

**Checkpoint 2 — data-backed coverage answer.** `pipeline: ok`, the op census shows
`cell`/`add-sheet`/`rename-sheet`/`insert-dim`/`delete-dim`/`txn`/… as expected, and
the **`unknown opcodes` list is the precise, honest set of un-implemented opcodes**.
Each distinct unknown opcode is a capture target for Phase 4.

Then add a **content-free** fixture test (opcodes/shapes only, never cell text) at
`lib/sheets-decoder/captured-live.test.ts` mirroring the existing
`lib/decoder/captured-live.test.ts` style, asserting: pipeline `ok`, the expected op
families decode, and the worked examples (A2 number, formula-as-text, currency,
bold, add/rename, insert/delete) reconstruct to the right cells via
`buildSheetsReplayIndex` + `gridAtRevisionIndex`.

---

## 4. Phase 3 — The four scope-bounding probes (P-i … P-iv)

For each: do exactly one action on the throwaway sheet, capture the new revision(s)
only (`start=N+1&end=N'`), decode, record the answer in
`.omc/plans/sheets-ritz-format-findings.md`, and apply the stated decision.

- **P-i — cached formula value.** Type `=SUM(A2:A3)` in a fresh cell. Inspect the
  `21299578` PAYLOAD: does it carry a cached **computed number** alongside the
  formula text, or only the text?
  - *Only text* → keep formula-as-text (current behavior). Done.
  - *Cached value present* → extend `decodeContent` (`lib/sheets-decoder/decode.ts`)
    to capture it into `Cell` (`lib/sheets-reconstruction/model.ts`), render the
    value (with a formula affordance) in `GridViewport`, and add a test.

- **P-ii — formula ref rewrite on structural edits.** Put `=A5` in A1, then insert a
  row above row 5. Capture the revision: does it emit companion `21299578`s that
  **rewrite** the formula (`=A6`), or only the `25813757` style companion?
  - *No rewrite* → the staleness gap stands: keep formula-as-text and the documented
    note in §0 (already implemented; no silent-wrong rewriting).
  - *Rewrite present* → it already replays through `applyCellMutation`; add a test
    proving the formula text updates, and drop the staleness caveat from the docs.

- **P-iii — base seed (`chunkedSnapshot`).** Fetch a window that starts mid-history
  (`start=K&end=N`, `K>1`). Does the `chunkedSnapshot` carry base **cell ops** the
  grid must seed from? Confirm `decodeSheetsSnapshot` (`lib/sheets-decoder/decode.ts`)
  decodes them and `buildSheetsReplayIndex(..., baseOps)` seeds `snapshot(0)`
  correctly (it should — verify with a mid-window fixture test).

- **P-iv — gid stability.** Add a sheet, rename it, reorder it, delete another.
  Capture each. Confirm the `gid` string is a **stable identity** across rename +
  reorder (the model's `order: Gid[]` + `Map<Gid, SheetGrid>` assumes this). Record
  the result; if gids are NOT stable, open an issue — the tab model needs rework.

---

## 5. Phase 4 — Reverse-engineer the un-captured op families

On the throwaway sheet, perform **exactly one** action, capture only the new
revision(s), and identify the opcode:

```js
// after one action, with N = the revision count BEFORE it:
const id = "1Uon749mO7jlN2MLxr1fPWwt0QjtKXhxq4n5ckNknWA8";
const t = await (await fetch(`https://docs.google.com/spreadsheets/d/${id}/revisions/load?id=${id}&start=${N+1}&end=${N+5}`, {credentials:"include"})).text();
const parsed = JSON.parse(t.replace(/^\)\]\}'\n?/, ""));
console.log(JSON.stringify(parsed.changelog.map(e => e[0]), null, 2)); // op arrays; [0] is the opcode
```

Capture all four (each is a `[opcode, args]` array; a `4444216` wrapper may bundle a
few). **Record opcode + arg shape + the live `modelVersion`** in the findings doc:

1. **Merge cells** — select a range, Format ▸ Merge cells.
2. **Conditional formatting** — add one rule (e.g. "greater than 5 → fill").
3. **Insert chart** — Insert ▸ Chart.
4. **Insert image** — Insert ▸ Image ▸ over cells (or in cell).

> **modelVersion:** find it in the bootstrap HTML or the load envelope (search the
> `/edit` source and the `revisions/load` JSON for `modelVersion` / a version int).
> If it differs from **99**, note it — the decoder already raises the R9 soft signal
> on mismatch, but a new baseline may mean opcodes were renumbered: re-confirm the
> known opcodes above before trusting them.

**Only after an opcode is confirmed from a real capture**, implement its arm. Until
then it stays `SheetsUnknownOp` + notice (this is correct, not a bug).

---

## 6. Phase 5 — Implement the confirmed arms (file-by-file map)

For **each** confirmed opcode, in this order (the `never` gate in `apply.ts` forces
you to handle every new union variant — that's the safety rail):

1. `lib/sheets-decoder/types.ts`
   - add the opcode to `SHEETS_OPCODE`;
   - add a `SheetsOperation` variant + extend the union. Suggested shapes:
     - merge → `{ op:"merge"; range: SheetsRange }`
     - conditional format → `{ op:"cond-format"; gid: Gid; ... }` (decode only what's
       confirmed; render approximately or inertly per §0 — exact color math is a v1
       non-goal)
     - chart / image → ONE `{ op:"opaque"; kind:"chart"|"image"; anchor: SheetsRange }`
       mirroring the Docs `OpaquePlaceholder` precedent (no pixels, no fetch).
2. `lib/sheets-decoder/decode.ts` — add a `case SHEETS_OPCODE.X:` arm parsing the
   confirmed arg shape; malformed → `unknownOp(...)` (never throw).
3. `lib/sheets-reconstruction/model.ts` — add the state the op needs. The current
   `SheetGrid` has only `name/cells/rowCount/colCount`; **add** as needed:
   - `merges: SheetsRange[]` (clone in `cloneSheet`),
   - `placeholders: { kind:"chart"|"image"; anchor: SheetsRange }[]` for charts/images,
   - conditional-format state if you decode it.
   Keep `cloneModel`/`cloneSheet` deep-copying any new collections (snapshots must
   not alias).
4. `lib/sheets-reconstruction/apply.ts` — add the matching arm in
   `applySheetsOperation` (the `never` default will not compile until you do).
   Structure ops must stay collision-safe (see `remapCells`); a merge/placeholder
   anchored to shifted rows/cols should shift too.
5. `lib/sheets-reconstruction/render.ts` — surface what the UI needs (e.g. a
   `mergeAt(sheet, r, c)` lookup; an `placeholdersFor(sheet)` accessor).
6. `components/GridViewport.tsx` — merges as spanning `<td colSpan/rowSpan>` cells
   (skip the covered cells); charts/images as a **neutral opaque placeholder box,
   label only** (no image bytes, no web font), anchored to the cell/range.
7. Tests: per-op decode fixtures (from the capture), apply correctness, a Vitest
   render assertion, and keep the `lib/sheets-*` per-file coverage **≥85%**.
8. Update `.omc/plans/sheets-ritz-format-findings.md` (move the op from "NOT
   captured" to a documented row with opcode + shape + modelVersion).

---

## 7. Phase 6 — Verify, commit, push

Run the **full §3 gate** (all must pass; a phase is done only when its tier is green
AND every Docs-regression gate it touches stays green):

```bash
bun run compile
bun run test:logic
bun run test:coverage          # ≥85% per-file on decoder/reconstruction/replay-core/sheets-*
bash scripts/check-coverage-gate-disjoint.sh
bun run test:run               # Vitest incl. db.contract (both impls), Grid UI, sheet App path
bun run build && bun run build:firefox
bash scripts/check-pure-core.sh
bash scripts/check-no-foreign-hosts.sh
bun run zip && bun run zip:firefox && bash scripts/verify-manifest.sh   # privacy on shipped bytes
bunx playwright test e2e/network-isolation.spec.ts
bun run check                  # Biome (CI: bunx biome ci .)
```

Then add a **multi-tab Sheets replay e2e** under `e2e/` (mirror
`e2e/replay-*.spec.ts`): build → load → open a `/spreadsheets/` page → assert button
→ open replay → switch tabs → scrub → assert grid rebuild. Keep
`e2e/network-isolation.spec.ts` green (zero network calls during replay).

Commit per Conventional Commits, one logical commit per op family / probe outcome,
e.g.:

```bash
git add -A
git commit -m "feat(sheets): decode + render merged cells (opcode <N>, modelVersion 99)"
# …per family…
git commit -m "docs(sheets): record capture probes P-i..P-iv outcomes"
git push origin feat/sheets-support
```

**Delete this handoff file** (`SHEETS-CAPTURE-HANDOFF.md`) in the final commit before
opening the PR.

---

## 8. Guardrails (do not violate)

- **Privacy:** no new host/permission; one live `fetch` only in
  `entrypoints/background.ts`; diagnostics/fixtures content-free; system fonts only.
- **Closed-world cores:** every new opcode is a typed `SheetsOperation` variant with
  an `apply` arm (the `never` gate enforces it); unrecognized wire opcodes degrade to
  `SheetsUnknownOp` + a calm fidelity notice — never throw, never silently-wrong.
- **Docs path is byte-identical:** never change Docs decode/reconstruct output; the
  pinning tests (`lib/reconstruction/snapshot.test.ts`, decoder/summary/timeline
  tests) are the gate.
- **Coverage from commit one** for `lib/sheets-*` + `lib/replay-core` (≥85% per file).
- **Honesty over coverage theater:** if an action can't be triggered or an opcode
  can't be confirmed, say so and leave it gated. A wrong guess that ships is worse
  than an honest fidelity notice.
