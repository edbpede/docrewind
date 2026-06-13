#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# check-pr-review-workflow.sh — technical guard for the AI PR Review workflow.
#
# The reviewer runs on pull_request_target (base-repo token + secrets in scope),
# so it must never execute untrusted PR code. A documentation warning is only a
# social control; this script is the technical one. It fails CI if the workflow
# gains a package-manager / build-tool invocation (which on pull_request_target
# turns prompt-injectable PR code into RCE), or if its least-privilege
# permissions are weakened. Wire it into prek / a CI lint over the workflow file.
#
# Usage: check-pr-review-workflow.sh [path-to-workflow.yml]

WF="${1:-.github/workflows/pr-review.yml}"

if [ ! -f "$WF" ]; then
  echo "FAIL: workflow not found: $WF" >&2
  exit 1
fi

rc=0

# Scan non-comment lines for package-manager / build-tool commands. Word-bounded
# so "ubuntu-latest" never trips the "bun" token.
noncomment=$(grep -vE '^[[:space:]]*#' "$WF" 2>/dev/null || true)
if printf '%s\n' "$noncomment" \
     | grep -nEi '(^|[^A-Za-z0-9_])(npm|pnpm|yarn|npx|bunx|bun|make|pip3|pip|cargo|gradle|mvn)([^A-Za-z0-9_]|$)' >&2; then
  echo "FAIL: $WF invokes a package manager / build tool — pull_request_target RCE risk." >&2
  rc=1
fi

# The real pull_request_target hole is checking out the PR head and then running
# code from that (attacker-controlled) tree with secrets in scope. A build step
# is not required to exploit it, so the blacklist above is not enough: forbid
# checking out an attacker-controlled head ref entirely. Using the SHA as data
# (e.g. commit_id for anchoring) is fine — only a checkout `ref:` is rejected.
# Covers all the common head aliases: pull_request.head.*, github.head_ref,
# and pull_request.merge_commit_sha.
if printf '%s\n' "$noncomment" \
     | grep -nEi 'ref:[[:space:]]*\$\{\{[^}]*(pull_request\.head|github\.head_ref|merge_commit_sha)' >&2; then
  echo "FAIL: $WF checks out an attacker-controlled head ref — runs untrusted PR code with secrets (RCE)." >&2
  rc=1
fi

# Least-privilege permissions.
if ! grep -qE '^[[:space:]]*contents:[[:space:]]*read' "$WF"; then
  echo "FAIL: $WF must declare 'contents: read'." >&2
  rc=1
fi
if ! grep -qE '^[[:space:]]*pull-requests:[[:space:]]*write' "$WF"; then
  echo "FAIL: $WF must declare 'pull-requests: write'." >&2
  rc=1
fi
# No write scope beyond pull-requests, and no blanket write-all.
if grep -qE '^[[:space:]]*permissions:[[:space:]]*write-all' "$WF"; then
  echo "FAIL: $WF uses 'permissions: write-all'." >&2
  rc=1
fi
if grep -nE '^[[:space:]]*(contents|packages|actions|deployments|id-token|issues|checks|statuses):[[:space:]]*write' "$WF" >&2; then
  echo "FAIL: $WF grants a write scope other than pull-requests." >&2
  rc=1
fi

if [ "$rc" -eq 0 ]; then
  echo "OK: $WF passes the PR-review workflow guard."
fi
exit "$rc"
