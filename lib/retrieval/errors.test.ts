// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { fail, ok, type RetrievalErrorCategory, retrievalError } from "./errors";

const ALL_CATEGORIES: RetrievalErrorCategory[] = [
  "unsupported-page",
  "missing-doc-id",
  "insufficient-permission",
  "endpoint-unavailable",
  "unsupported-format",
  "network-failure",
  "quota-failure",
  "reconstruction-failure",
  "cancellation",
];

describe("retrievalError", () => {
  test.each(ALL_CATEGORIES)("maps %p to a well-formed, content-free error", (category) => {
    const e = retrievalError(category);
    expect(e.category).toBe(category);
    expect(typeof e.userMessage).toBe("string");
    expect(e.userMessage.length).toBeGreaterThan(0);
    expect(typeof e.suggestedAction).toBe("string");
    expect(e.suggestedAction.length).toBeGreaterThan(0);
    expect(typeof e.recoverable).toBe("boolean");
  });

  test("network/quota/endpoint/cancellation are recoverable; format/permission are not", () => {
    expect(retrievalError("network-failure").recoverable).toBe(true);
    expect(retrievalError("quota-failure").recoverable).toBe(true);
    expect(retrievalError("endpoint-unavailable").recoverable).toBe(true);
    expect(retrievalError("cancellation").recoverable).toBe(true);
    expect(retrievalError("unsupported-format").recoverable).toBe(false);
    expect(retrievalError("insufficient-permission").recoverable).toBe(false);
  });

  test("the gated endpoint-unavailable error is the §24-stub outcome", () => {
    const e = retrievalError("endpoint-unavailable");
    expect(e.category).toBe("endpoint-unavailable");
    expect(e.recoverable).toBe(true);
  });
});

describe("Result helpers", () => {
  test("ok wraps a value", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });
  test("fail wraps an error", () => {
    const e = retrievalError("cancellation");
    expect(fail(e)).toEqual({ ok: false, error: e });
  });
});
