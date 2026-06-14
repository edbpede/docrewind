// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DiagnosticsPreferences (plan Phase 5 Step 8 / PRD §10.8). A SETTINGS TOGGLE
// ONLY: choose default vs. structural diagnostics verbosity, backed by
// `lib/settings.ts`. No diagnostic-report rendering ships in Phase 5 (deferred).

import type { Component } from "solid-js";
import { createResource, Index } from "solid-js";
import { strings } from "@/lib/i18n/strings";
import { type DiagnosticsMode, diagnosticsMode } from "@/lib/settings";

const MODES = ["default", "structural"] as const satisfies readonly DiagnosticsMode[];

function modeLabel(mode: DiagnosticsMode): string {
  return mode === "default"
    ? strings.options.diagnosticsDefault
    : strings.options.diagnosticsStructural;
}

const DiagnosticsPreferences: Component = () => {
  const [mode, { mutate }] = createResource(() => diagnosticsMode.getValue());

  function select(next: DiagnosticsMode): void {
    mutate(next);
    void diagnosticsMode.setValue(next);
  }

  return (
    <section class="dr-card" aria-labelledby="dr-diagnostics-heading">
      <h2 id="dr-diagnostics-heading" class="mb-1 font-medium">
        {strings.options.diagnosticsHeading}
      </h2>
      <p class="mb-2 text-sm text-stone-700 dark:text-stone-300">
        {strings.options.diagnosticsBody}
      </p>
      <fieldset class="m-0 inline-flex gap-1 border-0 p-0">
        <legend class="sr-only">{strings.options.diagnosticsHeading}</legend>
        <Index each={MODES}>
          {(item) => (
            <button
              type="button"
              class={mode() === item() ? "btn-ghost btn-active" : "btn-ghost"}
              aria-pressed={mode() === item()}
              onClick={() => select(item())}
            >
              {modeLabel(item())}
            </button>
          )}
        </Index>
      </fieldset>
    </section>
  );
};

export default DiagnosticsPreferences;
