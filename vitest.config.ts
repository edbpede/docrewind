// SPDX-License-Identifier: AGPL-3.0-or-later
import solid from "vite-plugin-solid";
import { configDefaults, defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing";

// WxtVitest() wires WXT globals, the fake browser, #imports, and tsconfig paths,
// but it does NOT include the vite-plugin-solid that @wxt-dev/module-solid adds at
// build time — so Solid JSX in tests must be transformed by adding solid() here.
// resolve.conditions is Solid's documented requirement for correct dev/browser
// export resolution under Vitest.
export default defineConfig({
  plugins: [solid(), WxtVitest()],
  resolve: { conditions: ["development", "browser"] },
  test: {
    environment: "jsdom",
    globals: true,
    // The pure-core tiers (decoder/reconstruction/timeline/domain/protocol/fixtures)
    // run under Bun (`test:logic`) and import `bun:test`, which Vitest cannot resolve.
    // Keep them out of Vitest; Phase 4/5 storage/messaging tests (e.g. lib/platform/db.test.ts)
    // live directly under lib/ and still run here.
    exclude: [
      ...configDefaults.exclude,
      "lib/core/docs/decoder/**",
      "lib/core/docs/reconstruction/**",
      "lib/core/timeline/**",
      "lib/core/domain/**",
      "lib/core/protocol/**",
      "lib/core/fixtures/**",
      // Phase 4 pure tiers also run under Bun (`test:logic`) and import
      // `bun:test`, which Vitest cannot resolve — keep them out of Vitest.
      "lib/core/retrieval/**",
      "lib/core/worker/**",
      "lib/core/docs-url/**",
      // Phase 5 pure modules (replay/i18n/identity/theme) are Bun-only (`test:logic`).
      "lib/core/replay/**",
      // Sheets + Slides cores + the shared replay-core spine are Bun-only pure tiers.
      "lib/core/replay-core/**",
      "lib/core/sheets/decoder/**",
      "lib/core/sheets/reconstruction/**",
      "lib/core/slides/decoder/**",
      "lib/core/slides/reconstruction/**",
      "lib/core/i18n/**",
      "lib/core/identity/**",
      "lib/core/classroom/**",
      "lib/core/summary/**",
      "lib/core/theme.test.ts",
      // Playwright owns assembled-extension specs under e2e/.
      "e2e/**",
    ],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
