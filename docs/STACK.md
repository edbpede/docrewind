# DocRewind — Stack Reference

> **Thin reference, not a source of truth for versions.** This file deliberately
> does **not** restate the pinned version matrix. Maintaining a second copy of the
> version table would let the two drift, and a later phase could pin a stale
> value. Versions live in exactly one place.

## Authority

**Authoritative pins live in `.augment/rules/bun-solid-pro.md` (Stack snapshot,
dated 2026-06-11); on conflict the guidelines win.** Read that file's
"Stack snapshot & versions" table for the exact pinned version of every tool
(TypeScript, Bun, SolidJS, UnoCSS / presetWind4, WXT and its modules, Vitest,
Playwright, Biome, `idb`). `docs/docrewind-prd.md` (Revision 5) governs *what* is
built; the guidelines govern *how*. This document records only **net-new facts**
not already captured there.

## Negative constraints (wrong-ecosystem choices to avoid)

These are hard rejections — they reverse plausible-but-wrong defaults an agent
might reach for:

- **No SolidJS 2.0.** Pin the stable 1.9.x line; 2.0 is beta-only — do not use 2.0
  APIs in production.
- **No Vitest 5.0.** Pin the stable 4.1.x line; 5.0 is beta-only.
- **No `presetWind3` / `presetUno` / `presetWind`.** Use **presetWind4** (the
  current Tailwind-4-compatible UnoCSS preset). Revision 5 of the PRD explicitly
  reversed an interim downgrade to presetWind3 — the oklch / `presetLegacyCompat`
  incompatibility only affects migrating a legacy-Tailwind project, and DocRewind
  is greenfield, so it does not bind.
- **No Plasmo / CRXJS** (use WXT), **no ESLint + Prettier** (use Biome), **no
  `webextension-polyfill` / `chrome.*` callbacks** (use WXT's promise-based
  `browser`), **no `localStorage`** (use `storage.local` for settings, `idb` for
  bulk).

## Build-provenance pin (net-new, for Phase 7)

- **Bun 1.3.14 — exact, not a range.** Phase 7 requires deterministic, reproducible
  builds from the committed `bun.lock` via `bun install --frozen-lockfile`, and
  AMO source review rebuilds from source + lockfile and diffs against the shipped
  artifact (PRD §11.4). Record this exact Bun version in CI and release provenance
  so the rebuild is bit-reproducible. (The guidelines' table lists Bun 1.3.14 as
  the snapshot version; this entry promotes it to an exact release-gate pin and
  states *why* an exact value, not a range, is required.)

## Target WXT directory layout

WXT is convention-driven: files under `entrypoints/` become manifest entries
automatically and the manifest is generated (never hand-written). The planned
layout — config files at the repository root, source organized by convention:

- `entrypoints/` — WXT entrypoints (background, replay page, options page,
  `docs.content.ts` content script).
- `components/` — shared SolidJS components.
- `lib/` — pure/typed modules: `protocol/`, `decoder/`, `reconstruction/`,
  `timeline/`, `domain/`, plus `settings.ts`, `db.ts`, `messaging.ts`, worker host.
- `public/` — static assets copied verbatim (icons).
- `assets/` — bundled/imported assets.
- Root config files: `wxt.config.ts`, `uno.config.ts`, `tsconfig.json`,
  `biome.json`, `vitest.config.ts`, `playwright.config.ts`, `package.json`.

`.wxt/` (generated types) and `.output/` (per-browser builds) are gitignored;
`bun.lock` is committed.

## Audit snapshot (2026-06-11)

Working-tree audit at Phase 1 (`git ls-files`). The repository tracks exactly
**7** files — no `package.json`, `wxt.config.ts`, or `node_modules` exist yet
(all tooling is deferred to Phase 2):

1. `.augment/rules/bun-solid-pro.md`
2. `.gitignore`
3. `CONTRIBUTING.md`
4. `LICENSE`
5. `docs/IMPLEMENTATION.md`
6. `docs/docrewind-prd.md`
7. `prek.toml`

`LICENSE` is AGPL-3.0-or-later; per-file `SPDX-License-Identifier:
AGPL-3.0-or-later` headers are required on first-party source once it exists
(PRD §11.6). Work proceeds on branch `chore/phase-1-audit` because `main` is
hook-protected by `prek`'s `no-commit-to-branch`.
