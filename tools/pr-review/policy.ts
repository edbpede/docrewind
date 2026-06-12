// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared review-bot policy defaults and posted-text hygiene. Runtime config,
// prompt guidance, workflow drift tests, and payload construction all import this
// module so security-relevant defaults do not split across the CLI.

/** Default command accepted by the privileged issue_comment workflow gate. */
export const DEFAULT_TRIGGER_COMMAND = "/review";

/** GitHub author associations allowed to trigger an on-demand review. */
export const DEFAULT_ALLOWED_ASSOCIATIONS: readonly string[] = ["OWNER", "MEMBER", "COLLABORATOR"];

/** Draft PRs are skipped by default unless an explicit label/manual path requests review. */
export const DEFAULT_REVIEW_ON_DRAFT = false;

/** Path prefixes whose changes are ALWAYS included regardless of size (§10). */
export const SECURITY_PREFIXES: readonly string[] = [
  "entrypoints/",
  "lib/protocol",
  "lib/retrieval",
  "lib/db.ts",
];

/** Non-empty fallback for grouped COMMENT review bodies. */
export const DEFAULT_COMMENT_REVIEW_BODY = "Review completed. No high-confidence issues found.";

/** Repo-specific review guidance rendered in the developer prompt. */
export const DOCREWIND_REVIEW_GUIDANCE: readonly string[] = [
  'Pure-core purity: lib/decoder|reconstruction|timeline|domain|protocol|fixtures must not import "#imports", "browser.", or "wxt"; lib/retrieval|worker|docs-url additionally must not use fetch(, new Worker, or globalThis.',
  "Protocol isolation: Google Docs transport assumptions belong only in lib/protocol/* with fail-safe schema detection.",
  "Privacy invariants: zero non-Google network requests in shipped code; no telemetry/analytics; never render or log raw document/response bodies.",
  'SolidJS idioms: no prop destructuring; prefer <For>/<Index>/<Show> over .map()/ternaries; createMemo over mirror-writing createEffect; "class" not "className".',
  "Storage tiering: idb for bulk, storage.defineItem for settings, never localStorage.",
  "Background service worker: credentialed fetch to docs.google.com; abort timeouts; MV3-termination-resilient checkpoints.",
  'Licensing: per-file SPDX "AGPL-3.0-or-later" header.',
];

/** Render repo-specific guidance in the bullet format expected by the prompt. */
export function renderDocrewindReviewGuidance(): string {
  return DOCREWIND_REVIEW_GUIDANCE.map((line) => `  * ${line}`).join("\n");
}

const COMPLETE_THINK_BLOCK_RE = /[ \t]*<think\b[^>]*>[\s\S]*?<\/think>[ \t]*/gi;
const UNTERMINATED_THINK_BLOCK_RE = /[ \t]*<think\b[^>]*>[\s\S]*$/gi;
const STRAY_THINK_TAG_RE = /[ \t]*<\/think>[ \t]*/gi;

/**
 * Remove model chain-of-thought markup and normalize outer Markdown whitespace
 * before any model-authored text is posted to GitHub.
 */
export function sanitizePostedText(text: string): string {
  return text
    .replace(COMPLETE_THINK_BLOCK_RE, " ")
    .replace(UNTERMINATED_THINK_BLOCK_RE, "")
    .replace(STRAY_THINK_TAG_RE, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Sanitize a review summary and guarantee a non-empty COMMENT review body. */
export function postedReviewBody(summary: string): string {
  return sanitizePostedText(summary) || DEFAULT_COMMENT_REVIEW_BODY;
}
