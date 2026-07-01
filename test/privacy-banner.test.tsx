// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyBanner from "@/components/common/PrivacyBanner";
import { strings } from "@/lib/core/i18n/strings";

afterEach(cleanup);

describe("PrivacyBanner (collapsible disclosure)", () => {
  it("keeps the reconstruction headline visible while collapsed by default", () => {
    const { getByRole } = render(() => <PrivacyBanner />);
    // The key trust line IS the trigger's accessible name — always present, never
    // hidden (the shield + chevron icons are aria-hidden, so the title names it).
    const toggle = getByRole("button", { name: strings.privacy.bannerTitle });
    expect(toggle.textContent).toContain(strings.privacy.bannerTitle);
    // Collapsed on first view: only the headline shows; detail opens on demand.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles the detail open/collapsed and announces state via aria", () => {
    const { container, getByRole } = render(() => <PrivacyBanner />);
    const toggle = getByRole("button");
    const collapse = container.querySelector(".banner-collapse") as HTMLElement;
    const detailId = toggle.getAttribute("aria-controls");

    // Trigger controls the detail region by id, for assistive tech.
    expect(detailId).toBeTruthy();
    expect(container.querySelector(`#${detailId}`)).not.toBeNull();
    expect(collapse.getAttribute("data-collapsed")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(collapse.getAttribute("data-collapsed")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(collapse.getAttribute("data-collapsed")).toBe("true");
  });

  it("renders the approximation note only when supplied", () => {
    const { queryByText, unmount } = render(() => <PrivacyBanner />);
    expect(queryByText(strings.privacy.approximationNote)).toBeNull();
    unmount();

    const withNote = render(() => (
      <PrivacyBanner approximationNote={strings.privacy.approximationNote} />
    ));
    expect(withNote.getByText(strings.privacy.approximationNote)).toBeTruthy();
  });
});
