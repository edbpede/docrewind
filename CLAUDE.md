# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

DocRewind is a **local-first MV3 browser extension** that reconstructs and replays the revision history of a Google Doc entirely on-device — no backend, account, or telemetry. One codebase builds both Chromium and Firefox via [WXT](https://wxt.dev) (Vite under the hood), with **SolidJS** UIs and **UnoCSS** (presetWind4) styling. **Bun is the package manager, script runner, and unit-test runtime — the project is Bun-only** (CI pins Bun 1.3.14). Do not use npm/pnpm/yarn.

## Commands

Run from the repo root with Bun.

| Task | Command |
|---|---|
| Install + generate `.wxt/` types | `bun install --frozen-lockfile` (runs `wxt prepare` via postinstall) |
| Regenerate WXT types only | `bun run postinstall` |
| Dev (HMR) | `bun run dev` · `bun run dev:firefox` |
| Build | `bun run build` (→ `.output/chrome-mv3`) · `bun run build:firefox` |
| Type-check | `bun run compile` (`tsc --noEmit`) |
| Lint + format (writes fixes) | `bun run check` (Biome); CI uses `bunx biome ci .` (non-writing) |
| Pure-logic tests (Bun) | `bun run test:logic` |
| Coverage gate (decoder+reconstruction, ≥85%) | `bun run test:coverage` |
| Component/storage tests (Vitest) | `bun run test:run` (`bun run test` to watch) |
| E2E (Playwright) | `bun run build && bunx playwright install chromium && bun run test:e2e` |
| All git hooks | `bun run hooks` |

Single test:
- Bun tier — `bun test lib/decoder/decode.test.ts` · `bun test -t "<name>"`
- Vitest tier — `bunx vitest run test/popup.test.tsx` · `bunx vitest run -t "<name>"`

## Test split (pick the right runner)

Tests are split across two runners — **a test placed in the wrong tier silently does not run**:

| Test subject | Runner | Lives in |
|---|:---:|:---:|
| Pure logic, no DOM/browser, in a pure dir | Bun (`bun:test`) | the pure dir, via `test:logic` |
| Solid components, DOM, `browser.*`, storage | Vitest (jsdom) | `test/`, `lib/*.test.ts` |
| Assembled-extension behavior | Playwright | `e2e/` (needs a build first) |

Pure dirs import `bun:test`, which Vitest cannot resolve, so they are excluded in `vitest.config.ts` and run only under Bun.

## Architecture

**Pure core ↔ extension shell separation is the central invariant** (enforced by `scripts/check-pure-core.sh`, gated in CI and pre-commit):

- **Pure core** — `lib/{decoder,reconstruction,timeline,domain,protocol,fixtures,summary}`: no `#imports`, no `browser.*`, no `wxt` import.
- **Pure orchestration** — `lib/{retrieval,worker,docs-url}`: the above, plus no live `fetch(`, `new Worker`, or `globalThis`.
- **Extension shell** — `entrypoints/`: the only layer that may touch the browser. `entrypoints/background.ts` (MV3 service worker) owns the **single live `fetch`**; the parse Worker shell also lives under `entrypoints/`.

Data flow: a content script (`entrypoints/docs.content.tsx`, `classroom.content.tsx`) triggers retrieval → `background.ts` fetches revisions → the parse worker decodes/reconstructs (pure core) → results persist via the storage layer → the replay page (`entrypoints/replay/`) reads and plays them back.

Cross-context messaging: one typed `ProtocolMap` in `lib/messaging.ts` (`@webext-core/messaging`), typed end-to-end. Storage: the `RevisionStore` interface in `lib/store.ts`, implemented by `lib/db.ts` (IndexedDB via `idb`) and `lib/db.memory.ts` (in-memory twin); `lib/db.contract.ts` runs one behavioral suite against **both** so they stay interchangeable.

Design system: `uno.config.ts` is the machine-readable source of truth for tokens and must match `DESIGN.md`. The manifest is **generated** by WXT from `wxt.config.ts` — never hand-author `manifest.json`.

## Key workflows

**Add a cross-context message:** extend `ProtocolMap` in `lib/messaging.ts`, register the `onMessage` handler (usually in `background.ts`), call via `sendMessage`. Verify `bun run compile`.

**Add a storage operation:** add the method to `RevisionStore` (`lib/store.ts`), implement it in **both** `lib/db.ts` and `lib/db.memory.ts`, and add assertions to `lib/db.contract.ts`. Verify `bun run test:run`.

**Add a new pure module:** a file under an existing pure dir is covered automatically. A **new** pure directory must be wired in three places: the `test:logic` script (`package.json`), the `exclude` list (`vitest.config.ts`), and `BASE_DIRS`/`EXTRA_DIRS` in `scripts/check-pure-core.sh`.

**Change UI / design tokens:** edit `uno.config.ts` (source of truth), keeping it consistent with `DESIGN.md`/`PRODUCT.md`. System fonts only — never add an external web font (local-first promise).

## Repository-specific rules

- **Privacy invariant** — `permissions` is `storage` only and `host_permissions` is `*://docs.google.com/*` only (`wxt.config.ts`). Never add another host or network target; `scripts/check-no-foreign-hosts.sh` (static) and `e2e/network-isolation.spec.ts` (runtime) gate this. Make network calls only from `background.ts`.
- **No `any`** — Biome sets `noExplicitAny: error`; TS is strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`). Prefer the typed wrappers (`ProtocolMap`, `RevisionStore`) and branded ids in `lib/domain/ids.ts`.
- **Generated/committed artifacts** — `.wxt/` and `.output/` are generated and gitignored (regenerate types with `bun run postinstall`). `public/icon/{16,32,48,96,128}.png` are **committed** for deterministic builds — regenerate only via `./scripts/generate-icons.sh` when the art changes.
- **Coverage floor** — any new file under `lib/decoder` or `lib/reconstruction` must independently meet the 85% line/function floor from its first commit (per-file, `bunfig.toml`).
- **Commits** — Conventional Commits are enforced (`prek` commit-msg hook) and direct commits to `main` are blocked; branch first. Pre-commit runs Biome + `tsc` + the purity guard; pre-push runs all tests plus a Chromium build.

## References

- `.augment/rules/bun-solid-pro.md` — deep WXT + Solid + Bun + UnoCSS stack patterns; read before non-trivial work in any of those.
- `DESIGN.md` / `PRODUCT.md` — visual system and product/audience; read before UI work.
- `prek.toml` / `.github/workflows/ci.yml` — exact hook and CI gate definitions when a check fails locally.
