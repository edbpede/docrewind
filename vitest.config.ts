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
    // Keep them out of Vitest; Phase 4/5 storage/messaging tests (e.g. lib/db.test.ts)
    // live directly under lib/ and still run here.
    exclude: [
      ...configDefaults.exclude,
      "lib/decoder/**",
      "lib/reconstruction/**",
      "lib/timeline/**",
      "lib/domain/**",
      "lib/protocol/**",
      "lib/fixtures/**",
      // Phase 4 pure tiers also run under Bun (`test:logic`) and import
      // `bun:test`, which Vitest cannot resolve — keep them out of Vitest.
      "lib/retrieval/**",
      "lib/worker/**",
      "lib/docs-url/**",
      // Phase 5 pure modules (render/load/theme/i18n) are Bun-only (`test:logic`).
      "lib/replay/**",
      "lib/i18n/**",
      "lib/identity/**",
      "lib/theme.test.ts",
      // Playwright owns assembled-extension specs under e2e/.
      "e2e/**",
    ],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
