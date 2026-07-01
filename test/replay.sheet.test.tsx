// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Vitest (jsdom) integration test for the SHEETS replay App path: a `?kind=sheet`
// URL with a pre-seeded active grid publication renders the grid + tabs through
// the kind-branched ReplaySurface (same-thread pipeline, no Worker).
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import App from "@/entrypoints/replay/App";
import { asDocId } from "@/lib/core/domain/ids";
import { asGid } from "@/lib/core/sheets/decoder/types";
import { SHEETS_PARSER_VERSION } from "@/lib/core/sheets/decoder/version";
import {
  cellKey,
  createCell,
  createModel,
  createSheet,
  type GridModel,
} from "@/lib/core/sheets/reconstruction/model";
import { createMemoryStore } from "@/lib/platform/db.memory";
import { theme } from "@/lib/platform/settings";

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock("@/lib/platform/messaging", () => ({ sendMessage: sendMessageMock }));

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

async function renderSeeded(store: ReturnType<typeof createMemoryStore>, model: GridModel) {
  await store.saveReplayPublication(DOC, {
    kind: "sheet",
    publicationId: "pub-sheet",
    sheetsParserVersion: SHEETS_PARSER_VERSION,
    revisions: [],
    snapshots: [{ appliedCount: 0, model }],
    timeline: [],
    publishedAt: 1,
  });
  await store.setActiveReplayPublication(DOC, "pub-sheet", "sheet");
  render(() => <App store={store} useWorker={false} />);
}

describe("replay App — sheets path", () => {
  it("renders the grid + tab from a pre-seeded active sheet publication", async () => {
    sendMessageMock.mockResolvedValue({ ok: true });
    await renderSeeded(createMemoryStore(), seededGrid());

    // The grid cell value and the sheet tab both render through the grid surface.
    await vi.waitFor(() => expect(screen.getByText("hi")).toBeTruthy());
    expect(screen.getByRole("tab", { name: "Data" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("surfaces the soft fidelity notice for a conditional-format drop", async () => {
    sendMessageMock.mockResolvedValue({ ok: true });
    const model = seededGrid();
    model.fidelityNotices.push({ kind: "conditional-format-dropped", detail: "" });
    await renderSeeded(createMemoryStore(), model);

    await vi.waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(screen.getByRole("status").textContent).toContain("couldn't be fully reconstructed");
  });

  it("shows NO fidelity notice for a merge/opaque-only sheet", async () => {
    sendMessageMock.mockResolvedValue({ ok: true });
    const model = seededGrid();
    const sheet = model.sheets.get(asGid("0"));
    if (sheet === undefined) throw new Error("no sheet");
    sheet.merges.push({ gid: asGid("0"), rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 2 });
    sheet.placeholders.push({ kind: "chart", row: 2, col: 2 });
    await renderSeeded(createMemoryStore(), model);

    await vi.waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders the tabs in the model's reordered order", async () => {
    sendMessageMock.mockResolvedValue({ ok: true });
    const model = seededGrid();
    const data = asGid("0");
    const summary = asGid("849076485");
    model.sheets.set(summary, createSheet("Summary"));
    // The post-reorder order moves gid "0" (Data) to the back.
    model.order = [summary, data];
    await renderSeeded(createMemoryStore(), model);

    await vi.waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Summary", "Data"]);
  });
});
