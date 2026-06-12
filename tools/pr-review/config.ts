// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Configuration loading and validation (plan §11). All knobs come from the
// environment (the GitHub Actions / dev-shell convention) with a small set of
// CLI overrides for local dry-runs. The parsed config is Zod-validated so a
// missing secret or malformed number fails fast with a clear message that
// main.ts maps to exit code 1.
//
// Secret hygiene: `redactedView()` returns a copy with secret values masked, so
// config can be echoed in debug logs without leaking the API key or token.

import { z } from "zod";
import {
  DEFAULT_ALLOWED_ASSOCIATIONS,
  DEFAULT_REVIEW_ON_DRAFT,
  DEFAULT_TRIGGER_COMMAND,
} from "./policy";

/** Built-in globs excluded from review (generated / vendored / binary). */
export const DEFAULT_EXCLUDED_GLOBS: readonly string[] = [
  "bun.lock",
  "**/.output/**",
  "**/.wxt/**",
  "dist/**",
  "coverage/**",
  "**/*.tsbuildinfo",
  "**/*.lcov",
  "**/*.sqlite",
  "**/*.log",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.webp",
  "**/*.ico",
  "**/*.woff",
  "**/*.woff2",
  "node_modules/**",
];

const DEFAULT_PRIMARY_MODEL = "deepseek/deepseek-v4-pro-cheaper:thinking";
const DEFAULT_FALLBACK_MODELS = "xiaomi/mimo-v2.5-pro:thinking,minimax/minimax-m3:thinking";

/** Raw, parsed-but-not-yet-validated env+arg bundle. */
export interface RawConfigInput {
  readonly env: Record<string, string | undefined>;
  readonly argv: readonly string[];
}

/** Fully validated configuration consumed by the rest of the CLI. */
export interface ReviewConfig {
  readonly nanogptApiKey: string;
  readonly githubToken: string;
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly model: string;
  readonly fallbackModels: readonly string[];
  readonly minConfidence: number;
  readonly maxComments: number;
  readonly dryRun: boolean;
  readonly debug: boolean;
  readonly reviewOnDraft: boolean;
  readonly allowSuggestions: boolean;
  readonly excludedPaths: readonly string[];
  readonly includedPaths: readonly string[];
  readonly customGuidelines: string;
  readonly triggerCommand: string;
  readonly allowedAssociations: readonly string[];
}

/** Thrown on any invalid/missing configuration; main.ts maps this to exit 1. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Extract `--pr <n>`/`--pr=<n>` and `--dry-run` from argv. */
function parseArgs(argv: readonly string[]): { pr?: string; dryRun?: boolean } {
  const out: { pr?: string; dryRun?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pr") {
      const next = argv[i + 1];
      if (next !== undefined) {
        out.pr = next;
        i++;
      }
    } else if (arg?.startsWith("--pr=")) {
      out.pr = arg.slice("--pr=".length);
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    }
  }
  return out;
}

const numericString = z.string().trim().regex(/^\d+$/, "must be a positive integer");

/** Parse and validate configuration from env + CLI args. Throws ConfigError. */
export function loadConfig(input: RawConfigInput): ReviewConfig {
  const { env } = input;
  const args = parseArgs(input.argv);

  const repository = env.GITHUB_REPOSITORY?.trim() ?? "";
  const [owner, repo] = repository.split("/", 2);

  const prRaw = args.pr ?? env.PR_NUMBER;

  const schema = z.object({
    nanogptApiKey: z.string().trim().min(1, "NANOGPT_API_KEY is required"),
    githubToken: z.string().trim().min(1, "GITHUB_TOKEN is required"),
    owner: z.string().min(1, "GITHUB_REPOSITORY must be 'owner/repo'"),
    repo: z.string().min(1, "GITHUB_REPOSITORY must be 'owner/repo'"),
    prNumber: numericString
      .transform((value) => Number.parseInt(value, 10))
      .pipe(z.number().int().positive("PR_NUMBER must be a positive integer")),
    minConfidence: z.coerce.number().min(0).max(1),
    maxComments: z.coerce.number().int().min(0),
  });

  const parsed = schema.safeParse({
    nanogptApiKey: env.NANOGPT_API_KEY ?? "",
    githubToken: env.GITHUB_TOKEN ?? "",
    owner: owner ?? "",
    repo: repo ?? "",
    prNumber: prRaw ?? "",
    minConfidence: env.REVIEW_MIN_CONFIDENCE ?? "0.75",
    maxComments: env.REVIEW_MAX_COMMENTS ?? "5",
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new ConfigError(`Invalid configuration: ${issues}`);
  }

  const excluded = parseCsv(env.REVIEW_EXCLUDED_PATHS);

  return {
    nanogptApiKey: parsed.data.nanogptApiKey,
    githubToken: parsed.data.githubToken,
    owner: parsed.data.owner,
    repo: parsed.data.repo,
    prNumber: parsed.data.prNumber,
    model: env.REVIEW_MODEL?.trim() || DEFAULT_PRIMARY_MODEL,
    fallbackModels: parseCsv(env.REVIEW_FALLBACK_MODELS ?? DEFAULT_FALLBACK_MODELS),
    minConfidence: parsed.data.minConfidence,
    maxComments: parsed.data.maxComments,
    dryRun: args.dryRun ? true : parseBool(env.REVIEW_DRY_RUN, false),
    debug: parseBool(env.REVIEW_DEBUG, false),
    reviewOnDraft: parseBool(env.REVIEW_ON_DRAFT, DEFAULT_REVIEW_ON_DRAFT),
    allowSuggestions: parseBool(env.REVIEW_ALLOW_SUGGESTIONS, false),
    excludedPaths: [...DEFAULT_EXCLUDED_GLOBS, ...excluded],
    includedPaths: parseCsv(env.REVIEW_INCLUDED_PATHS),
    customGuidelines: env.REVIEW_CUSTOM_GUIDELINES?.trim() ?? "",
    triggerCommand: env.REVIEW_TRIGGER_COMMAND?.trim() || DEFAULT_TRIGGER_COMMAND,
    allowedAssociations: parseCsv(
      env.REVIEW_ALLOWED_ASSOCIATIONS ?? DEFAULT_ALLOWED_ASSOCIATIONS.join(","),
    ),
  };
}

/** A copy of the config with secret values masked, safe to log. */
export function redactedView(config: ReviewConfig): Record<string, unknown> {
  return {
    ...config,
    nanogptApiKey: "[REDACTED]",
    githubToken: "[REDACTED]",
  };
}
