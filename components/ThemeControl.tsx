// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ThemeControl — the shared light/dark/system appearance selector. A pill-style
// segmented control (`seg`/`seg-item`/`seg-item-active`) wired to the persisted
// `theme` setting via `createResource` (read) + `theme.setValue` (write). The SAME
// control mounts in OptionsApp, PopupApp, and the replay surface so every UI reads
// and writes ONE source of truth; whichever host mounts it also mounts
// `useThemeSync`, so the `.dark` class on `<html>` repaints live the instant
// `setValue` lands.
//
// Two presentations from one widget:
//   • default — a `dr-row` (visible label ↔ segmented control) for the grouped
//     settings cards in OptionsApp/PopupApp; the host owns the `dr-rows` chrome.
//   • `bare`  — just the segmented control (accessible name from the sr-only
//     legend) for inline placement like the replay footer.
//
// Solid idioms: `props.x` (never destructured), `class` (never `className`),
// `<For>`/`<Show>` over `.map()`/ternaries.

import type { Component } from "solid-js";
import { createResource, For, Show } from "solid-js";
import { strings } from "@/lib/i18n/strings";
import { type Theme, theme } from "@/lib/settings";

/** The three supported theme states, in display order, with localized labels. */
export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "system", label: strings.options.themeSystem },
  { value: "light", label: strings.options.themeLight },
  { value: "dark", label: strings.options.themeDark },
];

/** The pill row itself: an accessible `seg` group over the three theme states. */
const ThemeSegmented: Component<{
  readonly value: Theme;
  readonly onChange: (next: Theme) => void;
}> = (props) => (
  <fieldset class="seg m-0 border-0">
    <legend class="sr-only">{strings.options.themeLabel}</legend>
    <For each={THEME_OPTIONS}>
      {(option) => (
        <button
          type="button"
          class={props.value === option.value ? "seg-item seg-item-active" : "seg-item"}
          aria-pressed={props.value === option.value}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      )}
    </For>
  </fieldset>
);

/**
 * Segmented light/dark/system selector bound to the persisted `theme` setting.
 * Pass `bare` to render the pills alone (no labeled row) for inline hosts.
 */
const ThemeControl: Component<{ readonly bare?: boolean }> = (props) => {
  const [themeValue, { mutate: mutateTheme }] = createResource(() => theme.getValue());

  function onTheme(next: Theme): void {
    if (themeValue() === next) return;
    mutateTheme(next);
    void theme.setValue(next);
  }

  return (
    <Show
      when={!props.bare}
      fallback={<ThemeSegmented value={themeValue() ?? "system"} onChange={onTheme} />}
    >
      <div class="dr-row">
        <span class="dr-row-label">{strings.options.themeLabel}</span>
        <ThemeSegmented value={themeValue() ?? "system"} onChange={onTheme} />
      </div>
    </Show>
  );
};

export default ThemeControl;
