// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CLI entrypoint and orchestrator (plan §5/§14). Wires the whole pipeline:
// config -> PR metadata -> file filter + large-PR budgeting -> anchor index ->
// prompt -> NanoGPT (verify + structured call + fallback) -> validate/dedupe ->
// one grouped COMMENT review (or a sanitized dry-run print).
//
// Exit codes (§14): 0 success/dry-run · 1 config/auth · 2 GitHub API · 3 NanoGPT
// exhausted · 4 validation/internal. `continue-on-error: true` in CI means a
// non-zero exit never blocks the PR.
//
// The pure helpers (glob matching, file filtering, large-PR selection) are
// exported and unit-tested; `run()` only executes when invoked as a program.

import { ConfigError, loadConfig, type ReviewConfig, redactedView } from "./config";
import { extractFingerprints } from "./dedupe";
import { buildAnchorIndex } from "./diff";
import {
  buildReviewPayload,
  type ChangedFile,
  createGitHubClient,
  type GitHubClient,
} from "./github";
import { createLogger, type Logger, registerSecrets } from "./logger";
import {
  createOpenAiTransport,
  NanoGptAuthError,
  NanoGptExhaustedError,
  requestReview,
  resolveModels,
} from "./nanogpt";
import { composePrompt } from "./prompt";
import { processReview } from "./validate";

/** Char budget for the diff sent to the model before large-PR reduction (§10). */
export const DIFF_CHAR_BUDGET = 120_000;

/** Path prefixes whose changes are ALWAYS included regardless of size (§10). */
export const SECURITY_PREFIXES: readonly string[] = [
  "entrypoints/",
  "lib/protocol",
  "lib/retrieval",
  "lib/db.ts",
];

