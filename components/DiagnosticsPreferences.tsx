// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DiagnosticsPreferences (plan Phase 5 Step 8 / PRD §10.8). A SETTINGS TOGGLE
// ONLY: choose default vs. structural diagnostics verbosity, backed by
// `lib/settings.ts`. No diagnostic-report rendering ships in Phase 5 (deferred).
// Presented as an iOS-style grouped row with a segmented control on the right.

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
    <section class="dr-group" aria-labelledby="dr-diagnostics-heading">
      <h2 id="dr-diagnostics-heading" class="dr-group-label">
        {strings.options.diagnosticsHeading}
      </h2>
      <div class="dr-rows">
        <div class="dr-row-stack">
          <p class="dr-row-help">{strings.options.diagnosticsBody}</p>
          <fieldset class="seg m-0 self-start border-0">
            <legend class="sr-only">{strings.options.diagnosticsHeading}</legend>
            <Index each={MODES}>
              {(item) => (
                <button
                  type="button"
                  class={mode() === item() ? "seg-item seg-item-active" : "seg-item"}
                  aria-pressed={mode() === item()}
                  onClick={() => select(item())}
                >
                  {modeLabel(item())}
                </button>
              )}
            </Index>
          </fieldset>
        </div>
      </div>
    </section>
  );
};

export default DiagnosticsPreferences;
