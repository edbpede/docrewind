// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Style allowlist (plan Phase 2/3 / R5, PRD §13.7). A Google Docs `revisions/load`
// `as`/`astss` op carries an opaque style map `sm` whose REAL key names were
// reverse-engineered from a live authenticated capture (2026-06-21, ground-truth
// throwaway doc with H1-H6, left/center/right/justify, bold, lists, a 3x3 table):
//
//   paragraph scope (st:"paragraph", ps_* keys):
//     ps_hd  heading level: 0=normal, 1..6 = H1..H6
//     ps_al  alignment: 0=left, 1=center, 2=right, 3=justify
//     ps_ls  line spacing (number, e.g. 1.15)
//     ps_il  indent-start pt        ps_ifl indent-first-line pt
//   text scope (st:"text", ts_* keys):
//     ts_bd bold · ts_it italic · ts_un underline · ts_st strikethrough (booleans)
//     ts_fs font size pt (number) · ts_ff font family (string)
//   Every non-heading property X carries a sibling INHERIT flag `X_i`:
//     X_i === true  => the value is INHERITED (not explicitly set) — ignore it.
//     X_i === false (or absent) => explicitly set on this run/paragraph.
//
// PRIVACY BY ALLOWLIST (R5). The OUTPUT TYPES below are closed unions / numbers /
// booleans only — never the raw `sm`, never verbatim document text, and NO open
// string field at the type level. An unknown / malformed `sm` yields `null`, so the
// decode funnel degrades the op to `UnknownOp` (opcode + byteLength only). The font
// family is read internally only to bucket it into a closed generic CATEGORY
// (sans/serif/mono) — the verbatim family name never leaves this module, and
// DESIGN.md mandates system-fonts-only rendering anyway.

/** Heading levels Google Docs exposes (ps_hd 1..6). 0/normal is represented by omission. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** Paragraph alignment (ps_al 1/2/3; 0/left is the default, represented by omission). */
export type Alignment = "center" | "right" | "justify";

/** Generic font category — the closed bucket a real family maps to (system-fonts-only). */
export type FontCategory = "sans" | "serif" | "mono";

/** Closed paragraph-style output. Every field optional; absence = the document default. */
export interface ParagraphMarks {
  readonly headingLevel?: HeadingLevel;
  readonly alignment?: Alignment;
  readonly lineSpacing?: number;
  readonly indentStartPt?: number;
  readonly indentFirstLinePt?: number;
}

/** Closed character-style output. Booleans are present-only (`true`) or omitted. */
export interface TextMarks {
  readonly bold?: true;
  readonly italic?: true;
  readonly underline?: true;
  readonly strikethrough?: true;
  readonly fontCategory?: FontCategory;
  readonly fontSizePt?: number;
}

/**
 * Closed list-membership output (st:"list" scope, ls_* keys). A paragraph belongs
 * to a list when `ls_id` is a non-empty id; `ls_nest` is its 0-based nesting level.
 * `ordered` (bullet vs numbered) requires correlating the list ENTITY (ae/list →
 * le_nb → b_gt 9=bullet/10=decimal) and is left to a later entity-registry pass —
 * absent here means "render as a bullet". The id itself is NOT stored (R5: no open
 * string in the model); only the boolean membership + numeric level cross over.
 */
