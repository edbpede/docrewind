// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import BrandMark from "@/components/common/BrandMark";

afterEach(cleanup);

describe("BrandMark", () => {
  it("renders the canonical icon asset so manifest + UI share one source", () => {
    const { container } = render(() => <BrandMark />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    // Asserting the path, not a hashed bundle URL: the icon is a public asset
    // served at the extension root — the same file shipped as the manifest icon.
    expect(img?.getAttribute("src")).toBe("/icon/docrewind.svg");
  });

  it("is decorative by default (empty alt → out of the a11y tree)", () => {
    const { container } = render(() => <BrandMark />);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("carries an accessible name only when standalone", () => {
    const { container } = render(() => <BrandMark label="DocRewind" />);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("DocRewind");
  });

  it("sizes the chip from the size prop (default 36)", () => {
    const { container } = render(() => <BrandMark size={40} />);
    const chip = container.querySelector("span.dr-brandmark") as HTMLElement | null;
    expect(chip?.style.width).toBe("40px");
    expect(chip?.style.height).toBe("40px");
  });

  it("falls back to a 36px chip when no size prop is given", () => {
    const { container } = render(() => <BrandMark />);
    const chip = container.querySelector("span.dr-brandmark") as HTMLElement | null;
    expect(chip?.style.width).toBe("36px");
    expect(chip?.style.height).toBe("36px");
  });
});
