// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { detectUserIndex } from "./endpoints";
import { parseFramed, stripGuard } from "./framing";
import { detectSchema } from "./schema-detect";

describe("stripGuard", () => {
  test("strips the )]}' guard followed by a newline", () => {
    expect(stripGuard(")]}'\n[1,2,3]")).toBe("[1,2,3]");
  });

  test("strips the )]}' guard with a CRLF newline", () => {
    expect(stripGuard(')]}\'\r\n{"a":1}')).toBe('{"a":1}');
  });

  test("strips the )]}' guard even with no trailing newline", () => {
    expect(stripGuard(')]}\'{"a":1}')).toBe('{"a":1}');
  });

  test("passes text through unchanged when the guard is absent (fail-safe)", () => {
    expect(stripGuard('{"a":1}')).toBe('{"a":1}');
    expect(stripGuard("[]")).toBe("[]");
  });
});

describe("parseFramed", () => {
  test("parses guarded JSON", () => {
    expect(parseFramed(')]}\'\n{"changelog":[]}')).toEqual({ changelog: [] });
  });

  test("parses unguarded JSON (fail-safe)", () => {
    expect(parseFramed('{"changelog":[]}')).toEqual({ changelog: [] });
  });

  test("throws SyntaxError on malformed JSON after stripping the guard", () => {
    expect(() => parseFramed(")]}'\n{not json")).toThrow(SyntaxError);
  });
});

describe("detectSchema (fail-safe gate)", () => {
  test("recognizes a changelog record as json-changelog-v1", () => {
    expect(detectSchema({ changelog: [] })).toEqual({ kind: "json-changelog-v1" });
  });

  test("returns { kind: 'unknown' } for unrecognized payloads", () => {
    const unrecognized: readonly unknown[] = [
      null,
      undefined,
      42,
      "string",
      [],
      {},
      { changelog: "not-an-array" },
      { rpcids: "abc", "batchexecute-shaped": true },
    ];
    for (const payload of unrecognized) {
      expect(detectSchema(payload)).toEqual({ kind: "unknown" });
    }
  });
});

describe("detectUserIndex (/u/{N}/ variant, A.5)", () => {
  test("extracts the multi-account slot", () => {
    expect(detectUserIndex("https://docs.google.com/u/1/document/d/abc/edit")).toBe(1);
    expect(detectUserIndex("https://docs.google.com/u/0/document/d/abc/edit")).toBe(0);
  });

  test("returns null for a single-account path", () => {
    expect(detectUserIndex("https://docs.google.com/document/d/abc/edit")).toBeNull();
  });
});
