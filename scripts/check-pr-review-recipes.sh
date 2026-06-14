#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# check-pr-review-recipes.sh — technical guard for the tool-less property of the
# two-lane PR-reviewer Goose recipes.
#
# The reviewer runs on pull_request_target with the base-repo token + secrets in
# scope (GH_TOKEN, NANOGPT_API_KEY). Each recipe feeds an UNTRUSTED diff (or, for
# the synthesizer, untrusted model output) to an LLM. The only thing standing
# between a prompt injection in that data and code execution / secret
# exfiltration on the runner is that the models have NO tools: Goose's recipes
# must disable all extensions.
#
# Goose enables the `developer` builtin (shell + text editor) BY DEFAULT, and a
# recipe that simply omits the `extensions` field inherits that default. The only
# way to be tool-less is an EXPLICIT EMPTY list — `extensions: []`. Omitting it
# does not just weaken security; it also breaks the review: a :thinking model
# given a shell spends its single `goose_max_turns` on a tool call instead of
# emitting JSON and stalls with "I've reached the maximum number of actions I can
# do without user input", failing every fallback tier.
#
# A comment claiming "tool-less by design" is only a social control. This script
# is the technical one: it fails if any reviewer recipe does not declare exactly
# `extensions: []` as a top-level key. Run it from the test suite and/or CI.
#
# Usage: check-pr-review-recipes.sh [recipe.yaml ...]
#        (defaults to the three .goose/recipe.*.yaml reviewer recipes)

set -u

if [ "$#" -gt 0 ]; then
  recipes=("$@")
else
  recipes=(
    .goose/recipe.code-review.yaml
    .goose/recipe.architect.yaml
    .goose/recipe.synthesize.yaml
  )
fi

rc=0
for r in "${recipes[@]}"; do
  if [ ! -f "$r" ]; then
    echo "FAIL: recipe not found: $r" >&2
    rc=1
    continue
  fi
  # Strip comment lines first so a commented-out `# extensions: []` cannot
  # masquerade as the real declaration. Then require a top-level (column-0)
  # `extensions:` whose value is exactly an empty flow sequence `[]`. This
  # deliberately rejects:
  #   - a missing `extensions` key       (inherits the default developer tool),
  #   - a bare `extensions:` (null)       (also inherits the default),
  #   - any non-empty `extensions:` list  (grants tools).
  noncomment=$(grep -vE '^[[:space:]]*#' "$r" 2>/dev/null || true)
  if printf '%s\n' "$noncomment" \
       | grep -qE '^extensions:[[:space:]]*\[[[:space:]]*\][[:space:]]*$'; then
    echo "OK: $r is tool-less (extensions: [])."
  else
    echo "FAIL: $r must declare an explicit empty 'extensions: []' (tool-less) —" >&2
    echo "      omitting it inherits Goose's default 'developer' shell extension," >&2
    echo "      a prompt-injection RCE risk on pull_request_target and the cause of" >&2
    echo "      the 'maximum number of actions' stall." >&2
    rc=1
  fi
done

if [ "$rc" -eq 0 ]; then
  echo "OK: all reviewer recipes are tool-less."
fi
exit "$rc"
