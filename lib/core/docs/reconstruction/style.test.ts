// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 2/3 formatting reconstruction (plan Phase 2/3). Drives the FULL pipeline —
// decode an `as`/`astss` op through the style allowlist, apply it to the model,
// then read paragraph marks off blocks and character marks off segments. Proves
// the additive invariant (text, counts, indices unchanged), the paragraph-mark =
// `\n`/EOB placement, run-breaking on differing char marks, clear-by-replacement,
// and that formatting survives the snapshot/clone time-travel path unchanged.

import { describe, expect, test } from "bun:test";
import { decodeOperations } from "@/lib/core/docs/decoder/decode";
import { applyRevision } from "./apply";
import { blocksAt } from "./blocks";
import { cloneModel, createModel, type DocumentModel } from "./model";
import { segmentsAt } from "./render";
import { buildReplayIndex, modelAtRevisionIndex } from "./snapshot";
import { currentText } from "./text";

function build(changelog: ReadonlyArray<Record<string, unknown>>): DocumentModel {
  const model = createModel();
  for (const revision of decodeOperations({ changelog })) {
    applyRevision(model, revision);
  }
  return model;
}

describe("paragraph marks (Phase 2)", () => {
  test("heading level rides the terminating paragraph-mark and surfaces on the block", () => {
    const model = build([
      { ty: "is", s: "Hello\n", ibi: 1, revision_id: 1 },
      { ty: "as", st: "paragraph", si: 6, ei: 6, sm: { ps_hd: 1 }, revision_id: 2 },
    ]);
    expect(currentText(model)).toBe("Hello\n");
    const blocks = blocksAt(model);
    expect(blocks[0]?.marks?.headingLevel).toBe(1);
  });

  test("alignment maps from ps_al and only when explicitly set", () => {
    const model = build([
      { ty: "is", s: "Centered\n", ibi: 1, revision_id: 1 },
      { ty: "as", st: "paragraph", si: 9, ei: 9, sm: { ps_al: 1, ps_al_i: false }, revision_id: 2 },
    ]);
    expect(blocksAt(model)[0]?.marks?.alignment).toBe("center");
  });

  test("the FINAL paragraph (no trailing newline) takes its style from the EndOfBody mark", () => {
    const model = build([
      { ty: "is", s: "Title", ibi: 1, revision_id: 1 },
      // live position 6 is the EndOfBody sentinel (after the 5 chars).
      { ty: "as", st: "paragraph", si: 6, ei: 6, sm: { ps_hd: 1 }, revision_id: 2 },
    ]);
    expect(currentText(model)).toBe("Title");
    expect(blocksAt(model)[0]?.marks?.headingLevel).toBe(1);
  });

  test("a later all-default op CLEARS prior marks (replace, not merge)", () => {
    const model = build([
      { ty: "is", s: "T\n", ibi: 1, revision_id: 1 },
      { ty: "as", st: "paragraph", si: 2, ei: 2, sm: { ps_hd: 2 }, revision_id: 2 },
      // revert to normal: ps_hd 0 + everything inherited -> empty marks -> clear.
      { ty: "as", st: "paragraph", si: 2, ei: 2, sm: { ps_hd: 0, ps_al_i: true }, revision_id: 3 },
    ]);
    expect(blocksAt(model)[0]?.marks).toBeUndefined();
  });

  test("lineSpacing and indent extract onto the block; text is untouched", () => {
    const model = build([
      { ty: "is", s: "Body\n", ibi: 1, revision_id: 1 },
      {
        ty: "as",
        st: "paragraph",
        si: 5,
        ei: 5,
        sm: { ps_ls: 1.5, ps_ls_i: false, ps_il: 36, ps_il_i: false },
        revision_id: 2,
      },
    ]);
    const marks = blocksAt(model)[0]?.marks;
    expect(marks?.lineSpacing).toBe(1.5);
    expect(marks?.indentStartPt).toBe(36);
    expect(currentText(model)).toBe("Body\n");
  });

  test("a struck paragraph-mark does NOT consume a paragraph style slot", () => {
    // "A\nB\n" then suggestion-delete the FIRST '\n' (pos 2). The struck '\n' keeps
    // its run whole, so collectParagraphMarks must skip it and stay aligned.
    const model = build([
      { ty: "is", s: "A\nB\n", ibi: 1, revision_id: 1 },
      { ty: "msfd", si: 2, ei: 2, revision_id: 2 },
      { ty: "as", st: "paragraph", si: 4, ei: 4, sm: { ps_hd: 3 }, revision_id: 3 },
    ]);
    // The visible-text concatenation invariant still holds.
    const visible = segmentsAt(model)
      .filter((s) => s.kind === "accepted-text" || s.kind === "suggested-insert")
      .map((s) => s.text)
      .join("");
    expect(visible).toBe(currentText(model));
    // The heading on the second '\n' resolves onto a paragraph block.
    expect(blocksAt(model).some((b) => b.marks?.headingLevel === 3)).toBe(true);
  });
});

