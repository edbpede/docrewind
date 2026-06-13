<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# AI PR Reviewer — tests, CI setup, and verification scope

Low-noise, CodeRabbit-style inline PR reviewer. A [Goose](https://github.com/block/goose)
recipe drives a [NanoGPT](https://nano-gpt.com) model (OpenAI-compatible) to read the PR
diff and emit **one** structured review object; a deterministic shell validates it, filters
its comments to valid diff anchors, and posts a single `COMMENT` review. The model is never
given tools, so it can never execute code or call GitHub — at worst it corrupts JSON, which
validation catches.

## Files

| File | Role |
|---|---|
| `.github/workflows/pr-review.yml` | trigger, least-priv perms, concurrency dedup, install Goose, gather diff, run |
| `.goose/recipe.yaml` | reviewer instructions + `response.json_schema` (COMMENT-only) |
| `scripts/review.sh` | tiered fallback loop, JSON extraction, gate-A schema check, anchor pre-filter, payload build, 422-tolerant post |
| `scripts/hunk-lines.awk` | `@@` hunk reader → valid `(path, side, line)` anchors (gate-B source) |
| `scripts/check-pr-review-workflow.sh` | CI guard: fails if the workflow gains a package-manager / build step |
| `scripts/test/` | stub `goose`/`gh`, fixtures, and `run-pr-review-tests.sh` |

## Run the local tests

```bash
bash scripts/test/run-pr-review-tests.sh
```

No network, no Goose, no GitHub: stub `goose`/`gh` binaries are placed on `PATH`. Exits
non-zero on any failure. Shell is kept bash-3.2-compatible so it runs on stock macOS and CI.

## CI setup (required before the workflow does anything useful)

1. **Add the secret.** Repo → Settings → Secrets and variables → Actions → New repository
   secret: `NANOGPT_API_KEY` = your NanoGPT API key.
2. **Merge the workflow.** It triggers on `pull_request_target` (so it can post on forked
   PRs with the base-repo token). It only reads the diff and runs Goose tool-less — it never
   executes PR code. `scripts/check-pr-review-workflow.sh` enforces that no build step is
   ever added; wire it into a CI lint or prek over the workflow file.
3. **Tune if needed.** `OPENAI_HOST`, `GOOSE_MAX_TURNS`, the model tiers in `scripts/review.sh`
   (`DEFAULT_MODELS`), and `MAX_DIFF_BYTES`.

## M0 / M1 — provider handshake and recipe invocation (RESOLVED against Goose 1.37.0)

NanoGPT is OpenAI-compatible, so Goose's built-in `openai` provider is reused with a custom
host. Confirmed empirically against Goose 1.37.0:

- **Host:** `OPENAI_HOST=https://nano-gpt.com/api` is correct. Goose appends the OpenAI path,
  producing `https://nano-gpt.com/api/v1/chat/completions` (no `/v1/v1`). `GOOSE_PROVIDER__HOST`
  is not needed.
- **Model/provider on a recipe run:** a `--recipe` run **ignores** the `GOOSE_MODEL` /
  `GOOSE_PROVIDER` env vars ("No model configured"). The tier model must be passed via the
  explicit `goose run --provider <p> --model <m>` flags. `review.sh` does this per tier.
- **Parameter injection:** Goose renders `--params` into the recipe YAML *before* parsing it,
  so a multi-line diff injected raw into the `prompt: |` block scalar breaks YAML
  (`Invalid recipe: could not find expected ':'`). `review.sh` indents every diff line by two
  spaces before passing it, which keeps all substituted lines at or above the block indent (and
  doubles as a YAML-injection defense). `awk` still reads the original diff for anchors.
- **Exit code:** Goose can exit `0` even on provider/auth errors, writing the error text to
  **stdout**. `review.sh` therefore treats a tier as successful only when it yields
  schema-valid JSON, and scans both streams for host/auth signatures to drive its diagnostics.

Still to confirm on the first live CI run with a valid key: whether a `:thinking` model at
`GOOSE_MAX_TURNS=1` reliably emits the schema object via Goose's `final_output` tool. If not,
raise `GOOSE_MAX_TURNS` to `2` (still tool-less, so still safe) and/or rely on the `review.sh`
extractor.

## Verification scope — what is proven where

**Verified locally** by `run-pr-review-tests.sh` (stubbed `goose`/`gh`):

- **AC2** clean diff → one summary-only review, exit 0.
- **AC3** every posted comment anchors to a real diff line (pre-filter, by construction).
- **AC5** tier-1 failure → tier-2 used, `fallback_attempts == 1`.
- **AC7** a mis-anchored comment is dropped by the pre-filter; a structured 422 drops the
  named comment and retries; a generic 422 falls back to summary-only — the run never
  produces zero output because of one bad anchor.
- **AC4 (deterministic half)** a coerced non-`COMMENT` event is rejected by gate-A and
  nothing is posted.
- Plus: prose/thinking-wrapped extraction, host-vs-flakiness diagnostic, diff-size cap,
  `should_post_review=false` skip, the workflow security guard, and workflow/recipe structure.

**CI/secret-gated** (need `NANOGPT_API_KEY` and/or a live PR — not exercised locally):

- **M0** provider handshake (host/path round-trip).
- **AC1** a 10-finding PR → exactly one review with 10 inline comments (live model + GitHub).
- **AC4 (model-behaviour half)** an injection-laced diff never yields APPROVE/REQUEST_CHANGES
  (the deterministic gate already makes a non-COMMENT post impossible; this confirms the
  model itself resists the injection).
- **AC6** two rapid pushes → exactly one bot review (concurrency-cancel + the
  `<!-- goose-pr-reviewer -->` marker).

## v1 decisions (plan open questions)

- **Diff size:** capped at `MAX_DIFF_BYTES`; over-cap → summary-only partial note.
- **Rerun dedup:** marker (`<!-- goose-pr-reviewer -->`) + concurrency-cancel; no active deletion.
- **All tiers fail:** silent (no comment) + non-zero exit.
- **Metadata:** diff-only — PR title/body are not fed to the model (lowest value, highest injection risk).
