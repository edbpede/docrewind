// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared theme applier (plan Phase 5 Seam E). The ONLY browser-touching part of
// theming: it reads the persisted `theme` setting, computes the dark decision via
// the PURE `resolveDark` mapper, and toggles `.dark` on `<html>` (driving every
// presetWind4 `dark:` utility under the pinned class strategy). It re-applies on
// both the OS `prefers-color-scheme` change AND `theme.watch`, cleaning up both
// subscriptions on unmount. Mounted identically by the replay App and OptionsApp.

import { onCleanup, onMount } from "solid-js";
import { resolveDark } from "@/lib/core/theme";
import { theme } from "@/lib/platform/settings";

/** Wire live theme syncing for the current component owner. Call during setup. */
export function useThemeSync(): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  async function apply(): Promise<void> {
    const current = await theme.getValue();
    document.documentElement.classList.toggle("dark", resolveDark(current, media.matches));
  }

  onMount(() => {
    void apply();
    const onMediaChange = (): void => void apply();
    media.addEventListener("change", onMediaChange);
    const unwatch = theme.watch(() => void apply());
    onCleanup(() => {
      media.removeEventListener("change", onMediaChange);
      unwatch();
    });
  });
}
