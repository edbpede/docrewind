// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Structured, secret-redacting logger (plan §14). Two invariants drive this
// module:
//
//   * Secrets (NANOGPT_API_KEY, GITHUB_TOKEN) must NEVER reach stdout/stderr,
//     not even with REVIEW_DEBUG=true. Concrete secret values are registered at
//     startup and string-replaced out of every payload before it is written.
//   * Full prompts, chain-of-thought, and raw document/response bodies are a
//     privacy concern and are simply never passed to the logger by callers; the
//     logger additionally truncates long strings as a backstop.
//
// Output is single-line JSON so CI logs stay greppable. There is intentionally
// no transport beyond console — this is CI/dev tooling, not the extension.

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Secret values to scrub from every logged payload. Populated at startup. */
const secrets = new Set<string>();

/** Max length for any single string value before truncation (backstop). */
const MAX_STRING = 2000;

export interface LoggerOptions {
  /** Emit `debug`-level lines when true (REVIEW_DEBUG). */
  readonly debug: boolean;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Redact registered secrets from an arbitrary string (e.g. dry-run output). */
  redact(value: string): string;
}

/**
 * Register secret literals to be scrubbed from all future log output. Empty /
 * whitespace-only values are ignored so an unset env var can't blank the logs.
 */
export function registerSecrets(values: readonly (string | undefined)[]): void {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      secrets.add(value);
    }
  }
}

/** Replace every registered secret occurrence with a fixed marker. */
function redactString(input: string): string {
  let out = input;
  for (const secret of secrets) {
    if (out.includes(secret)) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…[truncated]` : out;
}

/** Deep-redact a JSON-serializable value, scrubbing secrets from all strings. */
function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = redactValue(val);
    }
    return out;
  }
  return value;
}

function emit(
  options: LoggerOptions,
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
): void {
  if (!options.debug && level === "debug") {
    return;
  }
  const record: Record<string, unknown> = { level, msg: redactString(message) };
  if (fields) {
    Object.assign(record, redactValue(fields) as Record<string, unknown>);
  }
  const line = JSON.stringify(record);
  if (LEVEL_ORDER[level] >= LEVEL_ORDER.warn) {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

/** Build a logger bound to the given options. Secrets are process-global. */
export function createLogger(options: LoggerOptions): Logger {
  return {
    debug: (message, fields) => emit(options, "debug", message, fields),
    info: (message, fields) => emit(options, "info", message, fields),
    warn: (message, fields) => emit(options, "warn", message, fields),
    error: (message, fields) => emit(options, "error", message, fields),
    redact: redactString,
  };
}

/** Test-only: clear the registered secret set between cases. */
export function resetSecretsForTest(): void {
  secrets.clear();
}
