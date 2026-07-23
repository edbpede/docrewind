# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

Run commands from the repository root. This project is Bun-only and commits `bun.lock`.

| Command | Purpose |
| --- | --- |
| `bun install --frozen-lockfile` | Install the exact locked dependencies. |
| `bun run postinstall` | Run `wxt prepare`; regenerate ignored `.wxt/` types after install or WXT config changes. |
| `bun run dev` / `bun run dev:firefox` | Start WXT development mode for Chromium / Firefox. |
| `bun run build` / `bun run build:firefox` | Build MV3 output under `.output/chrome-mv3` / `.output/firefox-mv3`. |
| `bun run compile` | Run strict TypeScript checking without emitting files. |
| `bun run check` | Apply Biome formatting, lint fixes, and import organization. This command writes files. |
| `bunx biome ci .` | Check formatting and lint without writing; this is the CI command. |
| `bun run test:logic` | Run browser-free `lib/core` tests with Bun. |
| `bun run test:coverage` | Enforce the per-file 85% line/function floor on configured decoder, reconstruction, and replay-core tiers. |
| `bun run test:run` | Run Vitest once for Solid UI and platform/browser-adapter tests. |
| `bun run build && bun run test:e2e` | Build, then run assembled-extension Playwright tests against Chromium. |

Targeted examples:

```sh
bun test lib/core/replay/load.test.ts -t "loadReplayData"
bunx vitest run test/background.test.ts -t "background retrieval wiring"
bunx playwright test e2e/replay-smoke.spec.ts -g "replays a fixture document"
```

Playwright loads `.output/chrome-mv3` through a persistent `channel: "chromium"` context. If the
browser is missing, CI provisions it with `bunx playwright install --with-deps chromium`.

## Architecture Overview

DocRewind is a local-only WXT Manifest V3 extension for Docs, Sheets, and Slides.

1. `entrypoints/docs.content.tsx` and `entrypoints/classroom.content.tsx` detect a document and
   mount isolated Solid controls. They send typed activation messages; they do not fetch history.
2. `entrypoints/background.ts` owns retrieval-side browser handlers, credentialed
   `docs.google.com` fetches, revision discovery, checkpoints, leases, cancellation, and maintenance.
3. Raw chunks and checkpoints are persisted through the browser-free `RevisionStore` contract in
   `lib/core/store.ts`, implemented by IndexedDB in `lib/platform/db.ts`.
4. `entrypoints/replay/App.tsx` starts retrieval and polls content-free checkpoint state. Its
   worker, `entrypoints/replay/parse.worker.ts`, reads raw chunks and dynamically imports exactly
   one of the Docs, Sheets, or Slides pipelines under `lib/core/worker/`.
5. The worker returns run-tagged derived data. The replay page verifies the active run, writes one
   atomic replay publication, promotes its active pointer, then reloads through
   `lib/core/replay/load.ts`. The summary page reads that active publication without retrieving.

`lib/core/` contains browser-free domain, protocol, retrieval, decode, reconstruction, timeline,
summary, and replay logic. `lib/platform/` contains IndexedDB, WXT storage, messaging, and
maintenance adapters. `components/` and `entrypoints/` compose those layers into Solid surfaces.

## Project Boundaries

| Situation | Use | Avoid |
| --- | --- | --- |
| Decode, reconstruction, timeline, URL, or retrieval logic | Pure modules under `lib/core/` with Bun tests | `browser.*`, `#imports`, WXT, or DOM coupling |
| Live fetch adapter, Worker construction, or extension lifecycle | `entrypoints/background.ts` or the relevant entrypoint shell | Moving live fetch or Worker construction into `lib/core/retrieval` or `lib/core/worker` |
| Cross-context behavior | Add the operation to `ProtocolMap` in `lib/platform/messaging.ts`, then use `sendMessage` / `onMessage` | Ad-hoc `browser.runtime` message shapes |
| Bulk document data | `RevisionStore` and the IndexedDB adapter | `storage.local` or `localStorage` |
| Settings, durable intent queues, and leases | Typed `storage.defineItem` entries in `lib/platform/settings.ts` | New IndexedDB stores for small configuration |
| Pure core test | Bun test beside the module | Vitest imports in the Bun-only directories excluded by `vitest.config.ts` |
| UI or platform-adapter test | Vitest under `test/` or `lib/platform/*.test.ts` | `bun test` for Solid/jsdom/fake-browser behavior |
| Assembled extension behavior | Playwright under `e2e/` using `e2e/fixtures.ts` | A non-persistent browser context or unmocked network |

## Common Change Workflows

### Change decode or reconstruction semantics

1. Change the appropriate `lib/core/{docs,sheets,slides}/decoder` and/or `reconstruction` modules.
2. Add or update adjacent Bun tests; preserve text/snapshot invariants for that editor kind.
3. Bump only that kind's version constant:
   `PARSER_VERSION`, `SHEETS_PARSER_VERSION`, or `SLIDES_PARSER_VERSION`.
