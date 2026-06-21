// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure marks -> CSS mapping (plan Phase 2/3). Translates the closed, privacy-safe
// `ParagraphMarks` / `TextMarks` (lib/decoder/style-allowlist) into plain CSS
// property maps the replay viewport spreads into a SolidJS `style` prop. Kept pure
// and browser-free so it is Bun-testable and carries NO network / font fetch —
// DESIGN.md mandates system-fonts-only, so a font CATEGORY maps to a system stack
// (the real Google font is unobtainable; the category is the honest maximum).

import type { FontCategory, ListMark, ParagraphMarks, TextMarks } from "../decoder/style-allowlist";

/** System font stacks per closed category. No remote/web fonts (host-permission + DESIGN.md). */
export function fontStackFor(category: FontCategory): string {
  switch (category) {
    case "serif":
      return 'Georgia, Cambria, "Times New Roman", Times, serif';
    case "mono":
      return 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
    default:
      return 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  }
}

// Relative heading sizes (em, against the body font). H1 largest → H6 smallest;
// H5/H6 sit at/below body size, matching Google Docs' default heading scale shape.
const HEADING_SIZE_EM: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6, string>> = {
  1: "1.6em",
  2: "1.35em",
  3: "1.15em",
  4: "1em",
  5: "0.92em",
  6: "0.85em",
};

/**
 * CSS for one text run's character marks. `includeDecoration` is false for runs
 * that already carry a kind-based affordance via CSS class (suggested-insert's
 * dotted underline, marked-for-deletion's strike) so an inline `text-decoration`
 * never clobbers it; bold / italic / font are always safe to apply.
 */
export function textMarkStyle(
  marks: TextMarks | undefined,
  includeDecoration = true,
): Record<string, string> {
  const style: Record<string, string> = {};
  if (marks === undefined) {
    return style;
  }
  if (marks.bold === true) {
    style["font-weight"] = "700";
  }
  if (marks.italic === true) {
    style["font-style"] = "italic";
  }
  if (includeDecoration) {
    const decorations: string[] = [];
    if (marks.underline === true) {
      decorations.push("underline");
    }
    if (marks.strikethrough === true) {
      decorations.push("line-through");
    }
    if (decorations.length > 0) {
      style["text-decoration"] = decorations.join(" ");
    }
  }
  if (marks.fontCategory !== undefined) {
    style["font-family"] = fontStackFor(marks.fontCategory);
  }
  if (marks.fontSizePt !== undefined) {
    style["font-size"] = `${marks.fontSizePt}pt`;
  }
  return style;
}

/** CSS for one paragraph block's marks (heading size/weight, alignment, spacing, indent). */
export function blockMarkStyle(marks: ParagraphMarks | undefined): Record<string, string> {
  const style: Record<string, string> = {};
  if (marks === undefined) {
    return style;
  }
  if (marks.headingLevel !== undefined) {
    style["font-size"] = HEADING_SIZE_EM[marks.headingLevel];
    style["font-weight"] = "700";
  }
  if (marks.alignment !== undefined) {
    style["text-align"] = marks.alignment;
  }
  if (marks.lineSpacing !== undefined) {
    style["line-height"] = String(marks.lineSpacing);
  }
  if (marks.indentStartPt !== undefined) {
    style["margin-inline-start"] = `${marks.indentStartPt}pt`;
  }
  if (marks.indentFirstLinePt !== undefined) {
    style["text-indent"] = `${marks.indentFirstLinePt}pt`;
  }
  return style;
}

// Bullet glyphs cycled by nesting level (filled / hollow / square), matching the
// Google Docs default bullet sequence shape.
const BULLET_GLYPHS = ["\u2022", "\u25E6", "\u25AA"] as const;

/** The marker glyph for a list paragraph. Ordered numbering by position needs a
 *  per-list counter (deferred with the entity registry); bullets render by level. */
export function listGlyphFor(list: ListMark): string {
  return BULLET_GLYPHS[list.level % BULLET_GLYPHS.length] ?? "\u2022";
}

/**
 * Strip C0 control characters (except TAB \t and NEWLINE \n) from display text.
 * Google Docs' table skeleton injects structural delimiters (U+0010..U+001C) into
 * the character stream; they are never real document text but would otherwise
 * render as garbage. Pure + display-only — the model and currentText are untouched,
 * so the reconstruction invariants (text-equality, concatenation) still hold.
 */
export function stripDisplayControlChars(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping C0 controls is the intent.
  return text.replace(/[\u0000-\u0008\u000B-\u001F]/g, "");
}
