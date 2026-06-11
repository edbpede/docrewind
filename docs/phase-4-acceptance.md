# Phase 4 — Honest Acceptance Map & §24 Gate

> Plan: `.omc/plans/phase-4-integration-plan.md`. Branch: `feat/phase-4-integration`.
> Scope: **Option A — build unblocked, gate retrieval.** All transport-independent
> work (4A) is delivered + agent-verified; the retrieval orchestration (4B) is
> built behind injected seams and tested with fakes; the live network adapter is
> a pure **stub** pending the §24 live capture.
> `[x]` = delivered + verified. `[ ] BLOCKED §24` = gated on the human-only capture.
> `[DEFERRED]` = owned by a later phase.

## Verification snapshot (all commands run on `feat/phase-4-integration`)

| Gate | Command | Result |
|---|---|---|
| Type-check | `bun run compile` (`tsc --noEmit`) | clean |
| Lint/format | `bun run check` (biome) | clean; `noExplicitAny`; no `@ts-ignore` |
| Pure-logic tests | `bun run test:logic` | 128 pass / 0 fail (12 files) |
| Component/storage tests | `bun run test:run` (vitest) | 42 pass / 0 fail (6 files) |
| Production build | `bun run build` (chrome-mv3) | built, 55 kB; manifest privacy-correct |
| Purity guard | `bash scripts/check-pure-core.sh` | exit 0, no output |
| Purity guard catches `fetch(` | planted `fetch(` in `lib/retrieval` | guard exits non-zero (mechanically enforced) |
| No top-level `browser.*` | `grep -rE 'browser\.' entrypoints` | comments only; no runtime call |
| No polyfill / `chrome.*` / `localStorage` | grep `lib`/`entrypoints`/`components` | none (comment mentions only) |
| Privacy: no raw `.body` in error/msg paths | grep `lib/retrieval` `lib/messaging.ts` | comment only (`body` stays opaque) |

## 4A — Transport-independent (delivered)

- [x] **Settings** — `lib/settings.ts`: `theme` / `keepRawData` (default `true`) /
      `realIdentities` (default `false`) / versioned `storageBudget` (~50 MB / ~500 MB)
      via WXT typed storage; concrete defaults (`exactOptionalPropertyTypes`-safe);
      no `localStorage`. Vitest round-trip + migration-fn tests.
- [x] **Bulk store** — `lib/store.ts` (pure interface), `lib/db.ts` (idb),
      `lib/db.memory.ts` (in-memory twin). One shared contract suite
      (`lib/db.contract.ts`) proves BOTH: save/get round-trips, schema upgrade
      creates all stores/indexes, parser-version cache invalidation (decoded
      invalidated, **raw retained**), **LRU prunes raw chunks first** + flags
      re-fetch, `QuotaExceededError` recognition, `navigator.storage` mocked.
- [x] **PARSER_VERSION** — `lib/decoder/version.ts` keys decoded-cache invalidation.
- [x] **Typed messaging** — `lib/messaging.ts`: `ProtocolMap` over
      `@webext-core/messaging` (`activateReplay` / `startRetrieval` /
      `cancelRetrieval` / `retrievalProgress` / `getCheckpoint`); typed payloads,
      no `any`. Vitest round-trip.
- [x] **Retrieval orchestration logic** — `lib/retrieval/{errors,chunking,orchestrator}.ts`:
      privacy-safe 9-category error taxonomy with an exhaustive `never` mapper;
      pure adaptive sizing + exponential backoff; a resumable, injected-seam
      orchestrator. Tested with fakes: resume-from-checkpoint, cancel mid-loop,
      backoff + shrink on recoverable failure, adaptive growth, discovery-failure
      mapping, and **idempotent re-entry after a simulated SW kill** (drop the
      orchestrator, reconstruct from the checkpoint store, assert it CONTINUES).
- [x] **Content script** — `entrypoints/docs.content.tsx` + `lib/docs-url/`:
      doc detection + id/`/u/{N}/` extraction; an unobtrusive activation
      affordance mounted in a **shadow root** with `isolateEvents`; **no
      auto-load** (explicit click only); triggers retrieval via typed messaging;
      does **not** own the fetch. Solid idioms only (`props.x`, `class`, no
      `.map()`/ternary, no React APIs).
- [x] **Replay worker host (pure pipeline)** — `lib/worker/pipeline.ts`:
      `rawBody → parseFramed → detectSchema → (unknown ⇒ diagnostic, never throws)
      → decodeOperations → buildReplayIndex/deriveTimeline`. Bun-tested
      (known-schema decode + unknown/parse short-circuit). Worker shell at
      `entrypoints/replay/parse.worker.ts` owns its own idb realm and the
      decoded/snapshots/timeline writes.
- [x] **Background wiring** — `entrypoints/background.ts`: the **single
      `// BLOCKED §24` activation site**. Registers messaging listeners and
      instantiates the orchestrator with the idb checkpoint store + the pure
      gated stubs, so `startRetrieval` resolves to a typed `endpoint-unavailable`
      error (surfaced, never a silent success). Vitest proves the plumbing.
