// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { formatNumber, isSupportedNumberFormat, parseNumberFormat } from "./number-format";

describe("number-format — common shapes", () => {
  test("plain integer", () => {
    expect(formatNumber("0", 1234)).toBe("1234");
  });

  test("fixed decimals", () => {
    expect(formatNumber("0.00", 3.5)).toBe("3.50");
    expect(formatNumber("0.00", 3.456)).toBe("3.46");
  });

  test("thousands separator", () => {
    expect(formatNumber("#,##0", 1234567)).toBe("1,234,567");
    expect(formatNumber("#,##0.00", 1234567.5)).toBe("1,234,567.50");
  });

  test("percent scales by 100 and appends %", () => {
    expect(formatNumber("0%", 0.25)).toBe("25%");
    expect(formatNumber("0.00%", 0.1234)).toBe("12.34%");
  });

  test("currency prefix from a [$..] token", () => {
    expect(formatNumber("[$kr-406] #,##0.00", 1234.5)).toBe("kr 1,234.50");
    expect(formatNumber("$#,##0.00", 9.5)).toBe("$9.50");
  });

  test("negative values keep the sign before the prefix", () => {
    expect(formatNumber("$#,##0.00", -9.5)).toBe("-$9.50");
  });
});

describe("number-format — unsupported patterns fall back", () => {
  test("date and scientific patterns return null", () => {
    expect(formatNumber("yyyy-mm-dd", 45000)).toBeNull();
    expect(formatNumber("0.00E+00", 12345)).toBeNull();
    expect(isSupportedNumberFormat("yyyy-mm-dd")).toBe(false);
  });

  test("multi-section patterns return null", () => {
    expect(formatNumber("#,##0;(#,##0)", 5)).toBeNull();
  });

  test("quoted literal text returns null (quotes are not stripped)", () => {
    expect(parseNumberFormat('0.00" kr"')).toBeNull();
    expect(isSupportedNumberFormat('0.00" kr"')).toBe(false);
    expect(formatNumber('0.00" kr"', 5.5)).toBeNull();
  });

  test("an empty pattern returns null", () => {
    expect(parseNumberFormat("")).toBeNull();
    expect(formatNumber("", 5)).toBeNull();
  });

  test("a non-finite value returns null", () => {
    expect(formatNumber("0.00", Number.NaN)).toBeNull();
  });
});
