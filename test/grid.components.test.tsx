// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Vitest (jsdom) tests for the Sheets replay UI: GridViewport renders
// values/formulas/styles + the fidelity-notice row and stays bounded for a large
// grid (virtualization / render cap, R7); SheetTabs switches tabs.
import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import GridViewport from "@/components/GridViewport";
import SheetTabs from "@/components/SheetTabs";
import { asGid, type Gid } from "@/lib/sheets-decoder/types";
import {
  type Cell,
  cellKey,
  createCell,
  createModel,
  createSheet,
  type GridModel,
  type SheetGrid,
} from "@/lib/sheets-reconstruction/model";

function withCell(sheet: SheetGrid, row: number, col: number, patch: Partial<Cell>): void {
  sheet.cells.set(cellKey(row, col), { ...createCell(), ...patch });
  sheet.rowCount = Math.max(sheet.rowCount, row + 1);
  sheet.colCount = Math.max(sheet.colCount, col + 1);
}

function sampleSheet(): SheetGrid {
  const sheet = createSheet("Sheet 1");
  withCell(sheet, 0, 0, { value: 12345, numberFormat: "#,##0" });
  withCell(sheet, 1, 0, { value: "hello" });
  withCell(sheet, 2, 0, { formula: "=SUM(A1:A2)" });
  withCell(sheet, 3, 0, { value: "bold", style: { bold: true, italic: false } });
  return sheet;
}

describe("GridViewport", () => {
  it("renders cell values, a formatted number, and a formula as text", () => {
    const { getByText } = render(() => (
      <GridViewport sheet={sampleSheet()} showFidelityNotice={false} />
    ));
    expect(getByText("12,345")).toBeTruthy(); // number-format pattern applied
    expect(getByText("hello")).toBeTruthy();
    expect(getByText("=SUM(A1:A2)")).toBeTruthy(); // formula shown as text
  });

  it("applies the bold visual style to a cell", () => {
    const { getByText } = render(() => (
      <GridViewport sheet={sampleSheet()} showFidelityNotice={false} />
    ));
    expect(getByText("bold").classList.contains("font-bold")).toBe(true);
  });

  it("renders the fidelity-notice row only when requested", () => {
    const withoutNotice = render(() => (
      <GridViewport sheet={sampleSheet()} showFidelityNotice={false} />
    ));
    expect(withoutNotice.queryByRole("status")).toBeNull();
    const withNotice = render(() => (
      <GridViewport sheet={sampleSheet()} showFidelityNotice={true} />
    ));
    expect(withNotice.getByRole("status").textContent).toContain("couldn't be fully reconstructed");
  });

  it("stays bounded for a 10k-row grid (virtualization render cap)", () => {
    const big = createSheet("Big");
    big.rowCount = 10_000;
    big.colCount = 40;
    withCell(big, 0, 0, { value: 1 });
    big.rowCount = 10_000;
    big.colCount = 40;
    const { container } = render(() => <GridViewport sheet={big} showFidelityNotice={false} />);
    const cells = container.querySelectorAll("td");
    // Far fewer than 10k*40 — only the visible window + overscan is in the DOM.
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(4000);
  });
});

describe("GridViewport — merges + placeholders", () => {
  function mergedSheet(): SheetGrid {
    const sheet = createSheet("Merged");
    withCell(sheet, 0, 0, { value: "title" });
    withCell(sheet, 0, 1, { value: "leak" }); // a value typed into B1 BEFORE the merge
    sheet.merges.push({ gid: asGid("0"), rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 3 }); // A1:C1
    return sheet;
  }

  it("renders a merged anchor as one colSpan cell and blanks the absorbed cells (§0)", () => {
    const { getByText, queryByText } = render(() => (
      <GridViewport sheet={mergedSheet()} showFidelityNotice={false} />
    ));
    const anchor = getByText("title");
    expect(anchor.tagName).toBe("TD");
    expect(anchor.getAttribute("colspan")).toBe("3");
    // The merge set is the SOLE blank authority — the pre-merge B1 value must not leak.
    expect(queryByText("leak")).toBeNull();
  });

  it("renders a chart placeholder chip at its anchor cell", () => {
    const sheet = createSheet("Chart");
    sheet.placeholders.push({ kind: "chart", row: 0, col: 0 });
    sheet.rowCount = 1;
    sheet.colCount = 1;
    const { getByText } = render(() => <GridViewport sheet={sheet} showFidelityNotice={false} />);
    expect(getByText("Chart")).toBeTruthy();
  });

  it("renders an image placeholder chip at its anchor cell", () => {
    const sheet = createSheet("Image");
    sheet.placeholders.push({ kind: "image", row: 0, col: 0 });
    sheet.rowCount = 1;
    sheet.colCount = 1;
    const { getByText } = render(() => <GridViewport sheet={sheet} showFidelityNotice={false} />);
    expect(getByText("Image")).toBeTruthy();
  });
});

function twoSheetModel(): GridModel {
  const model = createModel();
  const a = asGid("0");
  const b = asGid("849076485");
  model.order.push(a, b);
  model.sheets.set(a, createSheet("Data"));
  model.sheets.set(b, createSheet("Summary"));
  return model;
}

describe("SheetTabs", () => {
  it("renders one tab per sheet in order, marking the active one", () => {
    const model = twoSheetModel();
    const { getByText } = render(() => (
      <SheetTabs model={model} activeGid={asGid("0")} onSelect={() => {}} />
    ));
    const active = getByText("Data");
    const other = getByText("Summary");
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(other.getAttribute("aria-selected")).toBe("false");
  });

  it("calls onSelect with the gid of a clicked tab", () => {
    const model = twoSheetModel();
    const onSelect = vi.fn<(gid: Gid) => void>();
    const { getByText } = render(() => (
      <SheetTabs model={model} activeGid={asGid("0")} onSelect={onSelect} />
    ));
    fireEvent.click(getByText("Summary"));
    expect(onSelect).toHaveBeenCalledWith(asGid("849076485"));
  });
});
