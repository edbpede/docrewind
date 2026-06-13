// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import OptionsApp from "@/components/OptionsApp";

const { sendMessageMock, storeMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(async () => ({ deferred: false, reclaimedBytes: 0 })),
  storeMock: {
    saveRawChunk: vi.fn(),
    getRawChunks: vi.fn(async () => []),
    estimateRawBytes: vi.fn(async () => 0),
    deleteRawForDoc: vi.fn(async () => 0),
    deleteRawAll: vi.fn(async () => 0),
    pruneRawToCap: vi.fn(async () => 0),
    pruneRawToCapAll: vi.fn(async () => 0),
    saveReplayPublication: vi.fn(),
    getReplayPublication: vi.fn(async () => null),
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

vi.mock("@/lib/messaging", () => ({
  sendMessage: sendMessageMock,
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
    sendMessageMock.mockClear();
    window.history.replaceState(null, "", "/options.html?doc=docOptions");
    installMatchMedia();
  });

  afterEach(() => cleanup());

  it("turning off raw retention requests guarded maintenance without direct raw deletion", async () => {
    render(() => <OptionsApp />);
    const checkbox = await screen.findByLabelText("Keep raw data for re-decoding");

    await fireEvent.click(checkbox);

    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(storeMock.deleteRawAll).not.toHaveBeenCalled();
    expect(storeMock.deleteAll).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith("requestStorageMaintenance", {
        docId: "docOptions",
        keepRawData: false,
        budget: { perDocumentBytes: 50 * MIB, globalCapBytes: 500 * MIB },
      }),
    );
  });

  it("changing a budget requests guarded configured raw maintenance", async () => {
    render(() => <OptionsApp />);
    const globalCap = await screen.findByLabelText("Global cap (MB)");
    await vi.waitFor(() => expect((globalCap as HTMLInputElement).value).toBe("500"));

    await fireEvent.change(globalCap, { target: { value: "2" } });

    expect(storeMock.pruneRawToCap).not.toHaveBeenCalled();
    expect(storeMock.pruneLRU).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith("requestStorageMaintenance", {
      docId: "docOptions",
      keepRawData: true,
      budget: { perDocumentBytes: 50 * MIB, globalCapBytes: 2 * MIB },
    });
  });

  it("changing a budget on the generic options page requests guarded global maintenance", async () => {
    window.history.replaceState(null, "", "/options.html");
    render(() => <OptionsApp />);
    const globalCap = await screen.findByLabelText("Global cap (MB)");
    await vi.waitFor(() => expect((globalCap as HTMLInputElement).value).toBe("500"));

    await fireEvent.change(globalCap, { target: { value: "3" } });

    expect(storeMock.pruneRawToCapAll).not.toHaveBeenCalled();
    expect(storeMock.pruneLRU).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith("requestStorageMaintenance", {
      docId: null,
      keepRawData: true,
      budget: { perDocumentBytes: 50 * MIB, globalCapBytes: 3 * MIB },
    });
  });
});
