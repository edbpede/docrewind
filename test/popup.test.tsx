// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import PopupApp from "@/components/popup/PopupApp";
import { strings } from "@/lib/core/i18n/strings";
import { theme } from "@/lib/platform/settings";

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
    fakeBrowser.reset();
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

  it("renders the theme selector with the system option selected by default", async () => {
    await theme.setValue("system");
    render(() => <PopupApp />);

    const system = await screen.findByRole("button", { name: strings.options.themeSystem });
    const light = screen.getByRole("button", { name: strings.options.themeLight });
    const dark = screen.getByRole("button", { name: strings.options.themeDark });

    expect(system.className).toContain("seg-item-active");
    expect(system.getAttribute("aria-pressed")).toBe("true");
    expect(light.className).not.toContain("seg-item-active");
    expect(dark.className).not.toContain("seg-item-active");
  });

  it("persists a theme change to the theme setting and reflects it live", async () => {
    render(() => <PopupApp />);

    const dark = await screen.findByRole("button", { name: strings.options.themeDark });
    fireEvent.click(dark);

    expect(dark.className).toContain("seg-item-active");
    expect(dark.getAttribute("aria-pressed")).toBe("true");
    await vi.waitFor(async () => {
      expect(await theme.getValue()).toBe("dark");
    });
  });
});
