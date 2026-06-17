// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import PopupApp from "@/components/PopupApp";
import { strings } from "@/lib/i18n/strings";

// useThemeSync reads window.matchMedia on mount; jsdom omits it.
function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

afterEach(cleanup);

describe("PopupApp", () => {
  beforeEach(() => {
    installMatchMedia();
    // Deterministic manifest + an observable options-page opener.
    fakeBrowser.runtime.getManifest = (() => ({ version: "1.2.3" })) as never;
    fakeBrowser.runtime.openOptionsPage = vi.fn(async () => {}) as never;
  });

  it("shows the concise description and quick-access actions on the overview", () => {
    render(() => <PopupApp />);
    expect(screen.getByText(strings.popup.description)).toBeTruthy();
    expect(screen.getByText(strings.popup.privacyNote)).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.popup.optionsButton })).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.popup.aboutButton })).toBeTruthy();
  });

  it("opens the options page via runtime.openOptionsPage (no tabs permission)", () => {
    render(() => <PopupApp />);
    fireEvent.click(screen.getByRole("button", { name: strings.popup.optionsButton }));
    expect(fakeBrowser.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it("toggles to the About ledger showing version, author edbpede, and license", () => {
    render(() => <PopupApp />);
    fireEvent.click(screen.getByRole("button", { name: strings.popup.aboutButton }));

    expect(screen.getByText(strings.popup.aboutHeading)).toBeTruthy();
    // Manifest version is surfaced (mono pill + ledger row both render it).
    expect(screen.getAllByText("1.2.3").length).toBeGreaterThan(0);

    const author = screen.getByText(strings.popup.authorHandle) as HTMLAnchorElement;
    expect(author.tagName).toBe("A");
    expect(author.getAttribute("href")).toBe(strings.popup.authorUrl);

    const source = screen.getByText(strings.popup.sourceText) as HTMLAnchorElement;
    expect(source.getAttribute("href")).toBe(strings.popup.sourceUrl);
    expect(source.getAttribute("rel")).toContain("noopener");

    expect(screen.getByText(strings.popup.licenseValue)).toBeTruthy();
  });

  it("returns to the overview from the About view", () => {
    render(() => <PopupApp />);
    fireEvent.click(screen.getByRole("button", { name: strings.popup.aboutButton }));
    fireEvent.click(screen.getByRole("button", { name: strings.popup.backHint }));
    expect(screen.getByText(strings.popup.description)).toBeTruthy();
  });
});
