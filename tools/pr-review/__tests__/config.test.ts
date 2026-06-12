// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { ConfigError, loadConfig, redactedView } from "../config";
import {
  DEFAULT_ALLOWED_ASSOCIATIONS,
  DEFAULT_REVIEW_ON_DRAFT,
  DEFAULT_TRIGGER_COMMAND,
} from "../policy";

const baseEnv: Record<string, string> = {
  NANOGPT_API_KEY: "sk-secret",
  GITHUB_TOKEN: "ghp-secret",
  GITHUB_REPOSITORY: "edbpede/docrewind",
  PR_NUMBER: "42",
};

describe("loadConfig", () => {
  it("parses a valid env with documented defaults", () => {
    const config = loadConfig({ env: baseEnv, argv: [] });
    expect(config.owner).toBe("edbpede");
    expect(config.repo).toBe("docrewind");
    expect(config.prNumber).toBe(42);
    expect(config.minConfidence).toBe(0.75);
    expect(config.maxComments).toBe(5);
    expect(config.dryRun).toBe(false);
    expect(config.model).toBe("deepseek/deepseek-v4-pro-cheaper:thinking");
    expect(config.fallbackModels).toEqual([
      "xiaomi/mimo-v2.5-pro:thinking",
      "minimax/minimax-m3:thinking",
    ]);
    expect(config.reviewOnDraft).toBe(DEFAULT_REVIEW_ON_DRAFT);
    expect(config.triggerCommand).toBe(DEFAULT_TRIGGER_COMMAND);
    expect(config.allowedAssociations).toEqual([...DEFAULT_ALLOWED_ASSOCIATIONS]);
    expect(config.excludedPaths).toContain("bun.lock");
  });

  it("throws ConfigError when NANOGPT_API_KEY is missing", () => {
    const { NANOGPT_API_KEY: _omit, ...env } = baseEnv;
    expect(() => loadConfig({ env, argv: [] })).toThrow(ConfigError);
  });

  it("throws ConfigError when GITHUB_TOKEN is missing", () => {
    const { GITHUB_TOKEN: _omit, ...env } = baseEnv;
    expect(() => loadConfig({ env, argv: [] })).toThrow(ConfigError);
  });

  it("throws ConfigError when GITHUB_REPOSITORY is not owner/repo", () => {
    expect(() => loadConfig({ env: { ...baseEnv, GITHUB_REPOSITORY: "nope" }, argv: [] })).toThrow(
      ConfigError,
    );
  });

  it("throws ConfigError for a non-numeric PR number", () => {
    expect(() => loadConfig({ env: { ...baseEnv, PR_NUMBER: "abc" }, argv: [] })).toThrow(
      ConfigError,
    );
  });

  it("reads the PR number and dry-run from CLI args", () => {
    const env = { ...baseEnv };
    delete (env as Record<string, string | undefined>).PR_NUMBER;
    const config = loadConfig({ env, argv: ["--pr", "7", "--dry-run"] });
    expect(config.prNumber).toBe(7);
    expect(config.dryRun).toBe(true);
  });

  it("supports --pr=<n> form", () => {
    const env = { ...baseEnv };
    delete (env as Record<string, string | undefined>).PR_NUMBER;
    const config = loadConfig({ env, argv: ["--pr=99"] });
    expect(config.prNumber).toBe(99);
  });

  it("merges custom excluded paths after the built-ins", () => {
    const config = loadConfig({
      env: { ...baseEnv, REVIEW_EXCLUDED_PATHS: "foo/**, bar.txt" },
      argv: [],
    });
    expect(config.excludedPaths).toContain("foo/**");
    expect(config.excludedPaths).toContain("bar.txt");
  });

  it("keeps policy knobs overridable without changing defaults", () => {
    const config = loadConfig({
      env: {
        ...baseEnv,
        REVIEW_ON_DRAFT: "true",
        REVIEW_TRIGGER_COMMAND: "/docrewind-review",
        REVIEW_ALLOWED_ASSOCIATIONS: "OWNER,CONTRIBUTOR",
      },
      argv: [],
    });

    expect(config.reviewOnDraft).toBe(true);
    expect(config.triggerCommand).toBe("/docrewind-review");
    expect(config.allowedAssociations).toEqual(["OWNER", "CONTRIBUTOR"]);
  });

  it("parses booleans from REVIEW_* envs", () => {
    const config = loadConfig({
      env: { ...baseEnv, REVIEW_ON_DRAFT: "true", REVIEW_ALLOW_SUGGESTIONS: "1" },
      argv: [],
    });
    expect(config.reviewOnDraft).toBe(true);
    expect(config.allowSuggestions).toBe(true);
  });
});

describe("redactedView", () => {
  it("masks both secrets", () => {
    const view = redactedView(loadConfig({ env: baseEnv, argv: [] }));
    expect(view.nanogptApiKey).toBe("[REDACTED]");
    expect(view.githubToken).toBe("[REDACTED]");
    expect(JSON.stringify(view)).not.toContain("sk-secret");
    expect(JSON.stringify(view)).not.toContain("ghp-secret");
  });
});
