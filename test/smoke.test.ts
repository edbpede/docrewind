// SPDX-License-Identifier: AGPL-3.0-or-later
import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import Smoke from "./fixtures/Smoke.svelte";

// Phase 2 toolchain smoke test: proves the WXT/Vitest + @sveltejs/vite-plugin-svelte
// + jsdom pipeline runs a real Svelte render. Replaced by genuine component tests in
// Phase 6.
describe("toolchain smoke", () => {
  it("renders a Svelte component through the WXT/Vitest pipeline", () => {
    const { getByText } = render(Smoke);
    expect(getByText("ok")).toBeTruthy();
  });
});
