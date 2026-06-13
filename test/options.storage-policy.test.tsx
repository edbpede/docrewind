// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import OptionsApp from "@/components/OptionsApp";

const { storeMock } = vi.hoisted(() => ({
  storeMock: {
    saveRawChunk: vi.fn(),
    getRawChunks: vi.fn(async () => []),
    estimateRawBytes: vi.fn(async () => 0),
    deleteRawForDoc: vi.fn(async () => 0),
    deleteRawAll: vi.fn(async () => 0),
    pruneRawToCap: vi.fn(async () => 0),
    pruneRawToCapAll: vi.fn(async () => 0),
    saveDecoded: vi.fn(),
    getDecoded: vi.fn(async () => []),
    saveSnapshots: vi.fn(),
    getSnapshots: vi.fn(async () => []),
    saveTimeline: vi.fn(),
    getTimeline: vi.fn(async () => []),
    getCacheMeta: vi.fn(async () => null),
    putCacheMeta: vi.fn(),
    touch: vi.fn(),
    readCheckpoint: vi.fn(async () => null),
    writeCheckpoint: vi.fn(),
    estimateUsage: vi.fn(async () => ({ usage: 0, quota: 0 })),
    pruneLRU: vi.fn(async () => 0),
    deleteDocument: vi.fn(),
    deleteAll: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  createIdbStore: () => storeMock,
}));

const MIB = 1024 * 1024;

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

describe("OptionsApp storage policy controls", () => {
  beforeEach(() => {
    cleanup();
    fakeBrowser.reset();
    for (const value of Object.values(storeMock)) {
      if (typeof value === "function" && "mockClear" in value) {
        value.mockClear();
      }
    }
    window.history.replaceState(null, "", "/options.html?doc=docOptions");
    installMatchMedia();
  });

  afterEach(() => cleanup());

  it("turning off raw retention triggers raw-only cleanup", async () => {
    render(() => <OptionsApp />);
    const checkbox = await screen.findByLabelText("Keep raw data for re-decoding");

    await fireEvent.click(checkbox);

    expect(storeMock.deleteRawAll).toHaveBeenCalledTimes(1);
    expect(storeMock.deleteAll).not.toHaveBeenCalled();
  });

  it("changing a budget immediately schedules configured raw maintenance", async () => {
    render(() => <OptionsApp />);
    const globalCap = await screen.findByLabelText("Global cap (MB)");
    await vi.waitFor(() => expect((globalCap as HTMLInputElement).value).toBe("500"));

    await fireEvent.change(globalCap, { target: { value: "2" } });

    expect(storeMock.pruneRawToCap).toHaveBeenCalledWith("docOptions", 50 * MIB);
    expect(storeMock.pruneLRU).toHaveBeenCalledWith(2 * MIB);
  });

  it("changing a budget on the generic options page enforces per-document and global caps", async () => {
    window.history.replaceState(null, "", "/options.html");
    render(() => <OptionsApp />);
    const globalCap = await screen.findByLabelText("Global cap (MB)");
    await vi.waitFor(() => expect((globalCap as HTMLInputElement).value).toBe("500"));

    await fireEvent.change(globalCap, { target: { value: "3" } });

    expect(storeMock.pruneRawToCapAll).toHaveBeenCalledWith(50 * MIB);
    expect(storeMock.pruneLRU).toHaveBeenCalledWith(3 * MIB);
  });
});