4. Run the targeted test, `bun run test:logic`, `bun run test:coverage`, and any affected
   replay/component test. Version bumps invalidate stale derived publications while retaining raw
   chunks for re-decode.

### Change persistence

1. Keep the pure `RevisionStore` contract, its in-memory twin, and the IndexedDB adapter aligned.
2. For IndexedDB schema changes, bump `DB_VERSION`, implement the upgrade in
   `openDocRewindDb`, and extend `lib/platform/db.test.ts` plus the shared contract tests.
3. For WXT setting shape changes, use the `version`/`migrations` mechanism demonstrated by
   `storageBudget` and test the migration in `lib/platform/settings.test.ts`.
4. Preserve write ownership: background writes raw chunks/checkpoints; the replay page writes
   publications and the active pointer after run verification.

## Repository Conventions and Gotchas

- WXT generates the manifest from `wxt.config.ts`. Do not add a hand-written `manifest.json`.
  Keep permissions minimal (`storage`) and the network host limited to `docs.google.com`; a host
  change must also update the static guard and network-isolation E2E coverage.
- `scripts/check-pure-core.sh` mechanically guards browser-free core directories.
  `lib/core/retrieval`, `lib/core/worker`, and `lib/core/docs-url` additionally forbid live
  `fetch`, `new Worker`, and `globalThis`.
- Replay timeline positions are applied counts, not wire `RevisionId` values. Time-travel with
  `modelAtRevisionIndex` / the Sheets or Slides equivalent, then render the resulting model.
  `segmentsAt` and `blocksAt` remain single-argument renderers.
- Keep the worker's per-kind dynamic imports. `wxt.config.ts` uses ES worker output specifically
  so a replay does not bundle every editor core.
- Solid components read reactive properties as `props.x`; do not destructure props. Use Solid
  primitives and `class`, not React hooks or `className`.
- Shadow-root affordances whose UI isolates `click` use the non-delegated `on:click` pattern from
  `components/replay/ReplayAffordance.tsx`. Normal extension-page controls use `onClick`.
- Import `virtual:uno.css` in each UI entrypoint. Put shared tokens, shortcuts, preflight, and
  deterministic UnoCSS transforms in `uno.config.ts`; do not introduce Tailwind/PostCSS config.
- Current code makes the replay page—not the worker—the owner of publication writes. The header in
  `lib/platform/db.ts` still describes older worker-owned derived writes; follow
  `lib/core/store.ts`, `parse.worker.ts`, and `replay/App.tsx`.
- The purity/network/coverage guards run in CI but are not listed in current `prek.toml`, despite
  stale comments saying the purity guard is a hook. Run them explicitly for affected changes.
- `prek.toml` rejects direct commits to `main`; it also runs Biome and TypeScript before commit and
  Vitest before push.

## Testing and Full Validation

The test split is intentional: Bun owns pure core, Vitest supplies Solid/jsdom/WXT fake-browser
support, and Playwright owns the built extension. `lib/core/fixtures/` contains sanitized captured
data and hand-derived synthetic corpora shared by decoder and reconstruction tests.

For a CI-equivalent code validation, run in this order:

```sh
bun run compile
bunx biome ci .
bash scripts/check-pure-core.sh
bash scripts/check-no-foreign-hosts.sh
bash scripts/check-coverage-gate-disjoint.sh
bun run test:logic
bun run test:coverage
bun run test:run
bun run build
bun run test:e2e
```

When changing `package.json` coverage paths, keep `bunfig.toml` exclusions disjoint. The Bun
threshold is per file, not aggregate; justify a specific file exemption instead of lowering the
global floor.

## Generated Code and Migrations

- `.wxt/` and `.output/` are generated and ignored. Regenerate them; do not edit them.
- IndexedDB migrations are inline in `openDocRewindDb` in `lib/platform/db.ts`; there is no
  separate migration runner.
- WXT setting migrations live beside their `storage.defineItem` definitions in
  `lib/platform/settings.ts`.
- The committed icon PNGs are build inputs. After editing `public/icon/docrewind.svg`, run
  `./scripts/generate-icons.sh` and commit `public/icon/{16,32,48,96,128}.png`.

## Additional Documentation

- `.augment/rules/bun-solid-pro.md` — Read before Solid, WXT, storage, or test-runner changes.
- `README.md` — Read when building/loading the extension locally or updating icon assets.
- `PRODUCT.md` — Read before changing product behavior, tone, or accessibility expectations.
- `DESIGN.md` — Read before changing UI, design tokens, motion, or component styling.
- `lib/core/fixtures/README.md` — Read before adding or changing decoder/reconstruction fixtures.
- `.github/workflows/ci.yml` — Read when changing validation, coverage, browser setup, or packaging.
- `.github/workflows/release.yml` — Read when changing tag releases, checksums, or provenance.
