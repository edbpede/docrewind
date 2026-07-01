// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Theme resolution mapper (plan Phase 5 Seam E / Step 2b). The ONLY branching for
// dark-mode resolution lives here, kept PURE and browser-free (no `matchMedia`,
// no `document`) so it is Bun-unit-testable. The DOM applier in the replay App and
// OptionsApp is a thin wrapper that feeds this function `theme.getValue()` and the
// live `matchMedia("(prefers-color-scheme: dark)")` result, then toggles `.dark`.

import type { Theme } from "@/lib/platform/settings";

/**
 * Decide whether dark mode should be active. `"dark"`/`"light"` are explicit
 * overrides; `"system"` defers to the OS preference (`prefersDark`).
 */
export function resolveDark(theme: Theme, prefersDark: boolean): boolean {
  switch (theme) {
    case "dark":
      return true;
    case "light":
      return false;
    case "system":
      return prefersDark;
    default: {
      const _exhaustive: never = theme;
      return _exhaustive;
    }
  }
}
