// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { theme } from "@/lib/platform/settings";
import ThemeSyncHost from "./fixtures/ThemeSyncHost.svelte";

// `useThemeSync` is the only browser-touching part of theming, and its failure mode
// is silent: if the `.dark` toggle or either subscription breaks, every `dark:`
// utility and every `--dr-*` token flip stops working while the typecheck, the lint,
// the build, and the rest of the suite all stay green. The other component suites
// stub `matchMedia` to a permanently-light no-op, so none of them exercises it.
//
// These tests use a controllable `matchMedia` stub instead: it records the change
// listeners so a "the OS just switched" event can be fired, and so unmount can be
// checked for the identity-equal removal that proves the teardown is real.

type ChangeListener = () => void;

interface MediaStub {
  readonly matchMedia: Mock;
  readonly addEventListener: Mock;
  readonly removeEventListener: Mock;
  /** Flip the OS preference and notify every registered `change` listener. */
  emitChange(matches: boolean): void;
}

/** jsdom omits `matchMedia`; install a stub whose `change` events we drive. */
function installMatchMedia(initialMatches: boolean): MediaStub {
  const listeners = new Set<ChangeListener>();
  const addEventListener = vi.fn((type: string, listener: ChangeListener) => {
    if (type === "change") {
      listeners.add(listener);
    }
  });
  const removeEventListener = vi.fn((type: string, listener: ChangeListener) => {
    if (type === "change") {
      listeners.delete(listener);
    }
  });
  const media = { matches: initialMatches, addEventListener, removeEventListener };
  const matchMedia = vi.fn(() => media);
  Object.defineProperty(window, "matchMedia", { configurable: true, value: matchMedia });
  return {
    matchMedia,
    addEventListener,
    removeEventListener,
    emitChange(matches: boolean): void {
      media.matches = matches;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

// The applier is async (it awaits `theme.getValue()`), so an update that SHOULD be
// ignored still needs the queue drained before "nothing happened" means anything.
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("useThemeSync", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    // `<html>` is shared across tests in this file — start every case undecided.
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("dark");
  });

  it("applies the persisted explicit theme on mount", async () => {
    // OS prefers light, the user picked dark: the explicit setting must win.
    installMatchMedia(false);
    await theme.setValue("dark");

    render(ThemeSyncHost);

    await vi.waitFor(() => {
      expect(isDark()).toBe(true);
    });
  });

  it("defers to the OS preference when the theme is `system`", async () => {
    const media = installMatchMedia(true);
    await theme.setValue("system");

    render(ThemeSyncHost);

    await vi.waitFor(() => {
      expect(isDark()).toBe(true);
    });
    // A typo in the query string would silently never match — pin it.
    expect(media.matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
  });

  it("re-applies when the OS `prefers-color-scheme` changes", async () => {
    const media = installMatchMedia(false);
    await theme.setValue("system");

    render(ThemeSyncHost);

    await vi.waitFor(() => {
      expect(media.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    });
    expect(isDark()).toBe(false);

    media.emitChange(true);
    await vi.waitFor(() => {
      expect(isDark()).toBe(true);
    });

    media.emitChange(false);
    await vi.waitFor(() => {
      expect(isDark()).toBe(false);
    });
  });

  it("re-applies when the persisted theme changes", async () => {
    installMatchMedia(false);
    await theme.setValue("light");

    render(ThemeSyncHost);

    await settle();
    expect(isDark()).toBe(false);

    await theme.setValue("dark");
    await vi.waitFor(() => {
      expect(isDark()).toBe(true);
    });
  });

  it("tears down both subscriptions on unmount", async () => {
    const media = installMatchMedia(false);
    await theme.setValue("light");

    const { unmount } = render(ThemeSyncHost);
    await vi.waitFor(() => {
      expect(media.addEventListener).toHaveBeenCalledTimes(1);
    });

    unmount();

    // The media listener: removed, and identity-equal to the one added — a
    // `removeEventListener` call with a fresh closure would leave the real one live.
    await vi.waitFor(() => {
      expect(media.removeEventListener).toHaveBeenCalledTimes(1);
    });
    expect(media.removeEventListener.mock.calls[0]?.[1]).toBe(
      media.addEventListener.mock.calls[0]?.[1],
    );

    // The `theme.watch` side: a detached component must stop reacting entirely.
    await theme.setValue("dark");
    await settle();
    expect(isDark()).toBe(false);
  });
});
