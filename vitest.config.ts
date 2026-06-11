// SPDX-License-Identifier: AGPL-3.0-or-later
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";
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
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
