// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bun unit test for the pure theme mapper (plan Phase 5 §3). Table-tests all three
// `Theme` values across both `prefersDark` inputs — the full decision surface.

import { describe, expect, it } from "bun:test";
import { resolveDark } from "@/lib/core/theme";
import type { Theme } from "@/lib/platform/settings";

describe("resolveDark", () => {
  const cases: ReadonlyArray<{ theme: Theme; prefersDark: boolean; expected: boolean }> = [
    { theme: "dark", prefersDark: false, expected: true },
    { theme: "dark", prefersDark: true, expected: true },
    { theme: "light", prefersDark: false, expected: false },
    { theme: "light", prefersDark: true, expected: false },
    { theme: "system", prefersDark: false, expected: false },
    { theme: "system", prefersDark: true, expected: true },
  ];

  for (const { theme, prefersDark, expected } of cases) {
    it(`theme=${theme} prefersDark=${prefersDark} -> ${expected}`, () => {
      expect(resolveDark(theme, prefersDark)).toBe(expected);
    });
  }
});