/** Convert a glob (`**`, `*`, `?`) to an anchored full-path RegExp. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        // `**/` -> any number of path segments; bare `**` -> anything.
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (char === "?") {
      re += "[^/]";
    } else if (char !== undefined && /[.+^${}()|[\]\\]/.test(char)) {
      re += `\\${char}`;
    } else {
      re += char;
    }
  }
  return new RegExp(`^${re}$`);
}

/** True if `path` matches any of the provided globs. */
export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

/** True if a path is in an always-include security-sensitive area (§10). */
export function isSecuritySensitive(path: string): boolean {
  return SECURITY_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

/** Apply exclude globs, include globs, and drop binary/missing-patch files (§5.6). */
export function filterFiles(
  files: readonly ChangedFile[],
  excluded: readonly string[],
  included: readonly string[],
): ChangedFile[] {
  return files.filter((file) => {
    if (file.patch === undefined || file.patch.trim() === "") {
      return false;
    }
    if (matchesAnyGlob(file.path, excluded)) {
      return false;
    }
    if (included.length > 0 && !matchesAnyGlob(file.path, included)) {
      return false;
    }
    return true;
  });
}

export interface SelectionResult {
  readonly selected: readonly ChangedFile[];
  readonly capped: boolean;
}

/**
 * Large-PR reduction (§10 MVP): always include security-sensitive files, then
 * fill the remaining char budget with the largest remaining files. If any file
 * is dropped, `capped` is set so the caller can attach a scope note.
 */
export function selectWithinBudget(files: readonly ChangedFile[], budget: number): SelectionResult {
  const sizeOf = (file: ChangedFile): number => file.patch?.length ?? 0;
  const security = files.filter((file) => isSecuritySensitive(file.path));
  const rest = files
    .filter((file) => !isSecuritySensitive(file.path))
    .sort((a, b) => sizeOf(b) - sizeOf(a));

  const selected: ChangedFile[] = [...security];
  let used = security.reduce((sum, file) => sum + sizeOf(file), 0);
  let capped = false;

  for (const file of rest) {
    const len = sizeOf(file);
    if (used + len <= budget) {
      selected.push(file);
      used += len;
    } else {
      capped = true;
    }
  }

  return { selected, capped };
}

/** Build the diff string shown to the model from the selected files' patches. */
export function buildPromptDiff(files: readonly ChangedFile[]): string {
  return files
    .map((file) => `diff --git a/${file.path} b/${file.path}\n${file.patch ?? ""}`)
    .join("\n");
}

/** Serialize a payload for dry-run printing (already secret-free, but redacted). */
function printDryRun(logger: Logger, payload: unknown): void {
  process.stdout.write(`${logger.redact(JSON.stringify(payload, null, 2))}\n`);
}

/** Core orchestration, parameterized over its clients for testability. */
export async function review(
  config: ReviewConfig,
  github: GitHubClient,
  logger: Logger,
): Promise<number> {
  const meta = await github.getPull();
  logger.info("pull metadata", {
    pr: config.prNumber,
    draft: meta.draft,
    headSha: meta.headSha,
  });

  if (meta.draft && !config.reviewOnDraft) {
    logger.info("draft PR; skipping (REVIEW_ON_DRAFT=false)", { pr: config.prNumber });
    return 0;
  }

  const allFiles = await github.listFiles();
  const reviewable = filterFiles(allFiles, config.excludedPaths, config.includedPaths);
  const { selected, capped } = selectWithinBudget(reviewable, DIFF_CHAR_BUDGET);

  logger.info("file selection", {
    changed: allFiles.length,
    reviewable: reviewable.length,
    selected: selected.length,
    capped,
  });

  if (selected.length === 0) {
    logger.info("no reviewable files; posting summary-only", { pr: config.prNumber });
  }

  const anchors = buildAnchorIndex(
    selected.map((file) => ({ path: file.path, patch: file.patch })),
  );

  const scopeNote = capped
    ? "Note: this PR was large; the review was scoped to security-sensitive and the largest changed files."
    : undefined;

  const messages = composePrompt({
    title: meta.title,
    body: meta.body,
    changedFiles: selected.map((file) => file.path),
    diff: buildPromptDiff(selected),
    minConfidence: config.minConfidence,
    allowSuggestions: config.allowSuggestions,
    customGuidelines: config.customGuidelines,
    ...(scopeNote ? { scopeNote } : {}),
  });

  const transport = createOpenAiTransport(config.nanogptApiKey);
  const models = await resolveModels(
    transport,
    [config.model, ...config.fallbackModels],
    config.fallbackDefaultModel,
    logger,
  );
  const { review: result, model } = await requestReview(models, messages, { transport, logger });
  logger.info("model produced review", { model, comments: result.comments.length });

  const priorBodies = await github.listExistingReviewCommentBodies();
  const priorFingerprints = extractFingerprints(priorBodies);

  const { comments, drops } = processReview(result, {
    anchors,
    minConfidence: config.minConfidence,
    maxComments: config.maxComments,
    allowSuggestions: config.allowSuggestions,
    priorFingerprints,
  });

  logger.info("post-processing", {
    candidate: result.comments.length,
    posted: comments.length,
    drops: drops.map((d) => `${d.path}:${d.line} ${d.reason}`),
  });

  const summary = scopeNote ? `${result.summary}\n\n_${scopeNote}_` : result.summary;
  const payload = buildReviewPayload(meta.headSha, comments, summary);

  if (config.dryRun) {
    logger.info("dry-run: not posting", { pr: config.prNumber });
    printDryRun(logger, payload);
    return 0;
  }

  await github.createReview(payload);
  logger.info("review posted", { pr: config.prNumber, comments: comments.length });
  return 0;
}

/** Top-level entry: load config, build clients, run, map errors to exit codes. */
export async function run(
  env: Record<string, string | undefined>,
  argv: string[],
): Promise<number> {
  let config: ReviewConfig;
  try {
    config = loadConfig({ env, argv });
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  registerSecrets([config.nanogptApiKey, config.githubToken]);
  const logger = createLogger({ debug: config.debug });
  logger.debug("config", redactedView(config));

  const github = createGitHubClient(
    config.githubToken,
    config.owner,
    config.repo,
    config.prNumber,
    logger,
  );

  try {
    return await review(config, github, logger);
  } catch (error) {
    if (error instanceof NanoGptAuthError) {
      logger.error("nanogpt auth error", { error: error.message });
      return 1;
    }
    if (error instanceof NanoGptExhaustedError) {
      logger.error("nanogpt exhausted", { error: error.message });
      return 3;
    }
    const status = (error as { status?: number }).status;
    if (typeof status === "number") {
      logger.error("github api error", { status, error: String(error) });
      return 2;
    }
    logger.error("internal error", { error: String(error) });
    return 4;
  }
}

if (import.meta.main) {
  run(process.env, process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      process.stderr.write(`fatal: ${String(error)}\n`);
      process.exit(4);
    });
}
