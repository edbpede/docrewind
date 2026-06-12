// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { createLogger, registerSecrets, resetSecretsForTest } from "../logger";

afterEach(() => {
  resetSecretsForTest();
});

function captureOutput(run: () => void): string {
  const out = spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    run();
    const lines = [...out.mock.calls, ...err.mock.calls].map((args) => String(args[0]));
    return lines.join("");
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

describe("logger redaction", () => {
  it("never emits a registered secret in the message or fields", () => {
    registerSecrets(["sk-supersecret", "ghp-token"]);
    const logger = createLogger({ debug: false });
    const output = captureOutput(() => {
      logger.info("calling api with sk-supersecret", { auth: "Bearer ghp-token", ok: true });
    });
    expect(output).not.toContain("sk-supersecret");
    expect(output).not.toContain("ghp-token");
    expect(output).toContain("[REDACTED]");
  });

  it("still redacts when debug is enabled", () => {
    registerSecrets(["sk-supersecret"]);
    const logger = createLogger({ debug: true });
    const output = captureOutput(() => {
      logger.debug("debug line", { token: "sk-supersecret" });
    });
    expect(output).not.toContain("sk-supersecret");
    expect(output).toContain("[REDACTED]");
  });

  it("ignores empty/whitespace secret values (cannot blank the logs)", () => {
    registerSecrets(["", "   ", undefined]);
    const logger = createLogger({ debug: false });
    const output = captureOutput(() => {
      logger.info("plain message", { value: "visible" });
    });
    expect(output).toContain("visible");
    expect(output).not.toContain("[REDACTED]");
  });

  it("suppresses debug lines when debug is false", () => {
    const logger = createLogger({ debug: false });
    const output = captureOutput(() => {
      logger.debug("should not appear");
    });
    expect(output).toBe("");
  });

  it("redact() scrubs an arbitrary string (dry-run path)", () => {
    registerSecrets(["sk-supersecret"]);
    const logger = createLogger({ debug: false });
    expect(logger.redact("x sk-supersecret y")).toBe("x [REDACTED] y");
  });
});
