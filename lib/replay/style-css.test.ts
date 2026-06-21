// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure marks -> CSS mapping tests (plan Phase 2/3). Verifies font categories map
// to system stacks (no remote fonts), text marks produce the expected CSS, the
// decoration toggle protects kind-based affordances, and paragraph marks map to
// heading size/weight, alignment, spacing, and indent.

import { describe, expect, test } from "bun:test";
import {
  blockMarkStyle,
  fontStackFor,
  listGlyphFor,
  stripDisplayControlChars,
  textMarkStyle,
} from "./style-css";

describe("fontStackFor", () => {
  test("each category maps to a system stack with a generic fallback; no remote fonts", () => {
    expect(fontStackFor("sans")).toContain("sans-serif");
    expect(fontStackFor("serif")).toContain("serif");
    expect(fontStackFor("mono")).toContain("monospace");
    for (const cat of ["sans", "serif", "mono"] as const) {
      expect(fontStackFor(cat)).not.toMatch(/https?:|url\(/);
    }
  });
});

describe("textMarkStyle", () => {
  test("empty / undefined yields no styles", () => {
    expect(textMarkStyle(undefined)).toEqual({});
    expect(textMarkStyle({})).toEqual({});
  });

  test("bold, italic, font category and size map to CSS", () => {
    expect(textMarkStyle({ bold: true })["font-weight"]).toBe("700");
    expect(textMarkStyle({ italic: true })["font-style"]).toBe("italic");
    expect(textMarkStyle({ fontCategory: "serif" })["font-family"]).toContain("serif");
    expect(textMarkStyle({ fontSizePt: 18 })["font-size"]).toBe("18pt");
  });

  test("underline + strikethrough combine into one text-decoration", () => {
    expect(textMarkStyle({ underline: true, strikethrough: true })["text-decoration"]).toBe(
      "underline line-through",
    );
  });

  test("includeDecoration=false drops text-decoration but keeps bold (affordance protection)", () => {
    const style = textMarkStyle({ underline: true, bold: true }, false);
    expect(style["text-decoration"]).toBeUndefined();
    expect(style["font-weight"]).toBe("700");
  });
});

describe("blockMarkStyle", () => {
  test("empty / undefined yields no styles", () => {
    expect(blockMarkStyle(undefined)).toEqual({});
    expect(blockMarkStyle({})).toEqual({});
  });

  test("heading level sets a relative size and bold weight; H1 larger than H6", () => {
    const h1 = blockMarkStyle({ headingLevel: 1 });
    const h6 = blockMarkStyle({ headingLevel: 6 });
    expect(h1["font-weight"]).toBe("700");
    expect(Number.parseFloat(h1["font-size"] ?? "0")).toBeGreaterThan(
      Number.parseFloat(h6["font-size"] ?? "0"),
    );
  });

  test("alignment, line spacing and indent map to CSS", () => {
    expect(blockMarkStyle({ alignment: "center" })["text-align"]).toBe("center");
    expect(blockMarkStyle({ alignment: "justify" })["text-align"]).toBe("justify");
    expect(blockMarkStyle({ lineSpacing: 1.5 })["line-height"]).toBe("1.5");
    expect(blockMarkStyle({ indentStartPt: 36 })["margin-inline-start"]).toBe("36pt");
  });

  test("first-line indent maps to text-indent, independent of block indent", () => {
    expect(blockMarkStyle({ indentFirstLinePt: 18 })["text-indent"]).toBe("18pt");
    expect(blockMarkStyle({ indentStartPt: 36 })["text-indent"]).toBeUndefined();
  });
});

describe("listGlyphFor", () => {
  test("returns a bullet glyph that varies by level and wraps the cycle", () => {
    const l0 = listGlyphFor({ level: 0 });
    const l1 = listGlyphFor({ level: 1 });
    expect(l0.length).toBeGreaterThan(0);
    expect(l0).not.toBe(l1);
    expect(listGlyphFor({ level: 3 })).toBe(l0);
  });
});

describe("stripDisplayControlChars", () => {
  test("removes C0 control chars (table skeleton) but keeps text, tab and newline", () => {
    expect(stripDisplayControlChars("a\u0010b\u001cc")).toBe("abc");
    expect(stripDisplayControlChars("keep\tthis\nand\u0000not\u001fthat")).toBe(
      "keep\tthis\nandnotthat",
    );
    expect(stripDisplayControlChars("plain text")).toBe("plain text");
  });

  test("strips CR and other C0 controls (only TAB and NEWLINE survive)", () => {
    expect(stripDisplayControlChars("a\rb")).toBe("ab");
    expect(stripDisplayControlChars("abc")).toBe("abc");
    expect(stripDisplayControlChars("line\r\nbreak")).toBe("line\nbreak");
  });
});
