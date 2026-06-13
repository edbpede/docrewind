<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Goose + NanoGPT PR reviewer — operator guide

A low-noise, CodeRabbit-style inline PR reviewer built as GitHub Actions. The LLM
(Goose driving NanoGPT `:thinking` models) only ever **proposes** a single
structured JSON object; deterministic TypeScript **disposes** — it re-validates
every finding against the real diff, drops anything it cannot anchor, dedupes,
caps, and posts exactly one `COMMENT` review. The model never touches GitHub and
never sees a secret.

Design rationale and the full decision record live in
`.omc/plans/20260613-goose-nanogpt-pr-reviewer.md`.

## Architecture at a glance

```
Stage 1 (pull_request, UNTRUSTED, no secrets)        Stage 2 (workflow_run, TRUSTED, secrets+write)
  collect-pr-context.ts  --> pr-context.json  --artifact-->  verify-identity.ts  (fail-closed, C3)
                             pr.diff                         run-goose-review.ts (Goose+NanoGPT, no side effects)
                                                             validate-review-output.ts (anchor/dedupe/cap)
                                                             post-github-review.ts (one COMMENT review)
```

The determinism boundary is the whole point: nothing reaches GitHub that a plain
script did not validate and choose to post. See `docs`/the plan for the security
model (`pull_request` → `workflow_run`, fork-safe).

## Setup

1. **Add the secret.** Repository secret **`NANOGPT_API_KEY`** (a NanoGPT API
   key). It is mapped to `OPENAI_API_KEY` only at the Goose step, because Goose's
   OpenAI provider reads that variable. It is never placed in the prompt, the
   artifact, or Stage 1.
2. **Pin the actions.** Before enabling on a public repo, replace every
   `uses:` line still carrying a `# SECURITY: pin …` comment with a full
   40-character commit SHA (currently `oven-sh/setup-bun` and the Goose install
   release tag). `actions/checkout`, `actions/upload-artifact`, and
   `actions/download-artifact` are already SHA-pinned. The
   `scripts/pr-review/workflows.test.ts` guard fails the build if a `uses:` is
   neither SHA-pinned nor flagged.
3. **Choose a trigger model.**
   - Public repo / accepts fork PRs → keep the two-stage default
     (`pr-review-collect.yml` + `pr-review-post.yml`).
   - Internal-only repo where fork PRs are impossible → optionally enable the
     simpler single-stage `pr-review-internal.yml` (off by default; triggers only
     on `workflow_dispatch` until you uncomment its `pull_request` trigger).
4. **Dry-run first.** Set `DRY_RUN=1` in the post job's env to print the review
   payload instead of posting, and confirm anchoring looks right on this repo's
   own PRs before going live.

## Tuning (all via environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `SEVERITY_THRESHOLD` | `medium` | Post findings at this severity or above (`low`/`medium`/`high`/`critical`). The real noise gate. |
| `MAX_COMMENTS` | `25` | Runaway/abuse backstop (schema ceiling 50), **not** a low active cap. Overflow is sorted by severity+confidence and routed to the audit list with a summary note. |
| `EMPTY_REVIEW_MODE` | `note` | `note` posts "Review completed. No suggestions at this time."; `silent` posts nothing. |
| `MAX_DIFF_BYTES` | `262144` | Diff fed to the model is truncated past this, dropping the largest files first and noting it in the summary. |
| `MODEL_PRIORITY` | deepseek → mimo → minimax (`:thinking`) | Comma-separated NanoGPT model ladder, tried in order. |
| `PER_ATTEMPT_TIMEOUT` | `240` (s) | Per-model timeout. Reasoning models' first-token latency can be tens of seconds. |
| `GLOBAL_BUDGET_MIN` | `15` (min) | Wall-clock budget across the whole fallback loop (install excluded). |
| `BOT_LOGIN` | `github-actions[bot]` | Author login used to recognise our own prior comments when the hidden marker is absent. |

## Model fallback

The runner tries each model in `MODEL_PRIORITY` once, advancing on any of:
transport/API error, process error, no extractable `final_output` JSON
(including "the model answered in prose instead of calling the tool"),
schema-invalid output, or degenerate-empty output. A **legitimate** empty review
(a substantive summary or a non-empty uncertain list) is accepted, not retried.
Ground-truth `model_used` / `fallback_attempts` are recorded by code, overwriting
whatever the model self-reports. If all models fail, the run is non-blocking.

## NanoGPT-direct fallback (Option A′/C)

If Goose's tool-calling proves unreliable for the chosen models, set
`REVIEW_BACKEND=nanogpt-direct` to bypass Goose and call NanoGPT's
OpenAI-compatible `/chat/completions` directly with strict
`response_format: json_schema` (`scripts/pr-review/lib/nanogpt-direct.ts`). The
deterministic validator — not the backend — remains the authority, so flipping
the backend changes only *how* the JSON is produced, not what may post.

## What is verified, and how

- **Deterministic core (unit-tested, runs anywhere):** diff parsing, anchor
  validation, schema validation, dedupe, context assembly, identity
  reconciliation, the fallback state machine, validation/disposal, payload
  building, the NanoGPT-direct HTTP contract, and the workflow security guard.
  Run `bun run test:pr-review`.
- **Schema/recipe drift gate:** `bun run schemas:build` then `git diff
  --exit-code schema .goose` — regeneration is idempotent.
- **Live behaviour (requires CI + the secret):** the exact Goose
  `--output-format json` envelope, reasoning-vs-tool-args separation, and
  per-model latency are validated against live NanoGPT + Goose in CI, not locally.
  See `.omc/research/m0-goose-nanogpt-findings.md`.

## Limitations

- No GitHub `suggestion` blocks (fail-safe: a wrong one-click-applyable
  suggestion is worse than a plain comment). Findings use fenced code blocks.
- Comments only anchor to lines inside a real diff hunk of a file that has a
  `patch`; binary/oversized (patch-less) files are never commented on.
- The reviewer never approves or requests changes — every review is `COMMENT`.
