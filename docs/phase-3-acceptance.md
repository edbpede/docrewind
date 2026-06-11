# Phase 3 — Honest Acceptance Map & Escalation

> Plan: `.omc/plans/phase-3-core-plan.md`. Branch: `feat/phase-3-core`.
> `[x]` = delivered + agent-verified. `[BLOCKED]` = human-only, escalated.
> `[DEFERRED]` = owned by a later phase, intentionally not claimed here.

## Verification snapshot (all commands run on `feat/phase-3-core`)

| Gate | Command | Result |
|---|---|---|
| Type-check | `bun run compile` (`tsc --noEmit`) | clean |
| Lint/format | `bun run check` (biome) | clean; `lib/` idempotent; no `any`/`@ts-ignore` |
| Pure-logic tests | `bun run test:logic` | 78 pass / 0 fail (7 files) |
| Component/storage tests | `bun run test:run` (vitest) | 1 pass (Phase-2 smoke; no Phase-3 vitest specs) |
| Purity guard | `bash scripts/check-pure-core.sh` | exit 0, no output |
| Decoder↔protocol seam | `grep -rn lib/protocol lib/decoder` | nothing |
| `stripGuard` location | `grep -rn stripGuard lib/decoder` | nothing (lives in `lib/protocol/framing.ts`) |
| Privacy `.raw` guard | `grep -rn '\.raw' lib/decoder lib/domain` | nothing |
| Two-switch `never` gate | remove an `apply.ts` arm → `tsc` | `TS2322: ... not assignable to type 'never'` |
| SPDX headers | every `lib/**/*.ts` | AGPL-3.0-or-later present |
| MIT attribution | `lib/decoder/{decode,types}.ts` | present alongside AGPL |

## 3.1 Protocol live-capture gate

- [x] Isolated protocol skeleton — `lib/protocol/{types,framing,endpoints,discovery,schema-detect}.ts` (T2).
- [x] Fail-safe schema detection mechanism — `detectSchema` gates the hand-off; unknown shapes never reach the decoder (T2).
- [x] Stop-condition wiring + blast-radius doc — `docs/protocol-capture.md` + plan Pre-mortem #3.
- [BLOCKED] Authenticated live capture in Chrome + Firefox against three docs — needs the maintainer's logged-in multi-account session + DevTools.
- [BLOCKED] The 12 §24 transport findings recorded in `docs/protocol-capture.md` — template authored `[x]`; **answers BLOCKED**.
- [BLOCKED] Credentialed fetch from MV3 SW + Firefox event page; SW termination mid-fetch — runtime human observation.

## 3.2 Decoder

- [x] `stripGuard` strips `)]}'` fail-safe — in `lib/protocol/framing.ts`, NOT the decoder (R1, T2).
- [x] `decodeOperations(parsed: unknown)` decodes the A.2 grammar via the open-world wire-`ty` funnel; `default → UnknownOp`, no `never` (R1, R2, T3).
- [x] Branded `DocId`/`RevisionId` with validating constructors (R8, T1/T3).
- [x] Opaque placeholders for non-text structures; never abort (T3).
- [x] Unknown ops isolated + marked, privacy-safe (`opCode` + `byteLength`, no raw text) — test asserts a planted secret never survives (R5, T3).
- [x] `noUncheckedIndexedAccess`-safe (T3).

## 3.3 Reconstruction

- [x] Flat tombstone char-array model; required `suggestionState`; EndOfBody sentinel (R3, R6, R12, T4).
- [x] Apply semantics with the closed-world `never` gate in `apply.ts`; `is` splice, `ds` tombstone, `msfd`/`dss` mark (no `deleteRevision`), `usfd` reset, `mlti` recurse, `opaque`/`unknown` explicit arms (R2, R3, T4).
- [x] Snapshots (N=100 cadence) + O(N) `stateAt` filter (T4).
- [x:hand-derived] End-of-timeline text equals hand-derived expected text on the synthetic corpus (A.2 prose, not snapshotted output) (R4, T6).
- [x:internal] decode→reconstruct + snapshot-scrub round-trip self-consistency (R4, T6).
- [BLOCKED:live] End-of-timeline text equals a **real document's** current text — needs the live capture; escalated (R4).

## 3.4 Timeline

- [x] Session grouping, large-edit/pause detection, confidence + provenance (T5).

## 3.5 Domain + boundaries

- [x] Typed domain model — `lib/domain/*` (T1).
- [x] Pure core free of any `browser.*`/WXT import — enforced by the committed `scripts/check-pure-core.sh` prek hook (T0/T7).

## Cross-cutting acceptance

- [BLOCKED] "`docs/protocol-capture.md` has **all §24 items answered**" — file exists `[x]`; **answers BLOCKED** (the gating human deliverable).
- [x] Decoder never imports `lib/protocol`; `decodeOperations` takes already-parsed JSON (R1).
- [x] Two-switch exhaustiveness — decoder `default → UnknownOp` (no `never`); `apply.ts` `never` gate proven by a removed-arm `tsc` error (R2).
- [x] Privacy — `UnknownOp` = `opCode` + `byteLength` only; no `.raw` in any diagnostic path (R5).
- [x] Validating branded-id constructors reject malformed ids (R8).
- [x] `prek.toml` `bun-logic-tests` re-enabled; `check-pure-core` wired; no globbed dir empty at any commit (R9, R10).
- [DEFERRED:Phase 6] ≥85% line coverage on parser/reconstruction — vitest-v8 feature owned by Phase 6; not claimed here (R7).
- [PARTIAL] "No §24 stop-condition present" — none observed in source, but only the live capture can **confirm** it; recorded as provisionally-clear, BLOCKED on capture (R11).

## Deviations from the plan (flagged for review)

1. **`lib/decoder/types.ts` landed in the T1 commit** (not T3). The pure type-only `Operation` union is a shared foundation that `lib/domain/model.ts` and the reconstruction engine both depend on; introducing it with the domain types keeps every commit compiling (types-before-implementation). The decode *runtime* (`decode.ts`) still lands in T3.
2. **`test:logic` glob includes `./lib/protocol`.** The plan's T0 glob listed only the four pure dirs, but the protocol `framing`/`schema-detect`/`endpoints` tests are bun pure-logic tests (per the plan's own test-tiering table). Without `lib/protocol` in the glob they would never execute — a silent-coverage gap the plan's Pre-mortem #1 warns against. Vitest already excludes the bun-owned subdirs.
3. **Added `@types/bun` + a `tsconfig` types entry** so the `bun:test` logic files type-check under `tsc --noEmit`, and **excluded the bun-owned pure-core subdirs from Vitest** (they import `bun:test`, which Vitest cannot resolve). Required to keep all four gates green together.

## Escalation note (to the maintainer)

Phase 3's pure core (decoder, reconstruction, timeline, domain) and the protocol
skeleton are delivered and fully tested against synthetic fixtures. **The
following is BLOCKED and requires you:** an authenticated live network capture in
current Chrome **and** Firefox against three real Google Docs (simple text; a
rich doc with images/tables/footnotes/equations/lists; a multi-account `/u/1/`
session), filling in the 12 §24 fields in `docs/protocol-capture.md`, confirming a
credentialed fetch from an MV3 service worker + Firefox event page, and observing
SW termination mid-fetch. **HALT the whole approach** if the capture shows:
protobuf instead of JSON, a `batchexecute` wrapper, a new mandatory page-derived
read token, or Google guidance restricting the editor endpoints (§24
stop-conditions). Until the capture lands, Phase 4 (network retrieval) cannot be
safely started.
