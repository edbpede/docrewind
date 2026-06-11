# Contributing to DocRewind

Thanks for your interest in improving DocRewind. This guide covers how commits,
git hooks, sign-off, and branching work in this repository.

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

Install the hooks after cloning:

```sh
prek install
prek install --hook-type commit-msg --hook-type pre-push
```

Run all hooks across the whole tree at any time:

```sh
prek run --all-files
```

> **First run requires network access.** prek fetches the pinned remote hooks —
> `gitleaks v8.30.1` and `conventional-pre-commit v4.4.0` — on first use, then
> caches them locally.

`--no-verify` (e.g. `git commit --no-verify`) bypasses the hooks and is for
**emergencies only**. Do not use it to skip a failing check in normal work.

> From Phase 2, `bun run hooks` and `bun run hooks:install` will wrap the prek
> commands above (pending — `package.json` does not exist yet).

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
