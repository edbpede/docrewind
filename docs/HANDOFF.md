<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# DocRewind — Phase 8 handoff & verification note

This note records the final Phase 8 verification pass: the documentation set, the
CI/release automation, and the full-gate run that backs them. It is the
human-readable companion to the machine gates in `.github/workflows/`.

## Documentation set (Phase 8)

| Document | Purpose |
|----------|---------|
| [`../README.md`](../README.md) | Product summary, supported browsers, install-from-release + verify-checksum, reconstruction disclaimer (PRD §21). |
| [`../PRIVACY.md`](../PRIVACY.md) | Canonical privacy policy (PRD §13) — no backend/telemetry, local-only, minimal permissions. |
| [`../SECURITY.md`](../SECURITY.md) | Threat model (PRD §14) + private vulnerability-reporting process. |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Bun-only workflow, prek hooks, Conventional Commits, DCO sign-off, SPDX requirement. |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | From-clean-machine reproduction guide (clone → install → build/test). |
| [`PRIOR-ART.md`](PRIOR-ART.md) | MIT attribution for `harvard-vpal/gdocrevisions`; study-for-facts-only status of Draftback/benmarwick (PRD §11.6). |
| [`RELEASE.md`](RELEASE.md) | Release runbook + provenance; now documents the automated tag-triggered GitHub Release. |

## CI / release automation

- **`ci.yml` (`test` job)** — adds a **dependency license audit** step
  (`bun run audit:licenses`) after lint, rejecting AGPL-incompatible licenses
  (PRD §11.6). Existing steps unchanged: compile, biome, network-isolation guard,
  coverage-gate disjointness guard, Bun logic tests, coverage gate, Vitest, build,
  Playwright E2E.
- **`ci.yml` (`packaging-smoke` job)** — adds a **Firefox static lint** step
  (`bun run lint:firefox`) on the built artifact, alongside the existing
  manifest-audit and determinism gates.
- **`release.yml` (tag-triggered)** — now runs the license audit, builds + zips
  both browsers, audits the shipped bytes, web-ext-lints Firefox, checks
  determinism, emits checksums + provenance, and **publishes a GitHub Release**
  (`softprops/action-gh-release@v2`, `permissions: contents: write`) with the
  extension zips, `-sources.zip`, and `SHA256SUMS` attached and the provenance
  table in the notes.
- **`scripts/license-audit.ts`** — new Bun script; walks `node_modules` package
  roots, evaluates each SPDX license expression (handles `OR`/`AND`, legacy
  object/array/string forms), and fails on any incompatible/unknown license.

## Final verification pass

Run on the `docs/phase-8-handoff` branch. All gates green:

| Gate | Command | Result |
|------|---------|--------|
| Type-check | `bun run compile` | ✅ 0 errors |
| Lint/format | `bun run check` (biome) | ✅ clean, no fixes needed |
| License audit | `bun run audit:licenses` | ✅ 661 packages, all AGPL-compatible |
| Pure-logic (Bun) | `bun run test:logic` | ✅ 186 pass / 0 fail (20 files) |
| Coverage gate (Bun) | `bun run test:coverage` | ✅ 71 pass; decode.ts 96.25%, reconstruction 86.4–100% line (≥85% PRD §17) |
| Component/storage (Vitest) | `bun run test:run` | ✅ 160 pass (10 files) |
| Build (Chromium MV3) | `bun run build` | ✅ `.output/chrome-mv3` |
| Build (Firefox MV3) | `bun run build:firefox` | ✅ `.output/firefox-mv3` |
| E2E (Playwright, Chromium) | `bun run test:e2e` | ✅ 3 pass (replay smoke, network isolation, storage maintenance) |
| Git hooks | `bun run hooks` (`prek run --all-files`) | ✅ all hooks pass |
| Manifest audit (shipped bytes) | `bash scripts/verify-manifest.sh` | ✅ minimal footprint, no `<all_urls>`, no remote code |
| Firefox static lint | `bun run lint:firefox` (web-ext) | ✅ 0 errors, 0 notices, 3 warnings (pre-existing framework `innerHTML`) |
| Checksums | `bash scripts/checksums.sh` | ✅ `.output/SHA256SUMS` written |

## Open release gates (escalated, not closed by Phase 8)

These remain unchecked in `IMPLEMENTATION.md` because they require resources absent
from dev/CI — they are release-time manual gates, not Phase 8 deliverables:

- **CWS 128px icon set** — no icons shipped yet; routed to the `frontend-design`
  lane (Phase 7 blocker, PRD §16 Phase 4). Chrome Web Store listing blocker.
- **Firefox live load/activate** — `web-ext lint` is CI-able and green, but the
  live `web-ext run` + activate on `docs.google.com` needs a real Firefox. Execute
  [`firefox-validation.md`](firefox-validation.md) before a Firefox-targeting
  release.
- **Phase 5 UI** — the replay/options/affordance UI tasks in `IMPLEMENTATION.md`
  Phase 5 remain open (component tests exist; the page entrypoints + visual design
  are the `frontend-design` lane).

## Next steps

1. Commission the icon set + Phase 5 UI via the `frontend-design` lane.
2. Execute the Firefox manual validation checklist on a machine with Firefox.
3. Tag a release (`git tag -s vX.Y.Z`) to exercise the automated GitHub Release
   workflow end-to-end.
