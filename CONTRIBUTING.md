# Contributing to DocRewind

Thanks for your interest in improving DocRewind. This guide covers the
development workflow, commits, git hooks, sign-off, and branching for this
repository. For a from-clean-machine setup and a deeper tour of the build, see
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Development Workflow (Bun-only)

DocRewind uses **[Bun](https://bun.sh)** as its package manager, script runner,
and pure-logic test runtime. **Never** use `npm`, `pnpm`, `yarn`, or `npx` — use
`bun install`, `bun add`, `bun run`, and `bunx`. The text lockfile `bun.lock` is
committed and must stay in sync; CI installs with `--frozen-lockfile`.

```sh
bun install --frozen-lockfile   # install pinned deps
bun run postinstall             # wxt prepare — generates .wxt/ types
bun run dev                     # WXT dev server (Chromium) with HMR
bun run dev:firefox             # WXT dev server (Firefox)
```

Before opening a PR, run the same gates CI runs:

```sh
bun run compile        # tsc --noEmit (strict)
bun run check          # biome check --write . (format + lint + import organize)
bun run test:logic     # Bun — pure decoder/reconstruction/timeline logic
bun run test:run       # Vitest — Solid component / storage / browser-API tests
bun run test:e2e       # Playwright (Chromium) — needs a fresh `bun run build`
bun run audit:licenses # reject AGPL-incompatible dependencies
bun run build          # → .output/chrome-mv3
bun run build:firefox  # → .output/firefox-mv3
```

Test-tier rule: `bun test` is for **pure, DOM-free logic only**; Solid component,
storage, and browser-API tests run under **Vitest**. Firefox has no automated
E2E (Playwright is Chromium-only) — it is validated manually + `web-ext` per
[`docs/firefox-validation.md`](docs/firefox-validation.md).

## License Headers (SPDX)

Every first-party source file must carry an SPDX header:

```
SPDX-License-Identifier: AGPL-3.0-or-later
```

Use the comment syntax for the file type (`// …` for `.ts`/`.tsx`, `# …` for
shell/TOML/YAML, `<!-- … -->` for Markdown). Files **ported** from the
MIT-licensed `harvard-vpal/gdocrevisions` retain their MIT attribution alongside
the AGPL header — see [`docs/PRIOR-ART.md`](docs/PRIOR-ART.md). Do **not** copy
code from `jsomers/draftback` or unlicensed gists.

## Commit Messages

DocRewind uses [Conventional Commits](https://www.conventionalcommits.org/).
Commit message subjects are enforced at the `commit-msg` stage by
[`conventional-pre-commit`](https://github.com/compilerla/conventional-pre-commit).

A subject must follow `type(optional-scope): description`. Allowed types:

| Type       | Use for                                               |
| ---------- | ----------------------------------------------------- |
| `feat`     | A new feature                                         |
| `fix`      | A bug fix                                             |
| `chore`    | Tooling, config, or housekeeping (no production code) |
| `docs`     | Documentation only                                    |
| `test`     | Adding or correcting tests                            |
| `refactor` | Code change that neither fixes a bug nor adds a feat  |
| `build`    | Build system or dependency changes                    |
| `ci`       | CI configuration and scripts                          |
| `perf`     | A performance improvement                             |
| `style`    | Formatting only (no code-meaning change)              |
| `revert`   | Reverting a previous commit                           |

Example:

```
chore(repo): add prek config
```

## Git Hooks (prek)

This repo uses [`prek`](https://prek.j178.dev), a fast git-hook framework written
in Rust, as its commit gate. It runs formatting, secret scanning, conventional
commit checks, and (from Phase 2 onward) project-local Bun checks.

Install the hooks after cloning (the Bun scripts wrap the `prek` commands):

```sh
bun run hooks:install   # prek install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push
```

Run all hooks across the whole tree at any time:

```sh
bun run hooks           # prek run --all-files
```

> **First run requires network access.** prek fetches the pinned remote hooks —
> `gitleaks v8.30.1` and `conventional-pre-commit v4.4.0` — on first use, then
> caches them locally.

`--no-verify` (e.g. `git commit --no-verify`) bypasses the hooks and is for
**emergencies only**. Do not use it to skip a failing check in normal work.

## DCO Sign-off

DocRewind is licensed under **AGPL-3.0-or-later**. There is **no CLA**. Instead,
every commit must carry a Developer Certificate of Origin (DCO) sign-off:

```sh
git commit -s -m "feat(scope): description"
```

The `-s` flag appends a `Signed-off-by: Your Name <you@example.com>` trailer,
certifying you have the right to submit the contribution under the project license.

## Branching

`main` is hook-protected: direct commits to `main` are blocked by
`no-commit-to-branch`. Do all work on a feature branch and merge through a pull
request:

```sh
git switch -c feat/my-change
# ... commit your work ...
# open a PR against main
```
