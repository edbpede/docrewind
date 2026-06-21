// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Adversarial tests for the style allowlist (plan Phase 2/3 / R5). Proves the
// extractors (a) read ONLY allowlisted keys, dropping any verbatim-text payload,
// (b) honor the `_i` inherit flag (inherited => ignored), (c) bucket fonts to a
// closed category, and (d) return null for non-objects / empty extractions so the
// decode funnel degrades the op to UnknownOp. Output keys are always a subset of
// the closed allowlist.

import { describe, expect, test } from "bun:test";
import { extractListMarks, extractParagraphMarks, extractTextMarks } from "./style-allowlist";

const PARAGRAPH_KEYS = new Set([
  "headingLevel",
  "alignment",
  "lineSpacing",
  "indentStartPt",
  "indentFirstLinePt",
]);
const TEXT_KEYS = new Set([
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "fontCategory",
  "fontSizePt",
]);

describe("extractParagraphMarks", () => {
  test("non-objects yield null", () => {
    for (const v of [null, undefined, 42, "x", [], true]) {
      expect(extractParagraphMarks(v)).toBeNull();
    }
  });

  test("empty / all-default map yields null", () => {
    expect(extractParagraphMarks({})).toBeNull();
    // ps_hd 0 (normal) and ps_al 0 (left) are defaults -> omitted -> null.
    expect(extractParagraphMarks({ ps_hd: 0, ps_al: 0 })).toBeNull();
  });

  test("heading levels 1..6 map directly; 0 and out-of-range are omitted", () => {
    for (let n = 1; n <= 6; n++) {
      expect(extractParagraphMarks({ ps_hd: n })?.headingLevel).toBe(n as 1);
    }
    expect(extractParagraphMarks({ ps_hd: 0 })).toBeNull();
    expect(extractParagraphMarks({ ps_hd: 7 })).toBeNull();
    expect(extractParagraphMarks({ ps_hd: 2.5 })).toBeNull();
  });

  test("alignment codes 1/2/3 map to center/right/justify; 0 is the default", () => {
    expect(extractParagraphMarks({ ps_al: 1 })?.alignment).toBe("center");
    expect(extractParagraphMarks({ ps_al: 2 })?.alignment).toBe("right");
    expect(extractParagraphMarks({ ps_al: 3 })?.alignment).toBe("justify");
    expect(extractParagraphMarks({ ps_al: 0 })).toBeNull();
    expect(extractParagraphMarks({ ps_al: 9 })).toBeNull();
  });

  test("inherited (`_i: true`) properties are ignored", () => {
    expect(extractParagraphMarks({ ps_hd: 3, ps_hd_i: true })).toBeNull();
    expect(extractParagraphMarks({ ps_al: 1, ps_al_i: true })).toBeNull();
    expect(extractParagraphMarks({ ps_ls: 1.5, ps_ls_i: true })).toBeNull();
    // explicitly set (`_i: false`) is kept.
    expect(extractParagraphMarks({ ps_al: 1, ps_al_i: false })?.alignment).toBe("center");
  });

  test("line spacing and indents: only positive finite numbers", () => {
    expect(extractParagraphMarks({ ps_ls: 1.15 })?.lineSpacing).toBe(1.15);
    expect(extractParagraphMarks({ ps_ls: 0 })).toBeNull();
    expect(extractParagraphMarks({ ps_ls: Number.NaN })).toBeNull();
    expect(extractParagraphMarks({ ps_il: 36 })?.indentStartPt).toBe(36);
    expect(extractParagraphMarks({ ps_il: 0 })).toBeNull();
    expect(extractParagraphMarks({ ps_ifl: 18 })?.indentFirstLinePt).toBe(18);
  });

  test("verbatim-text keys are dropped; output keys subset of allowlist", () => {
    const marks = extractParagraphMarks({
      ps_hd: 1,
      ps_al: 2,
      ps_al_i: false,
      // hostile payload masquerading as style:
      s: "secret document text the user typed",
      ps_rd: "another raw string",
      __proto__: { polluted: true },
      ps_ts: { cv: { op: "set", opValue: ["leak"] } },
    });
    expect(marks).not.toBeNull();
    for (const k of Object.keys(marks ?? {})) expect(PARAGRAPH_KEYS.has(k)).toBe(true);
    expect(marks?.headingLevel).toBe(1);
    expect(marks?.alignment).toBe("right");
  });
});

