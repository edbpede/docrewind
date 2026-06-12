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
- [x] Authenticated live capture performed 2026-06-12 (Chromium/Helium-149, throwaway doc; see `docs/protocol-capture.md`). *(Firefox + multi-account + rich-doc captures scoped as follow-ups — Q7/Q8/Q12.)*
- [x] The 12 §24 transport findings recorded in `docs/protocol-capture.md` — answered; no stop-condition fired.
- [x] Credentialed fetch confirmed from the MV3 service-worker context (200/JSON). *(Firefox event page + deterministic SW-termination kill deferred — Q9/Q10/Q12.)*

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
- [x:live] End-of-timeline text equals a **real document's** current text — PROVEN 2026-06-12: the sanitized live capture (`lib/fixtures/captured.ts`) runs through the production pipeline (parse→detect→decode→reconstruct) to exactly `"Probe one two three. Second sentence. Third one."` (`lib/decoder/captured-live.test.ts`).

## 3.4 Timeline

- [x] Session grouping, large-edit/pause detection, confidence + provenance (T5).

## 3.5 Domain + boundaries

- [x] Typed domain model — `lib/domain/*` (T1).
- [x] Pure core free of any `browser.*`/WXT import — enforced by the committed `scripts/check-pure-core.sh` prek hook (T0/T7).

## Cross-cutting acceptance

- [x] "`docs/protocol-capture.md` has **all §24 items answered**" — answered 2026-06-12; transport (Q1–Q10) confirmed, Q11 reclassified to a release gate, Q8/Q9/Q12 code-ready with scoped follow-ups.
- [x] Decoder never imports `lib/protocol`; `decodeOperations` takes already-parsed JSON (R1).
- [x] Two-switch exhaustiveness — decoder `default → UnknownOp` (no `never`); `apply.ts` `never` gate proven by a removed-arm `tsc` error (R2).
- [x] Privacy — `UnknownOp` = `opCode` + `byteLength` only; no `.raw` in any diagnostic path (R5).
- [x] Validating branded-id constructors reject malformed ids (R8).
- [x] `prek.toml` `bun-logic-tests` re-enabled; `check-pure-core` wired; no globbed dir empty at any commit (R9, R10).
- [DEFERRED:Phase 6] ≥85% line coverage on parser/reconstruction — vitest-v8 feature owned by Phase 6; not claimed here (R7).
- [x] "No §24 stop-condition present" — CONFIRMED 2026-06-12 against the live endpoint: JSON (not protobuf), direct endpoint (no `batchexecute`), cookie-only read (no new page-derived token), no endpoint-restriction guidance. None fired (R11).

## Deviations from the plan (flagged for review)

1. **`lib/decoder/types.ts` landed in the T1 commit** (not T3). The pure type-only `Operation` union is a shared foundation that `lib/domain/model.ts` and the reconstruction engine both depend on; introducing it with the domain types keeps every commit compiling (types-before-implementation). The decode *runtime* (`decode.ts`) still lands in T3.
2. **`test:logic` glob includes `./lib/protocol`.** The plan's T0 glob listed only the four pure dirs, but the protocol `framing`/`schema-detect`/`endpoints` tests are bun pure-logic tests (per the plan's own test-tiering table). Without `lib/protocol` in the glob they would never execute — a silent-coverage gap the plan's Pre-mortem #1 warns against. Vitest already excludes the bun-owned subdirs.
3. **Added `@types/bun` + a `tsconfig` types entry** so the `bun:test` logic files type-check under `tsc --noEmit`, and **excluded the bun-owned pure-core subdirs from Vitest** (they import `bun:test`, which Vitest cannot resolve). Required to keep all four gates green together.

## Resolution note (§24 capture landed 2026-06-12)

The §24 live capture was performed (authenticated, Chromium/Helium-149, throwaway
doc; `docs/protocol-capture.md`) and **no stop-condition fired** — the endpoint
returns `)]}'`-guarded JSON (not protobuf), directly (no `batchexecute`), readable
with the session cookie alone (no new page-derived token), and Google has published
no restriction. The transport facts are encoded in `lib/protocol/*`; the decoder
gained a tuple-envelope adapter for the real wire format; and the end-of-timeline
text-equality MUST (§15.3) is now PROVEN on a sanitized live capture through the
production pipeline. The credentialed `revisions/load` read was verified from the
built extension's MV3 service-worker context.

**Remaining live items — updated by the 2026-06-12 Firefox follow-up.** Now CLOSED
live in Firefox (Firefox 151 + `firefox-devtools` MCP): the rich/suggesting-doc op
capture (Q7 — `iss`/`msfd` suggestions + in-band `ae`/`te`/`ue` entity ops; decoder
unchanged + sanitized fixture/test added), the multi-account `/u/1/` read (Q8), and
the Firefox first-party credentialed read + affordance mount (Q10/Q12). STILL OPEN
(documented MCP-tooling limits, not blockers): the Firefox **extension-background**
credentialed fetch and a **deterministic SW/event-page-termination kill** on a large
doc. Phase 4 network retrieval is **unblocked**.
