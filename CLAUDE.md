# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

DocRewind is a **local-first, cross-browser MV3 extension** (Chromium + Firefox) that reconstructs and replays the revision history of a Google **Doc, Sheet, or Slides** deck entirely on the user's machine — no backend, account, or telemetry. One codebase is built for both browsers by [WXT](https://wxt.dev) (Vite under the hood) with **SolidJS** UI, **UnoCSS** (`presetWind4`) styling, and **Biome** for lint/format. The privacy story is an enforced invariant, not a promise (see Rules).

**Bun is the only supported package manager and script runner.** Never use npm/pnpm/yarn/npx; commit `bun.lock`. Dependencies are pinned exact (`bunfig.toml [install] exact = true`).

## Commands

Run everything from the repo root.

| Task | Command |
|---|---|
| Install | `bun install --frozen-lockfile` |
| **Generate WXT types** (required before compile/build) | `bun run postinstall` (`wxt prepare` → `.wxt/`) |
| Dev (Chrome / Firefox) | `bun run dev` / `bun run dev:firefox` |
| Build (→ `.output/chrome-mv3` / `firefox-mv3`) | `bun run build` / `bun run build:firefox` |
| Typecheck | `bun run compile` (`tsc --noEmit`) |
| Lint + format (writes) | `bun run check` (`biome check --write .`) |
| Pure-logic tests (Bun runner) | `bun run test:logic` |
| Coverage gate (decoder/reconstruction ≥85%) | `bun run test:coverage` |
| Component/platform tests (Vitest) | `bun run test:run` (watch: `bun run test`) |
| E2E (Playwright; build first) | `bun run test:e2e` |
| All git hooks | `bun run hooks` (`prek run --all-files`) |

Single test — **pure-core (Bun):** `bun test ./lib/core/docs/decoder/decode.test.ts`, one case `bun test -t "<name>"`.
Single test — **component/platform (Vitest):** `bunx vitest run test/popup.test.tsx`, one case `bunx vitest run -t "<name>"`.

CI (`.github/workflows/ci.yml`) runs the non-writing form `bunx biome ci .` plus the guard scripts below; match it before pushing.

## Architecture and boundaries

Two layers under `lib/`, separated by browser coupling:

- **`lib/core/**` — pure, browser-free.** Decoders, reconstruction, timeline/summary derivation, protocol, retrieval orchestration, worker pipeline. Depends only on the `RevisionStore` interface (`lib/core/store.ts`), never on a concrete backend, so storage stays swappable and units run under Bun. Per-editor cores are parallel siblings: `lib/core/docs/`, `lib/core/sheets/`, `lib/core/slides/` (each `decoder/` + `reconstruction/`), sharing the generic snapshot/replay spine in `lib/core/replay-core/`.
- **`lib/platform/**` — browser-coupled.** IndexedDB store (`db.ts`) + in-memory twin (`db.memory.ts`) both implement `RevisionStore`; typed messaging (`messaging.ts`, `@webext-core/messaging`); settings and storage maintenance.

**Entrypoints** (`entrypoints/`) are the only place `browser.*`/DOM/`fetch` live, all inside WXT's `defineBackground`/`main(ctx)` (top-level `browser.*` throws in WXT's Node build context):
- `docs.content.tsx` / `classroom.content.tsx` — detect a document, mount a Solid affordance in a shadow root; do **not** fetch — they message the background to start retrieval.
- `background.ts` — the **only live-fetch site**: wires the retrieval orchestrator to the idb store and owns writes to `rawChunks` + `checkpoints`.
- `replay/` (`App.tsx`, `parse.worker.ts`) — reads raw chunks, runs the decode/reconstruction pipeline (in a Worker, with a same-thread fallback), owns replay-publication rows. `popup/`, `options/`, `summary/` are the other Solid pages.

Data flow: content script → (message) → background retrieval → `rawChunks` in idb → replay page decode/reconstruct → publication rows → UI. The `DocumentKind` tag (`"doc" | "sheet" | "slides"`, `lib/core/domain/kind.ts`) lives at boundaries only and routes which core/transport/viewport a document uses; each core stays closed-world over its own grammar.

## The pure-core purity invariant

`bash scripts/check-pure-core.sh` (a committed prek hook + CI gate) fails the build if coupling leaks into the pure tiers:
- `lib/core/{docs,sheets,slides}/{decoder,reconstruction}`, `timeline`, `domain`, `protocol`, `fixtures`, `summary`, `replay-core` must not reference `#imports`, `browser.`, or `wxt`.
- `lib/core/{retrieval,worker,docs-url}` additionally must not call `fetch(`, `new Worker`, or `globalThis` — the live adapter belongs in `entrypoints/background.ts`.

Keep pure logic in `lib/core`; put anything that touches `browser.*`, `fetch`, storage, or the DOM in `lib/platform` or an entrypoint.

## Testing model (two runners — get this right)

`bun test` (Bun's Jest-style runner) does **not** understand the Solid JSX transform, jsdom, or WXT's fake-browser. This splits the suite:

| Test kind | Runner | Location | Imports |
|---|:---:|---|---|
| Pure logic (no DOM) | Bun (`test:logic`) | co-located in `lib/core/**` | `bun:test` |
| Solid components, storage, messaging | Vitest (`test:run`) | `test/`, `components/`, `lib/platform/` | `vitest`/`vitest/config` |

Vitest **excludes** every Bun-only pure dir (`vitest.config.ts`), because importing `bun:test` breaks it. When you add a **new pure `lib/core` directory with `bun:test` specs**, you must in the same change: (1) add its path to the `test:logic` script in `package.json`; (2) add it to the `exclude` list in `vitest.config.ts`; (3) add it to the appropriate `BASE_DIRS`/`EXTRA_DIRS` array in `scripts/check-pure-core.sh`. Missing any one leaves the tests unrun or the build red. Verify with `bun run test:logic && bun run test:run && bash scripts/check-pure-core.sh`.

## Repository-specific rules

- **Never hand-author `manifest.json`.** WXT generates it from `wxt.config.ts`; edit permissions/identity there. The manifest is locked to `permissions: ["storage"]` and `host_permissions: ["*://docs.google.com/*"]` — this is the privacy invariant, re-audited on shipped bytes by `scripts/verify-manifest.sh`.
- **No non-Google network targets in production code.** `scripts/check-no-foreign-hosts.sh` (CI) fails if any `lib/`/`entrypoints/` source line names a non-Google host or a non-`fetch` network API. All retrieval uses first-party `fetch(url, { credentials: "include" })` from the background only.
- **`noExplicitAny` is an error** (`biome.json`); TypeScript is strict with `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (`tsconfig.json`). Path alias `@/*` → repo root.
- **Committed generated art:** the sized icon PNGs in `public/icon/` are committed for deterministic builds; regenerate only via `./scripts/generate-icons.sh` when the source SVG changes.
- **Commits:** Conventional Commits are enforced (`prek` `commit-msg` hook). Do **not** commit directly to `main` (`no-commit-to-branch`); branch and open a PR.
- **Coverage gate is per-file, ≥85%** on the `test:coverage` paths; a new partially-covered file there fails CI even if aggregate is high. See `bunfig.toml` for the exemption escape hatch (`coveragePathIgnorePatterns`) — never lower the global threshold.

## References

- `.augment/rules/bun-solid-pro.md` — deep Bun + WXT + SolidJS + UnoCSS + Biome stack guide; read before non-trivial toolchain or UI-framework work.
- `PRODUCT.md` / `DESIGN.md` — audience, product intent, and the target visual system (`uno.config.ts` is the machine-readable source of truth); read before UI/visual changes.
