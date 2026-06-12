<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# PR Review CLI (`tools/pr-review`)

An in-repo Bun/TypeScript CLI that reviews a GitHub pull request with NanoGPT and
posts **one grouped `COMMENT` review** with high-confidence inline findings. It is
driven by `.github/workflows/ai-review.yml` and has an identical local dry-run
path. See `.omc/plans/pr-review-system-plan.md` for the full design.

It is **not** part of the extension. WXT bundles only `entrypoints/`, so this tool
never enters the shipped artifact and never touches docrewind's runtime or privacy
guarantees. The pure-core purity guard is scoped to `lib/*`, so the Octokit /
OpenAI / parse-diff imports here are legal by construction.

## How it works

API-only, no checkout of PR code:

1. Load + Zod-validate config (env + CLI args), redacting secrets.
2. Fetch PR metadata and changed files (+patches) via Octokit; the model diff is
   rebuilt from the per-file patches so it stays consistent with the anchor index.
3. Filter generated/binary files; for large PRs, always include security-sensitive
   dirs (`entrypoints/`, `lib/protocol`, `lib/retrieval`, `lib/db.ts`) then fill a
   char budget with the largest remaining files, attaching a scope note.
4. Build a per-file **anchor index** from the diff so every comment is validated to
   a real changed line + side (prevents GitHub's "line must be part of the diff" 422).
5. Compose a system/developer/user prompt; all PR text is fenced as untrusted data
   (prompt-injection hardening).
6. Call NanoGPT (OpenAI-compatible) with `response_format` json_schema + `reasoning:
   { exclude: true }`; the configured tiered model list is authoritative (primary then
   ordered fallbacks, tried in order at request time), with a startup `/models` check
   for observability only. **Zod is the real validation gate.**
7. Post-process: confidence gate, anchor validation, dedupe (hidden fingerprint
   marker), severity sort, cap, safe truncation, suggestion-block policy.
8. Post one grouped review (or print a sanitized payload in dry-run).

## Local usage

```sh
# Dry-run (prints the sanitized payload, posts nothing, hides secrets):
REVIEW_DRY_RUN=true \
NANOGPT_API_KEY=… GITHUB_TOKEN=… GITHUB_REPOSITORY=edbpede/docrewind \
bun run tools/pr-review/main.ts --pr 6

# Convenience scripts:
bun run pr-review:dry --pr 6     # dry-run
bun run pr-review --pr 6         # live (posts a review)
```

Copy `.env.example` to `.env` (gitignored) for local runs. Use a fine-grained PAT
with `contents:read` + `pull-requests:write`; never commit it.

## Configuration

All knobs are environment variables (see `.env.example` for the full list and
defaults). Required: `NANOGPT_API_KEY`, `GITHUB_TOKEN`, plus `GITHUB_REPOSITORY`
and a PR number (`PR_NUMBER` or `--pr <n>`). Tuning knobs include `REVIEW_MODEL`,
`REVIEW_FALLBACK_MODELS`, `REVIEW_MIN_CONFIDENCE` (0.75), `REVIEW_MAX_COMMENTS` (5),
`REVIEW_ON_DRAFT`, `REVIEW_ALLOW_SUGGESTIONS`, `REVIEW_EXCLUDED_PATHS`,
`REVIEW_INCLUDED_PATHS`, `REVIEW_CUSTOM_GUIDELINES`, `REVIEW_TRIGGER_COMMAND`
(`/review`), and `REVIEW_ALLOWED_ASSOCIATIONS` (`OWNER,MEMBER,COLLABORATOR`).

Security-relevant policy defaults live in `tools/pr-review/policy.ts`: draft
review default, on-demand trigger command, allowed author associations,
security-sensitive always-include prefixes, repo-specific prompt guidance, and
posted-text sanitization. The GitHub Actions gate must mirror the trigger command
and associations literally because job-level `if:` expressions cannot import
TypeScript; a workflow test prevents drift.

## Triggers (workflow)

- **Automatic** on every PR incl. forks (`pull_request_target`); drafts skipped
  unless re-labeled.
- **Label** `ai-review` for an on-demand re-review (works on drafts).
- **`/review` comment** — gated by `author_association`
  (`OWNER,MEMBER,COLLABORATOR`).
- **`workflow_dispatch`** with `pr_number` + `dry_run` for manual/dry runs.

Fork safety is structural: no checkout/execution of PR code, checkout credentials
are not persisted, dependency installation uses `--ignore-scripts` in the
privileged job, the workflow YAML is read from the base branch, and prompt
injection is mitigated in the CLI.

## Development

```sh
bun run test:pr-review      # Bun tests (no network)
bun run compile:pr-review   # tsc --noEmit (dedicated Bun/Node tsconfig)
bun run check               # Biome (lints tools/ too)
```

## Exit codes

`0` success / dry-run · `1` config or auth (401/402, missing env) · `2` GitHub API
error · `3` NanoGPT exhausted all models · `4` validation / internal error. CI runs
the step with `continue-on-error`, so a non-zero exit never blocks the PR.

## Security notes

- Secrets are never logged (a redaction test enforces this) and never appear in
  dry-run output.
- The model path has no tools/shell/write capability; reviews are COMMENT-only and
  can never approve or merge.
- Chain-of-thought is suppressed (`reasoning: { exclude: true }`) and defensively
  stripped from every model-authored field before anything is posted.
