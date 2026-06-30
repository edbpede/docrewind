// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Vitest (jsdom) integration test for the SHEETS replay App path: a `?kind=sheet`
// URL with a pre-seeded active grid publication renders the grid + tabs through
// the kind-branched ReplaySurface (same-thread pipeline, no Worker).
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import App from "@/entrypoints/replay/App";
import { createMemoryStore } from "@/lib/db.memory";
import { asDocId } from "@/lib/domain/ids";
import { theme } from "@/lib/settings";
import { asGid } from "@/lib/sheets-decoder/types";
import { SHEETS_PARSER_VERSION } from "@/lib/sheets-decoder/version";
import {
  cellKey,
  createCell,
  createModel,
  createSheet,
  type GridModel,
} from "@/lib/sheets-reconstruction/model";

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock("@/lib/messaging", () => ({ sendMessage: sendMessageMock }));

const DOC = asDocId("sheetReplayDoc");

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

function seededGrid(): GridModel {
  const model = createModel();
  const gid = asGid("0");
  const sheet = createSheet("Data");
  sheet.cells.set(cellKey(0, 0), { ...createCell(), value: "hi" });
  sheet.rowCount = 1;
  sheet.colCount = 1;
  model.order.push(gid);
  model.sheets.set(gid, sheet);
  return model;
}

beforeEach(() => {
  fakeBrowser.reset();
  installMatchMedia();
  window.history.replaceState(null, "", `/replay.html?doc=${DOC}&kind=sheet`);
  sendMessageMock.mockReset();
  void theme.setValue("system");
});

afterEach(() => {
  cleanup();
});

describe("replay App — sheets path", () => {
  it("renders the grid + tab from a pre-seeded active sheet publication", async () => {
    sendMessageMock.mockResolvedValue({ ok: true });
    const store = createMemoryStore();
    await store.saveReplayPublication(DOC, {
      kind: "sheet",
      publicationId: "pub-sheet",
      sheetsParserVersion: SHEETS_PARSER_VERSION,
      revisions: [],
      snapshots: [{ appliedCount: 0, model: seededGrid() }],
      timeline: [],
      publishedAt: 1,
    });
    await store.setActiveReplayPublication(DOC, "pub-sheet", "sheet");

    render(() => <App store={store} useWorker={false} />);

    // The grid cell value and the sheet tab both render through the grid surface.
    await vi.waitFor(() => expect(screen.getByText("hi")).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Data" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });
});
