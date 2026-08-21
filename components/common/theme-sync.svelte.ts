// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared theme applier (plan Phase 5 Seam E). The ONLY browser-touching part of
// theming: it reads the persisted `theme` setting, computes the dark decision via
// the PURE `resolveDark` mapper, and toggles `.dark` on `<html>` (driving every
// presetWind4 `dark:` utility under the pinned class strategy). It re-applies on
// both the OS `prefers-color-scheme` change AND `theme.watch`, cleaning up both
// subscriptions on unmount. Mounted identically by the replay App and OptionsApp.
//
// This is a `.svelte.ts` module because it uses `$effect`: the DOM subscriptions
// are set up once the calling component mounts and torn down when it is destroyed,
// which is exactly the ownership `$effect`'s returned teardown gives us. The effect
// body reads no reactive state, so it runs once per component lifetime.

import { resolveDark } from "@/lib/core/theme";
import { theme } from "@/lib/platform/settings";

/** Wire live theme syncing for the calling component. Call during its setup. */
export function useThemeSync(): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  async function apply(): Promise<void> {
    const current = await theme.getValue();
    document.documentElement.classList.toggle("dark", resolveDark(current, media.matches));
  }

  $effect(() => {
    void apply();
    const onMediaChange = (): void => void apply();
    media.addEventListener("change", onMediaChange);
    const unwatch = theme.watch(() => void apply());
    return () => {
      media.removeEventListener("change", onMediaChange);
      unwatch();
    };
  });
}
