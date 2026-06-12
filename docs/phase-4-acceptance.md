# Phase 4 — Honest Acceptance Map & §24 Gate

> Plan: `.omc/plans/phase-4-integration-plan.md`. Branch: `feat/phase-4-integration`.
> Scope: **Option A — build unblocked, gate retrieval — now UNBLOCKED.** All
> transport-independent work (4A) is delivered + agent-verified; the retrieval
> orchestration (4B) is built behind injected seams, and the **live network adapter
> is wired** (§24 capture landed 2026-06-12, no stop-condition fired).
> `[x]` = delivered + verified. The former §24-gated items (4B) are resolved.
> `[DEFERRED]` = owned by a later phase.

## Verification snapshot (re-run 2026-06-12, post-§24 live adapter)

| Gate | Command | Result |
|---|---|---|
| Type-check | `bun run compile` (`tsc --noEmit`) | clean |
| Lint/format | `bun run check` (biome) | clean; `noExplicitAny`; no `@ts-ignore` |
| Pure-logic tests | `bun run test:logic` | 133 pass / 0 fail (13 files; +4 live-capture) |
| Component/storage tests | `bun run test:run` (vitest) | 44 pass / 0 fail (6 files; live SW-adapter wiring) |
| Production build | `bun run build` (chrome-mv3) | built, ~81 kB; manifest privacy-correct (`storage` + `*://docs.google.com/*`) |
| Firefox build | `bun run build:firefox` (firefox-mv3) | built; manifest privacy-correct |
| Purity guard | `scripts/check-pure-core.sh` (grep-equivalent) | clean — `fetch(` only in `entrypoints/background.ts` |
| Purity guard catches `fetch(` | planted `fetch(` in `lib/retrieval` | guard exits non-zero (mechanically enforced) |
| Post-§24 network audit | live adapter URLs | only `*://docs.google.com/*` (`revisions/load` + `/edit` bootstrap) |
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
- [x] **Background wiring** — `entrypoints/background.ts`: the former §24 activation
      site, now the **live adapter**. Registers messaging listeners and
      instantiates the orchestrator with the idb checkpoint store + the live
      `ChunkFetcher` (`fetch(url, { credentials: "include" })` + `buildRevisionsLoadUrl`)
      and `RevisionRangeDiscovery`. Vitest drives `startRetrieval` end-to-end against a
      mocked fetch (discovery → chunk → checkpoint) and asserts the error taxonomy.
- [x] **Tooling** — `test:logic` glob extended with `lib/retrieval`,
      `lib/worker`, `lib/docs-url`; `scripts/check-pure-core.sh` extended to scan
      those dirs and **mechanically forbid `fetch(` / `new Worker` / `globalThis`**;
      SPDX headers on every new file.
- [x] **Network audit** — zero non-`docs.google.com` requests. Re-audited post-§24:
      the live adapter calls only `*://docs.google.com/*` (`revisions/load` + the
      `/edit` bootstrap for discovery); manifest declares `storage` + that host only.

## 4B — Transport (UNBLOCKED — §24 capture landed 2026-06-12, no stop-condition)

- [x] Live credentialed `revisions/load` retrieval from an **MV3 service worker** —
      verified: `fetch(url, { credentials: "include" })` returns 200/JSON from the
      built extension's SW context. *(Firefox event-page fetch deferred — Firefox not
      installed; mechanism is identical host-permission cookie attachment.)*
- [~] SW-termination resumability — the orchestrator checkpoints per chunk and
      resumes by re-invoking `runRetrieval` against the same store (fake-tested
      idempotent re-entry). *(A deterministic large-doc mid-fetch kill is STILL a
      release smoke test — NOT verified live. The 2026-06-12 Firefox follow-up could
      not close it: no large throwaway doc, and the `firefox-devtools` MCP exposes no
      primitive to deterministically terminate a Firefox MV3 background/event-page
      context nor to inspect the extension IndexedDB (`checkpoints`/`rawChunks`).
      Best run on Chromium MV3 via `chrome://serviceworker-internals`. See
      protocol-capture.md Q9.)*
- [x] Discovery wired to the confirmed §24 method — `"revision":N` bootstrap
      metadata (primary) + binary-search on the in-range(200)/over(**400**) boundary
      (fallback). Out-of-range is HTTP 400 in 2026, not the 2014-era 500 (Q5).

The swap was concentrated at ONE site — the former §24 banner in
`entrypoints/background.ts` — now the live `ChunkFetcher` (`fetch(url, {
credentials: "include" })` + `buildRevisionsLoadUrl`) and the live
`RevisionRangeDiscovery`. The orchestrator and `lib/retrieval` are unchanged. The
one core change beyond the seam: the decoder gained a tuple-envelope adapter
(`lib/decoder/decode.ts#normalizeEntry`) because the real `changelog` entries are
9-element tuples `[op, time, sessionId, revisionId, userId, …]`, not the flat
objects the synthetic corpus had modeled — anticipated by plan Pre-mortem #3.

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

## Resolution note (§24 capture landed 2026-06-12)

Phase 4A was already delivered and tested; **4B is now unblocked.** The §24
authenticated live capture was performed (`docs/protocol-capture.md`) and **no
stop-condition fired** (JSON not protobuf; direct endpoint not `batchexecute`;
cookie-only read with no new page-derived token; no endpoint-restriction guidance).
The live `revisions/load` adapter + revision-count discovery are wired in
`entrypoints/background.ts`; the credentialed read is verified from the MV3
service-worker context (200/JSON); the decoder gained a tuple-envelope adapter for
the real wire format; and end-of-timeline text-equality is proven on a sanitized
live capture.

**Remaining live items — updated by the 2026-06-12 Firefox follow-up.** CLOSED live
in Firefox: the multi-account `/u/1/` read (Q8), the rich/suggesting-doc op capture
(Q7 — `iss`/`msfd` suggestions + in-band `ae`/`te`/`ue` entity ops; decoder
unchanged, fixture + test added), and the Firefox first-party credentialed read +
affordance mount (Q10/Q12). STILL OPEN (documented MCP-tooling limits, not blockers):
the credentialed fetch from the Firefox **extension background context** specifically
(no JS-eval / unreachable shadow-root trigger; MV3 optional-host-permission), and a
**deterministic SW/event-page-termination kill** on a large doc (best on Chromium
MV3). One Firefox UX finding: `presetWind4`/content-script CSS is CSP-blocked on
Google Docs in Firefox → the affordance renders unstyled (Phase-5 fix).
