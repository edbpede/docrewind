// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig, presetWind4 } from "unocss";

// Placeholder-minimal design tokens. The deliberate visual identity is Phase 5's
// `frontend-design` job — do not grow this into a de-facto design system here.
export default defineConfig({
  presets: [presetWind4({ reset: true })],
  shortcuts: {
    btn: "px-3 py-1.5 rounded bg-brand text-white hover:opacity-90",
    card: "p-4 rounded-lg shadow bg-white dark:bg-gray-800",
    panel: "p-3 rounded border border-gray-200 dark:border-gray-700",
    timeline: "flex items-center gap-2",
  },
  theme: {
    colors: { brand: "#6d28d9" },
  },
});
