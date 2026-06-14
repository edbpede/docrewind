<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# DocRewind — Release process & build provenance (Phase 7)

DocRewind ships two MV3 extensions (Chromium + Firefox) built by WXT from the
**committed `bun.lock`**. This document is the authoritative release runbook and
the provenance record reviewers use to reproduce a build.

## Reproducibility scope — claim only what is proven

> **Deterministic from the committed lockfile (same-environment).** A rebuild on
> the same toolchain produces **per-file content-identical** extension archives,
> verified by `scripts/verify-reproducible-build.sh`. This catches intra-build
> nondeterminism regressions (hash-seeded names, embedded timestamps, unordered
> output).
>
> **Cross-machine byte-for-byte reproducibility is a PRD §0.9 _stretch goal_, not
> a shipped guarantee.** It is not currently asserted by CI. A sketch of the
> intended approach is in [Stretch goal](#stretch-goal-cross-machine-byte-repro)
> below. The wording here is kept identical in scope to `docs/STACK.md` and
> `docs/store-submission/amo-source-readme.md` — do not upgrade "deterministic
> from the lockfile" to "reproducible" without building the cross-machine gate.

## Toolchain (exact pins)

| Tool | Version | Source of truth |
|------|---------|-----------------|
| Bun | **1.3.14** (exact) | `.augment/rules/bun-solid-pro.md`, `@types/bun`, CI `setup-bun` |
| WXT | 0.20.26 | `package.json` |
| Node | not required for the build (Bun runs it); CI pins Bun only | — |

The dependency graph is pinned by the committed `bun.lock`; every build installs
with `bun install --frozen-lockfile` so a lockfile drift fails the build rather
than silently resolving a new version.

## Provenance to record per release

Capture these four facts for each release (the tag-triggered
`.github/workflows/release.yml` emits them as build logs / artifacts):

1. **Bun version** — `bun --version` → must read `1.3.14`.
2. **`bun.lock` file sha256** — the SHA-256 of the lockfile *as a file* (for
   reviewer reproducibility; this is the file hash, not a per-package hash):

   ```bash
   sha256sum bun.lock        # Linux / CI
   shasum -a 256 bun.lock    # macOS
   ```

   Recompute per release — the value changes whenever a dependency is added
   (e.g. the Phase 7 `web-ext` dev dependency), so it is intentionally **not**
   frozen into this document.
3. **Git commit sha** — `git rev-parse HEAD`.
4. **Build date** — UTC date of the build (`date -u +%Y-%m-%dT%H:%M:%SZ`).

## Release process (step by step)

```bash
# 1. Clean, lockfile-pinned install
bun install --frozen-lockfile
bun run postinstall            # wxt prepare (generates .wxt/ types)

# 2. Quality gates
bun run compile                # tsc --noEmit
bun run check                  # biome
bun run test:run               # vitest
bun run test:logic             # bun pure-logic tier

# 3. Build + package both browsers from the one codebase
bun run build                  # → .output/chrome-mv3
bun run build:firefox          # → .output/firefox-mv3
bun run zip                    # → .output/docrewind-<version>-chrome.zip
bun run zip:firefox            # → .output/docrewind-<version>-firefox.zip + -sources.zip

# 4. Verify the SHIPPED BYTES
bash scripts/verify-manifest.sh             # permission/identity/no-remote-code audit
bash scripts/verify-reproducible-build.sh   # same-environment per-file determinism
bunx web-ext lint --source-dir .output/firefox-mv3   # Firefox static lint (or: bun run lint:firefox)

# 5. Checksums
bash scripts/checksums.sh      # → .output/SHA256SUMS over all *.zip

# 6. Publish: attach both extension zips, the -sources.zip, and SHA256SUMS to the
#    release. Record the four provenance facts above in the release notes.
```

`scripts/verify-manifest.sh` and `scripts/verify-reproducible-build.sh` also run
as the CI `packaging-smoke` job (`.github/workflows/ci.yml`); the full
build→verify→checksum→upload chain runs on tag push via
`.github/workflows/release.yml`.

## Open release gates (escalated, not closed here)

- **Firefox `web-ext run` manual load/activate** — `bunx web-ext lint` is CI-able
  and runs here, but the live load + activate on `docs.google.com` needs a real
  Firefox, which is absent in dev/CI. Execute `docs/firefox-validation.md` on a
  machine with Firefox before a Firefox-targeting release. (Mirrors the Phase 6
  precedent.)
- **CWS 128px icon** — no icon set is shipped yet; commissioning the real visual
  identity is routed through the `frontend-design` lane. This is a Chrome Web
  Store listing blocker, tracked unchecked in `docs/IMPLEMENTATION.md`.

## Stretch goal — cross-machine byte-repro

PRD §0.9 names cross-machine byte-for-byte reproducibility as a future goal, not
an MVP guarantee. The intended approach (sketch, **not built**):

- Pin a container base image to an exact digest, install the exact Bun 1.3.14,
  `bun install --frozen-lockfile`, build, and diff the resulting zips' extracted
  contents against a reference build's `SHA256SUMS`.
- This would move the determinism claim from "same-environment" to
  "any-environment". It is deliberately out of scope for Phase 7 (the Bun-only
  minimal-surface rule excludes adding Docker tooling now).