- [x] **Tooling** — `test:logic` glob extended with `lib/retrieval`,
      `lib/worker`, `lib/docs-url`; `scripts/check-pure-core.sh` extended to scan
      those dirs and **mechanically forbid `fetch(` / `new Worker` / `globalThis`**;
      SPDX headers on every new file.
- [x] **Network audit** — zero non-`docs.google.com` requests (trivially true:
      the gated stub makes none; re-audit post-§24).

## 4B — Transport-gated (stays `[ ] BLOCKED §24`)

- [ ] **BLOCKED §24** — Live credentialed `revisions/load` retrieval from an MV3
      service worker **and** a Firefox event page.
- [ ] **BLOCKED §24** — Real SW-termination resumability against the live endpoint.
- [ ] **BLOCKED §24** — Discovery mechanism wired to the confirmed §24 method
      (binary-search-on-HTTP-500 vs. revision-count metadata — Q5).

The block is concentrated at ONE greppable site: the `// BLOCKED §24` banner in
`entrypoints/background.ts`. When the capture lands and no stop-condition fires
(protobuf, `batchexecute` wrapper, new page-derived read token, endpoint
restriction), the live `ChunkFetcher` (`fetch(url, { credentials: "include" })`
+ `buildRevisionsLoadUrl`) and the confirmed discovery replace the two pure stubs
there — a localized swap; the orchestrator and `lib/retrieval` do not change.

## Resolve-by-Inspection findings (confirmed during execution)

1. **WXT `*.worker.ts` bundling.** `entrypoints/replay/parse.worker.ts` is **not**
   auto-bundled as a standalone WXT entrypoint (confirmed via `bun run build`:
   absent from `.output`, no error — WXT treats it as a helper module). The
   documented integration path is `new Worker(new URL("./parse.worker.ts",
   import.meta.url), { type: "module" })` from the **Phase-5** replay page (the
   current replay page is a Phase-2 stub). The **same-thread fallback** is always
   available — the pure `lib/worker/pipeline.ts` runs identically on the main
   thread. No deviation to the pure logic; only the worker *wiring* is Phase 5.
2. **Pure-test file layout.** `lib/docs-url` is a **directory**
   (`lib/docs-url/index.ts`) so the purity guard (which scans directories) covers
   it and the `bun test ./lib/docs-url` glob resolves. `lib/retrieval` and
   `lib/worker` are likewise directories.
3. **Worker idb realm + write-ownership split.** The worker constructs its OWN
   `createIdbStore()` (separate realm). The split — background owns
   `rawChunks`/`checkpoints`; worker owns `decoded`/`snapshots`/`timeline` — is
   documented in `lib/store.ts` and the worker shell. A live two-realm
   transaction-ordering test needs a built worker and is **[DEFERRED:Phase 5/6]**.
4. **`navigator.storage.persist()/estimate()`.** Used in `lib/db.ts` behind
   `typeof` guards (absent in the Bun/jsdom test runtime); mocked in the contract
   suite for the quota/LRU path.

## Deviations from the plan (flagged for review)

1. **`lib/docs-url` is a directory** (`lib/docs-url/index.ts`), not a single
   `lib/docs-url.ts` file — required so the directory-scanning purity guard and
   the `./lib/docs-url` bun glob both cover it. Imports use `@/lib/docs-url`.
2. **Content-script + background Vitest tests live under `test/`**, not
   `entrypoints/`. WXT treats any `entrypoints/*.test.*` file as a duplicate
   entrypoint and fails the build; this mirrors Phase 2's `test/smoke.test.tsx`.
3. **Added `fake-indexeddb` (dev dependency)** to test the idb store under Vitest
   (jsdom provides no IndexedDB).
4. **Worker path reconciled** to `entrypoints/replay/parse.worker.ts` (a
   WXT-bundled worker must be an entrypoint), updating IMPLEMENTATION.md §Phase 4
   from the earlier `lib/worker/parse.worker.ts`.
5. **`storageBudget` migration is verified via the exported migration function.**
   The `storage.defineItem` singleton caches its version resolution at import
   time, so seeding raw `$`-meta after import is order-dependent — testing the
   pure migration function exercises the migration logic without testing WXT's
   internal runner.

## Escalation note (to the maintainer)

Phase 4A is delivered and fully tested against fakes/synthetic data; the
resumable retrieval state machine is live, exercised code. **The following is
BLOCKED and requires you:** the §24 authenticated live capture (Chrome + Firefox,
multi-account) filling `docs/protocol-capture.md`, confirming a credentialed
fetch from an MV3 SW + Firefox event page, and observing SW termination
mid-fetch. **HALT** if the capture shows protobuf, a `batchexecute` wrapper, a new
mandatory page-derived read token, or endpoint restriction. Until then, the live
`revisions/load` retrieval stays gated behind the single `// BLOCKED §24` site in
`entrypoints/background.ts`.
