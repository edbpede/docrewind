// SPDX-License-Identifier: AGPL-3.0-or-later
import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

// Phase 2 toolchain smoke test: proves the WXT/Vitest + vite-plugin-solid + jsdom
// pipeline runs a real Solid render. Replaced by genuine component tests in Phase 6.
describe("toolchain smoke", () => {
  it("renders a Solid component through the WXT/Vitest pipeline", () => {
    const { getByText } = render(() => <div>ok</div>);
    expect(getByText("ok")).toBeTruthy();
  });
});