describe("text marks (Phase 3)", () => {
  test("bold breaks the run and carries the mark on the styled segment only", () => {
    const model = build([
      { ty: "is", s: "abXcd", ibi: 1, revision_id: 1 },
      { ty: "as", st: "text", si: 3, ei: 3, sm: { ts_bd: true, ts_bd_i: false }, revision_id: 2 },
    ]);
    expect(currentText(model)).toBe("abXcd");
    const runs = segmentsAt(model).filter((s) => s.kind === "accepted-text");
    expect(runs.map((r) => r.text)).toEqual(["ab", "X", "cd"]);
    const styled = runs.find((r) => r.kind === "accepted-text" && r.text === "X");
    expect(styled?.kind === "accepted-text" ? styled.marks?.bold : undefined).toBe(true);
  });

  test("differing font sizes break runs; identical marks coalesce", () => {
    const model = build([
      { ty: "is", s: "ABCD", ibi: 1, revision_id: 1 },
      { ty: "as", st: "text", si: 1, ei: 2, sm: { ts_fs: 18, ts_fs_i: false }, revision_id: 2 },
      { ty: "as", st: "text", si: 3, ei: 4, sm: { ts_fs: 18, ts_fs_i: false }, revision_id: 3 },
    ]);
    // Both halves share fontSizePt 18 (structurally equal) -> a single coalesced run.
    const runs = segmentsAt(model).filter((s) => s.kind === "accepted-text");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.kind === "accepted-text" ? runs[0].marks?.fontSizePt : undefined).toBe(18);
  });

  test("clearing text marks removes them from the char", () => {
    const model = build([
      { ty: "is", s: "Z", ibi: 1, revision_id: 1 },
      { ty: "as", st: "text", si: 1, ei: 1, sm: { ts_it: true, ts_it_i: false }, revision_id: 2 },
      { ty: "as", st: "text", si: 1, ei: 1, sm: { ts_it: false, ts_it_i: true }, revision_id: 3 },
    ]);
    const run = segmentsAt(model).find((s) => s.kind === "accepted-text");
    expect(run?.kind === "accepted-text" ? run.marks : "present").toBeUndefined();
  });
  test("unstyled inserts inherit the preceding character's marks (typed-under-active-style)", () => {
    const model = build([
      { ty: "is", s: "a", ibi: 1, revision_id: 1 },
      { ty: "as", st: "text", si: 1, ei: 1, sm: { ts_bd: true, ts_bd_i: false }, revision_id: 2 },
      // Continued typing carries NO style op — Google never restates the run style
      // per keystroke; the new chars inherit the bold neighbor implicitly.
      { ty: "is", s: "bcd", ibi: 2, revision_id: 3 },
    ]);
    expect(currentText(model)).toBe("abcd");
    const runs = segmentsAt(model).filter((s) => s.kind === "accepted-text");
    // One coalesced bold run. Without inheritance this fragmented to "a"(bold)+"bcd"(plain) —
    // the styled-fragments regression where a sentence typed under active bold lost it.
    expect(runs.map((r) => r.text)).toEqual(["abcd"]);
    const run = runs[0];
    expect(run?.kind === "accepted-text" ? run.marks?.bold : undefined).toBe(true);
  });

  test("inserts at the document start inherit nothing (no preceding character)", () => {
    const model = build([{ ty: "is", s: "xy", ibi: 1, revision_id: 1 }]);
    const run = segmentsAt(model).find((s) => s.kind === "accepted-text");
    expect(run?.kind === "accepted-text" ? run.marks : "present").toBeUndefined();
  });

  test("a paragraph-start insert does NOT inherit a styled preceding '\\n'", () => {
    const model = build([
      { ty: "is", s: "Para1\n", ibi: 1, revision_id: 1 },
      // A text-scope bold range straddling the paragraph boundary stamps the '\n'.
      { ty: "as", st: "text", si: 1, ei: 6, sm: { ts_bd: true, ts_bd_i: false }, revision_id: 2 },
      // Typing at the start of the new paragraph (live pos 7, after the '\n').
      { ty: "is", s: "X", ibi: 7, revision_id: 3 },
    ]);
    expect(currentText(model)).toBe("Para1\nX");
    // The new paragraph is its own formatting context — 'X' must be unstyled, not
    // bold inherited across the boundary from the styled '\n'.
    const xRun = segmentsAt(model).find((s) => s.kind === "accepted-text" && s.text === "X");
    expect(xRun?.kind === "accepted-text" ? xRun.marks : "present").toBeUndefined();
  });
});

