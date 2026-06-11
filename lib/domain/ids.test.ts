// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import {
  asDocId,
  asRevisionId,
  asSessionId,
  asUserId,
  unsafeAsDocId,
  unsafeAsRevisionId,
} from "./ids";

describe("asDocId", () => {
  test("accepts valid [A-Za-z0-9_-] ids", () => {
    expect(asDocId("1aB2_c-3D")).toBe("1aB2_c-3D" as ReturnType<typeof asDocId>);
  });

  test("rejects an empty string", () => {
    expect(() => asDocId("")).toThrow(TypeError);
  });

  test.each([
    "has space",
    "slash/here",
    "dot.here",
    "bang!",
    "uni€ode",
  ])("rejects malformed id %p", (bad) => {
    expect(() => asDocId(bad)).toThrow(TypeError);
  });
});

describe("asRevisionId", () => {
  test("accepts positive integers", () => {
    expect(asRevisionId(1)).toBe(1 as ReturnType<typeof asRevisionId>);
    expect(asRevisionId(9999)).toBe(9999 as ReturnType<typeof asRevisionId>);
  });

  test.each([
    0,
    -1,
    -100,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects non-positive / non-integer %p", (bad) => {
    expect(() => asRevisionId(bad)).toThrow(TypeError);
  });
});

describe("asSessionId / asUserId", () => {
  test("accept non-empty strings", () => {
    expect(asSessionId("sess-1")).toBe("sess-1" as ReturnType<typeof asSessionId>);
    expect(asUserId("user-1")).toBe("user-1" as ReturnType<typeof asUserId>);
  });

  test.each(["", "   ", "\t\n"])("reject empty / whitespace-only %p", (bad) => {
    expect(() => asSessionId(bad)).toThrow(TypeError);
    expect(() => asUserId(bad)).toThrow(TypeError);
  });
});

describe("unsafe blind casts", () => {
  test("brand without validating (trusted boundary)", () => {
    // Deliberately a value asDocId would reject — unsafe* skips validation.
    expect(unsafeAsDocId("not valid!")).toBe("not valid!" as ReturnType<typeof unsafeAsDocId>);
    expect(unsafeAsRevisionId(-5)).toBe(-5 as ReturnType<typeof unsafeAsRevisionId>);
  });
});