describe("extractTextMarks", () => {
  test("non-objects and empty yield null", () => {
    expect(extractTextMarks(null)).toBeNull();
    expect(extractTextMarks("bold")).toBeNull();
    expect(extractTextMarks({})).toBeNull();
    // false booleans are not "set".
    expect(extractTextMarks({ ts_bd: false, ts_it: false })).toBeNull();
  });

  test("boolean marks recorded only when explicitly true", () => {
    expect(extractTextMarks({ ts_bd: true })?.bold).toBe(true);
    expect(extractTextMarks({ ts_it: true })?.italic).toBe(true);
    expect(extractTextMarks({ ts_un: true })?.underline).toBe(true);
    expect(extractTextMarks({ ts_st: true })?.strikethrough).toBe(true);
    // inherited true is ignored.
    expect(extractTextMarks({ ts_bd: true, ts_bd_i: true })).toBeNull();
    // a non-boolean truthy value is not treated as set.
    expect(extractTextMarks({ ts_bd: 1 })).toBeNull();
  });

  test("font size: positive finite only", () => {
    expect(extractTextMarks({ ts_fs: 11 })?.fontSizePt).toBe(11);
    expect(extractTextMarks({ ts_fs: 0 })).toBeNull();
    expect(extractTextMarks({ ts_fs: -5 })).toBeNull();
    expect(extractTextMarks({ ts_fs: 14, ts_fs_i: true })).toBeNull();
  });

  test("font family buckets to a closed category; verbatim name never surfaces", () => {
    expect(extractTextMarks({ ts_ff: "Arial" })?.fontCategory).toBe("sans");
    expect(extractTextMarks({ ts_ff: "Calibri" })?.fontCategory).toBe("sans");
    expect(extractTextMarks({ ts_ff: "Times New Roman" })?.fontCategory).toBe("serif");
    expect(extractTextMarks({ ts_ff: "Georgia" })?.fontCategory).toBe("serif");
    expect(extractTextMarks({ ts_ff: "Courier New" })?.fontCategory).toBe("mono");
    expect(extractTextMarks({ ts_ff: "Consolas" })?.fontCategory).toBe("mono");
    // unknown family -> sans default; the raw string is never stored.
    const m = extractTextMarks({ ts_ff: "Totally Unknown Brand Font 9000" });
    expect(m?.fontCategory).toBe("sans");
    expect(JSON.stringify(m)).not.toContain("Unknown");
    // blank / non-string family ignored.
    expect(extractTextMarks({ ts_ff: "   " })).toBeNull();
    expect(extractTextMarks({ ts_ff: 123 })).toBeNull();
  });

  test("output keys subset of allowlist even with hostile payload", () => {
    const marks = extractTextMarks({
      ts_bd: true,
      ts_fs: 12,
      s: "verbatim text",
      ts_va: "nor",
      i_cid: "s-blob-v1-IMAGE-secret",
    });
    expect(marks).not.toBeNull();
    for (const k of Object.keys(marks ?? {})) expect(TEXT_KEYS.has(k)).toBe(true);
  });
});

describe("extractListMarks", () => {
  test("non-objects and non-list paragraphs yield null", () => {
    expect(extractListMarks(null)).toBeNull();
    expect(extractListMarks({})).toBeNull();
    expect(extractListMarks({ ls_id: "" })).toBeNull();
    expect(extractListMarks({ ls_id: null })).toBeNull();
    expect(extractListMarks({ ls_id: 5 })).toBeNull();
  });

  test("a non-empty list id yields membership; ls_nest is the level (default 0)", () => {
    expect(extractListMarks({ ls_id: "kix.abc" })).toEqual({ level: 0 });
    expect(extractListMarks({ ls_id: "kix.abc", ls_nest: 2 })).toEqual({ level: 2 });
    expect(extractListMarks({ ls_id: "kix.abc", ls_nest: -1 })).toEqual({ level: 0 });
    expect(extractListMarks({ ls_id: "kix.abc", ls_nest: 1.5 })).toEqual({ level: 0 });
  });

  test("the list id string never enters the output", () => {
    expect(JSON.stringify(extractListMarks({ ls_id: "kix.secret-id" }))).not.toContain("secret");
  });
});
