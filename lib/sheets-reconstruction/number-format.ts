// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Minimal number-format pattern interpreter (plan §0 / P2). Google number-format
// patterns (`[$kr-406] #,##0.00`, `0.00%`, `#,##0`) are a formatting GRAMMAR, not
// CSS. v1 interprets the COMMON shapes — plain integer/decimal, thousands
// separator, percent, and a currency prefix/suffix — and returns `null` for
// anything it does not understand, so the caller falls back to the raw value and
// raises a fidelity notice (never silently wrong).
//
// Deterministic + locale-free: grouping is a literal "," and the decimal point a
// literal "." so output never depends on the host locale (the privacy model
// forbids leaking it and tests must be stable).
//
// PURE: no browser / fetch / Worker.

/** The parsed, supported subset of a number-format pattern. */
export interface NumberFormatSpec {
  readonly prefix: string;
  readonly suffix: string;
  readonly useGrouping: boolean;
  readonly decimals: number;
  readonly percent: boolean;
}

// A currency token: `[$<symbol>-<locale-hex>]` or `[$<symbol>]`. The symbol is
// kept as a literal; the locale id is dropped (locale is not rendered).
const CURRENCY_TOKEN = /\[\$([^\]-]*)(?:-[0-9A-Za-z]+)?\]/g;
// The numeric skeleton: a run of #/0 with optional grouping commas + decimals.
const SKELETON = /[#0][#0,]*(?:\.[#0]+)?/;
// Tokens that mark a pattern v1 does NOT support (dates, scientific, multi-
// section, fill/padding, and `"`-quoted literal text) — reject so the caller
// falls back honestly. v1 does not strip `"` delimiters, so a quoted run like
// `0.00" kr"` would otherwise leak the literal quote chars into the output.
const UNSUPPORTED = /[eE?@*;yYmMdDhHsS"]/;

/**
 * Parse a number-format pattern into the supported {@link NumberFormatSpec}, or
 * `null` when the pattern is outside v1's common-shapes scope.
 */
export function parseNumberFormat(pattern: string): NumberFormatSpec | null {
  if (pattern.length === 0) return null;

  // Replace currency tokens with their literal symbol, in place.
  let working = pattern.replace(CURRENCY_TOKEN, (_match, symbol: string) => symbol);
  // Unescape `\<char>` literals (e.g. `\ ` → a literal space).
  working = working.replace(/\\(.)/g, "$1");

  const percent = working.includes("%");
  // Strip the percent marker before isolating prefix/suffix; we re-append it.
  const withoutPercent = working.replace(/%/g, "");

  const match = SKELETON.exec(withoutPercent);
  if (match === null) return null;

  const prefix = withoutPercent.slice(0, match.index);
  const suffix = withoutPercent.slice(match.index + match[0].length);

  // Reject exotic tokens that survived in the literal affixes (dates, scientific,
  // multi-section, etc.) — those are not the "common shapes" v1 supports.
  if (UNSUPPORTED.test(prefix) || UNSUPPORTED.test(suffix)) return null;

  const skeleton = match[0];
  const useGrouping = skeleton.includes(",");
  const dotIndex = skeleton.indexOf(".");
  const decimals = dotIndex === -1 ? 0 : skeleton.length - dotIndex - 1;

  return { prefix, suffix, useGrouping, decimals, percent };
}

/** True when {@link formatNumber} can render this pattern. */
export function isSupportedNumberFormat(pattern: string): boolean {
  return parseNumberFormat(pattern) !== null;
}

/** Insert grouping commas every three digits into a run of integer digits. */
function group(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a numeric value with a Google number-format pattern, or `null` when the
 * pattern is unsupported (the caller then shows the raw value + a fidelity
 * notice). Deterministic and locale-free.
 */
export function formatNumber(pattern: string, value: number): string | null {
  const spec = parseNumberFormat(pattern);
  if (spec === null || !Number.isFinite(value)) return null;

  const scaled = spec.percent ? value * 100 : value;
  const negative = scaled < 0;
  const fixed = Math.abs(scaled).toFixed(spec.decimals);
  const [intPart = "0", fracPart] = fixed.split(".");
  const groupedInt = spec.useGrouping ? group(intPart) : intPart;
  const numeric = fracPart !== undefined ? `${groupedInt}.${fracPart}` : groupedInt;
  const percentSuffix = spec.percent ? "%" : "";

  return `${negative ? "-" : ""}${spec.prefix}${numeric}${spec.suffix}${percentSuffix}`;
}
