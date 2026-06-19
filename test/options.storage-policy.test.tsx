// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import OptionsApp from "@/components/OptionsApp";

const { sendMessageMock, storeMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(async () => ({ status: "completed", reclaimedBytes: 0 })),
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
    setActiveReplayPublication: vi.fn(),
    getActiveReplayPublication: vi.fn(async () => null),
    deleteReplayPublication: vi.fn(),
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
    deleteCheckpoint: vi.fn(),
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

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("turning off raw retention requests guarded maintenance without direct raw deletion", async () => {
    render(() => <OptionsApp />);
    const checkbox = await screen.findByLabelText("Keep the original history on this device");
    expect(
      screen.getByText(
        "Lets DocRewind rebuild this replay later without downloading it again. " +
          "When off, the original history is cleared once it's no longer needed, to save space.",
      ),
    ).toBeTruthy();

    await fireEvent.click(checkbox);

    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(storeMock.deleteRawAll).not.toHaveBeenCalled();
    expect(storeMock.deleteAll).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith(
        "requestStorageMaintenance",
        expect.objectContaining({
          id: `storage-maintenance:docOptions:policy:discard-raw:${50 * MIB}:${500 * MIB}`,
          docId: "docOptions",
          keepRawData: false,
          budget: { perDocumentBytes: 50 * MIB, globalCapBytes: 500 * MIB },
          queuedAt: expect.any(Number),
        }),
      ),
    );
  });

  it("changing a budget requests guarded configured raw maintenance", async () => {
    render(() => <OptionsApp />);
    const globalCap = await screen.findByLabelText("Global cap (MB)");
    await vi.waitFor(() => expect((globalCap as HTMLInputElement).value).toBe("500"));

    await fireEvent.change(globalCap, { target: { value: "2" } });

    expect(storeMock.pruneRawToCap).not.toHaveBeenCalled();
    expect(storeMock.pruneLRU).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith(
        "requestStorageMaintenance",
        expect.objectContaining({
          docId: "docOptions",
          keepRawData: true,
          budget: { perDocumentBytes: 50 * MIB, globalCapBytes: 2 * MIB },
        }),
      ),
    );
  });

  it("changing a budget on the generic options page requests guarded global maintenance", async () => {
    window.history.replaceState(null, "", "/options.html");
    render(() => <OptionsApp />);
    const globalCap = await screen.findByLabelText("Global cap (MB)");
    await vi.waitFor(() => expect((globalCap as HTMLInputElement).value).toBe("500"));

    await fireEvent.change(globalCap, { target: { value: "3" } });

    expect(storeMock.pruneRawToCapAll).not.toHaveBeenCalled();
    expect(storeMock.pruneLRU).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith(
        "requestStorageMaintenance",
        expect.objectContaining({
          docId: null,
          keepRawData: true,
          budget: { perDocumentBytes: 50 * MIB, globalCapBytes: 3 * MIB },
        }),
      ),
    );
  });

  it("clear-current routes through the background without direct document deletion", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(() => <OptionsApp />);
    const clearCurrent = await screen.findByRole("button", { name: "Clear this document" });

    await fireEvent.click(clearCurrent);

    expect(storeMock.deleteDocument).not.toHaveBeenCalled();
    expect(storeMock.deleteAll).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith(
        "clearDocumentCache",
        expect.objectContaining({
          id: "destructive-clear:document:docOptions",
          kind: "document",
          docId: "docOptions",
          queuedAt: expect.any(Number),
        }),
      ),
    );
  });

  it("clear-all routes through the background without direct full deletion", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(() => <OptionsApp />);
    const clearAll = await screen.findByRole("button", { name: "Clear all documents" });

    await fireEvent.click(clearAll);

    expect(storeMock.deleteDocument).not.toHaveBeenCalled();
    expect(storeMock.deleteAll).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith(
        "clearAllCaches",
        expect.objectContaining({
          id: "destructive-clear:*",
          kind: "all",
          queuedAt: expect.any(Number),
        }),
      ),
    );
  });

  it("keeps a durable pending maintenance status when send fails", async () => {
    sendMessageMock.mockRejectedValueOnce(new Error("sw unavailable"));
    render(() => <OptionsApp />);
    const checkbox = await screen.findByLabelText("Keep the original history on this device");

    await fireEvent.click(checkbox);

    await vi.waitFor(() =>
      expect(
        screen.getByText("Storage cleanup could not be confirmed and will retry automatically."),
      ).toBeTruthy(),
    );
  });

  it("reports budget maintenance failures", async () => {
    sendMessageMock.mockRejectedValueOnce(new Error("sw unavailable"));
    render(() => <OptionsApp />);
    const globalCap = await screen.findByLabelText("Global cap (MB)");
    await vi.waitFor(() => expect((globalCap as HTMLInputElement).value).toBe("500"));

    await fireEvent.change(globalCap, { target: { value: "4" } });

    await vi.waitFor(() =>
      expect(
        screen.getByText("Storage cleanup could not be confirmed and will retry automatically."),
      ).toBeTruthy(),
    );
  });
});