export interface ListMark {
  readonly level: number;
  readonly ordered?: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when property `key` is explicitly set: its `${key}_i` inherit flag is not `true`. */
function isExplicit(sm: Record<string, unknown>, key: string): boolean {
  return sm[`${key}_i`] !== true;
}

/** A finite number strictly greater than zero, else undefined. */
function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** A finite number >= 0, else undefined. */
function asNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

// Known serif / monospace families seen in the Google Docs font menu. Anything else
// (Arial, Calibri, Verdana, Roboto, unknown) buckets to "sans". Lowercased for match.
const SERIF_FAMILIES: ReadonlySet<string> = new Set([
  "times new roman",
  "georgia",
  "garamond",
  "eb garamond",
  "merriweather",
  "playfair display",
  "lora",
  "spectral",
  "cambria",
  "roboto serif",
  "droid serif",
  "noto serif",
  "pt serif",
]);
const MONO_FAMILIES: ReadonlySet<string> = new Set([
  "courier new",
  "consolas",
  "roboto mono",
  "source code pro",
  "inconsolata",
  "pt mono",
  "ubuntu mono",
]);

/** Bucket a verbatim family name into a closed generic category. */
function categorizeFont(family: string): FontCategory {
  const key = family.trim().toLowerCase();
  if (SERIF_FAMILIES.has(key)) return "serif";
  if (MONO_FAMILIES.has(key)) return "mono";
  return "sans";
}

const ALIGNMENT_BY_CODE: Readonly<Record<number, Alignment>> = {
  1: "center",
  2: "right",
  3: "justify",
};

/**
 * Extract closed paragraph marks from a raw `sm`, or `null` when nothing
 * allowlisted is explicitly set (the decode funnel then degrades to UnknownOp).
 * Heading (ps_hd) is a named-style designation, authoritative whenever present and
 * not inherited; 0/normal and out-of-range values are omitted.
 */
export function extractParagraphMarks(sm: unknown): ParagraphMarks | null {
  if (!isRecord(sm)) return null;
  const marks: {
    headingLevel?: HeadingLevel;
    alignment?: Alignment;
    lineSpacing?: number;
    indentStartPt?: number;
    indentFirstLinePt?: number;
  } = {};

  const hd = sm.ps_hd;
  if (
    typeof hd === "number" &&
    Number.isInteger(hd) &&
    hd >= 1 &&
    hd <= 6 &&
    isExplicit(sm, "ps_hd")
  ) {
    marks.headingLevel = hd as HeadingLevel;
  }
  const al = sm.ps_al;
  if (typeof al === "number" && isExplicit(sm, "ps_al")) {
    const mapped = ALIGNMENT_BY_CODE[al];
    if (mapped !== undefined) marks.alignment = mapped;
  }
  if (isExplicit(sm, "ps_ls")) {
    const ls = asPositiveNumber(sm.ps_ls);
    if (ls !== undefined) marks.lineSpacing = ls;
  }
  if (isExplicit(sm, "ps_il")) {
    const il = asNonNegativeNumber(sm.ps_il);
    if (il !== undefined && il > 0) marks.indentStartPt = il;
  }
  if (isExplicit(sm, "ps_ifl")) {
    const ifl = asNonNegativeNumber(sm.ps_ifl);
    if (ifl !== undefined && ifl > 0) marks.indentFirstLinePt = ifl;
  }

  return Object.keys(marks).length > 0 ? marks : null;
}

/**
 * Extract closed character marks from a raw `sm`, or `null` when nothing
 * allowlisted is explicitly set. Booleans are recorded only when explicitly `true`.
 */
export function extractTextMarks(sm: unknown): TextMarks | null {
  if (!isRecord(sm)) return null;
  const marks: {
    bold?: true;
    italic?: true;
    underline?: true;
    strikethrough?: true;
    fontCategory?: FontCategory;
    fontSizePt?: number;
  } = {};

  if (sm.ts_bd === true && isExplicit(sm, "ts_bd")) marks.bold = true;
  if (sm.ts_it === true && isExplicit(sm, "ts_it")) marks.italic = true;
  if (sm.ts_un === true && isExplicit(sm, "ts_un")) marks.underline = true;
  if (sm.ts_st === true && isExplicit(sm, "ts_st")) marks.strikethrough = true;
  if (isExplicit(sm, "ts_fs")) {
    const fs = asPositiveNumber(sm.ts_fs);
    if (fs !== undefined) marks.fontSizePt = fs;
  }
  if (typeof sm.ts_ff === "string" && sm.ts_ff.trim().length > 0 && isExplicit(sm, "ts_ff")) {
    marks.fontCategory = categorizeFont(sm.ts_ff);
  }

  return Object.keys(marks).length > 0 ? marks : null;
}

/**
 * Extract list membership from a raw `sm` (st:"list" scope), or `null` when the
 * paragraph is NOT in a list (no / empty / null `ls_id`). `ls_nest` gives the
 * 0-based level (clamped to a non-negative integer). The id string is read only to
 * test membership — it never enters the closed output.
 */
export function extractListMarks(sm: unknown): ListMark | null {
  if (!isRecord(sm)) return null;
  const id = sm.ls_id;
  if (typeof id !== "string" || id.trim().length === 0) return null;
  const nest = sm.ls_nest;
  const level = typeof nest === "number" && Number.isInteger(nest) && nest >= 0 ? nest : 0;
  return { level };
}