describe("time-travel fidelity (clone + snapshot)", () => {
  const changelog = [
    { ty: "is", s: "Heading\n", ibi: 1, revision_id: 1 },
    { ty: "as", st: "paragraph", si: 8, ei: 8, sm: { ps_hd: 1 }, revision_id: 2 },
    { ty: "is", s: "bold body\n", ibi: 9, revision_id: 3 },
    { ty: "as", st: "text", si: 9, ei: 12, sm: { ts_bd: true, ts_bd_i: false }, revision_id: 4 },
    { ty: "as", st: "paragraph", si: 18, ei: 18, sm: { ps_al: 2, ps_al_i: false }, revision_id: 5 },
  ];

  test("formatting survives cloneModel unchanged", () => {
    const model = build(changelog);
    const clone = cloneModel(model);
    expect(blocksAt(clone)[0]?.marks?.headingLevel).toBe(1);
    const boldRun = segmentsAt(clone).find(
      (s) => s.kind === "accepted-text" && s.text.includes("bold"),
    );
    expect(boldRun?.kind === "accepted-text" ? boldRun.marks?.bold : undefined).toBe(true);
  });

  test("snapshot-path blocks equal linear-path blocks (formatting time-travels)", () => {
    const revisions = decodeOperations({ changelog });
    // cadence 2 forces a cached snapshot mid-stream, exercising the clone path.
    const index = buildReplayIndex(revisions, 2, []);
    for (let i = 0; i <= revisions.length; i++) {
      const snapshotPath = blocksAt(modelAtRevisionIndex(index, i));
      const linear = createModel();
      for (let r = 0; r < i; r++) {
        const rev = revisions[r];
        if (rev !== undefined) applyRevision(linear, rev);
      }
      expect(snapshotPath).toEqual(blocksAt(linear));
    }
  });
});

describe("lists and entities (Phase 4)", () => {
  test("st:list membership surfaces on the block; ls_id null clears it", () => {
    const model = build([
      { ty: "is", s: "Item\n", ibi: 1, revision_id: 1 },
      { ty: "as", st: "list", si: 5, ei: 5, sm: { ls_id: "kix.l1", ls_nest: 1 }, revision_id: 2 },
    ]);
    expect(blocksAt(model)[0]?.list).toEqual({ level: 1 });
    // Removing from the list (ls_id null) clears membership.
    const removed = build([
      { ty: "is", s: "Item\n", ibi: 1, revision_id: 1 },
      { ty: "as", st: "list", si: 5, ei: 5, sm: { ls_id: "kix.l1" }, revision_id: 2 },
      { ty: "as", st: "list", si: 5, ei: 5, sm: { ls_id: null }, revision_id: 3 },
    ]);
    expect(blocksAt(removed)[0]?.list).toBeUndefined();
  });

  test("a paragraph keeps BOTH heading marks and list membership (separate scopes merge)", () => {
    const model = build([
      { ty: "is", s: "X\n", ibi: 1, revision_id: 1 },
      { ty: "as", st: "paragraph", si: 2, ei: 2, sm: { ps_hd: 2 }, revision_id: 2 },
      { ty: "as", st: "list", si: 2, ei: 2, sm: { ls_id: "kix.l1", ls_nest: 0 }, revision_id: 3 },
    ]);
    const block = blocksAt(model)[0];
    expect(block?.marks?.headingLevel).toBe(2);
    expect(block?.list).toEqual({ level: 0 });
  });

  test("te places an opaque image slot without changing the surrounding text", () => {
    const model = build([
      { ty: "is", s: "AB", ibi: 1, revision_id: 1 },
      { ty: "te", id: "kix.img", spi: 2, revision_id: 2 },
      { ty: "is", s: "C", ibi: 4, revision_id: 3 },
    ]);
    expect(currentText(model)).toBe("ABC");
    const blocks = blocksAt(model);
    const embed = blocks.find((b) => b.kind === "embed");
    expect(embed).toBeDefined();
    const opaque = embed?.runs.find((r) => r.kind === "opaque-placeholder");
    expect(opaque?.kind === "opaque-placeholder" ? opaque.structure : undefined).toBe("image");
  });
});
