// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Framework adapter for the CSS property maps produced by the pure core.
// `lib/core/replay/style-css.ts` (and friends) deliberately return a
// `Record<string, string>` so `lib/` stays framework-agnostic and unit-testable
// against a plain object shape — `style-css.test.ts` asserts exactly that.
// Svelte's `style` attribute, unlike Solid's, takes a STRING, so exactly one
// place in the tree needs to know the target framework's attribute shape: here.
// Keeping the adapter in `components/` means the port never touches `lib/`.

/**
 * Serialize a CSS property map (as produced by `lib/core/replay/style-css`) into
 * the string Svelte's `style` attribute takes. Returns `undefined` for an absent
 * or empty map so the attribute is omitted entirely rather than emitted blank.
 */
export function cssText(style: Record<string, string> | undefined): string | undefined {
  if (style === undefined) return undefined;
  const entries = Object.entries(style);
  return entries.length === 0 ? undefined : entries.map(([k, v]) => `${k}:${v}`).join(";");
}
