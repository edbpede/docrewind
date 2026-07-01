// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bun unit test for the pure block grouper (plan Phase 1). Headline invariant
// (mirrors render.test.ts): concatenating the accepted-text + suggested-insert
// BlockRun text across every block equals currentText(model). `blocksAt` is
// SINGLE-ARG — no test passes an applied-count (or any `t`) into it — and the
// snapshot-assisted scrub path must produce identical blocks to a fresh linear
// replay (proving blocks derive purely from the already-time-traveled model).

import { describe, expect, test } from "bun:test";
import { decodeOperations } from "@/lib/core/docs/decoder/decode";
import { FIXTURES } from "@/lib/core/fixtures/corpus";
import { applyRevision } from "./apply";
import { type Block, blocksAt } from "./blocks";
import { createModel, type DocumentModel } from "./model";
import { buildReplayIndex, modelAtRevisionIndex } from "./snapshot";
import { currentText } from "./text";

function reconstruct(changelog: ReadonlyArray<Record<string, unknown>>): DocumentModel {
  const model = createModel();
  for (const revision of decodeOperations({ changelog })) {
    applyRevision(model, revision);
  }
  return model;
}

/** Visible (currentText-eligible) text across all blocks, in document order. */
function visibleText(blocks: readonly Block[]): string {
  let out = "";
  for (const block of blocks) {
    for (const run of block.runs) {
      if (run.kind === "accepted-text" || run.kind === "suggested-insert") out += run.text;
    }
  }
  return out;
}

describe("blocksAt visible-text invariant", () => {
  for (const fixture of FIXTURES) {
    test(`${fixture.name}: accepted+suggested concat across blocks === currentText`, () => {
      const model = reconstruct(fixture.changelog);
      expect(visibleText(blocksAt(model))).toBe(currentText(model));
    });
  }
});

describe("paragraph splitting", () => {
  test("text with no newline is a single paragraph block", () => {
    const blocks = blocksAt(
      reconstruct([{ ty: "is", s: "one paragraph", ibi: 1, revision_id: 1 }]),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("paragraph");
    expect(blocks[0]?.runs).toHaveLength(1);
  });

  test("N interior newlines yield N+1 paragraph blocks", () => {
    const blocks = blocksAt(reconstruct([{ ty: "is", s: "a\nb\nc", ibi: 1, revision_id: 1 }]));
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.kind === "paragraph")).toBe(true);
    // Each non-empty paragraph carries exactly its own line's text (newline kept
    // in the run text, stripped only at display time).
    expect(blocks[0]?.runs[0]?.kind === "accepted-text" ? blocks[0].runs[0].text : "").toBe("a\n");
    expect(blocks[2]?.runs[0]?.kind === "accepted-text" ? blocks[2].runs[0].text : "").toBe("c");
  });

  test("a trailing newline emits a final empty paragraph (the new line)", () => {
    const blocks = blocksAt(reconstruct([{ ty: "is", s: "abc\n", ibi: 1, revision_id: 1 }]));
    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.runs).toHaveLength(0); // empty trailing paragraph
  });

  test("consecutive newlines yield an empty middle paragraph", () => {
    const blocks = blocksAt(reconstruct([{ ty: "is", s: "a\n\nb", ibi: 1, revision_id: 1 }]));
    expect(blocks).toHaveLength(3);
    expect(visibleText(blocks)).toBe("a\n\nb");
    // The middle paragraph's only run is the bare newline (renders as a blank line).
    expect(blocks[1]?.runs[0]?.kind === "accepted-text" ? blocks[1].runs[0].text : "x").toBe("\n");
  });

  test("the newline character is neither duplicated nor dropped", () => {
    const model = reconstruct([{ ty: "is", s: "x\ny\nz\n", ibi: 1, revision_id: 1 }]);
    expect(visibleText(blocksAt(model))).toBe(currentText(model));
    expect(visibleText(blocksAt(model))).toBe("x\ny\nz\n");
  });
});

describe("opaque embeds", () => {
  test("an opaque slot becomes its own embed block between paragraphs", () => {
    // "AB" <image> "C" all on one line -> paragraph, embed, paragraph.
    const blocks = blocksAt(
      reconstruct([
        { ty: "is", s: "AB", ibi: 1, revision_id: 1 },
        { ty: "opaque", structure: "image", position: 3, revision_id: 2 },
        { ty: "is", s: "C", ibi: 4, revision_id: 3 },
      ]),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "embed", "paragraph"]);
    const embed = blocks[1]?.runs[0];
    expect(embed?.kind).toBe("opaque-placeholder");
    expect(embed?.kind === "opaque-placeholder" ? embed.structure : "").toBe("image");
    // The embed contributes no visible text; the surrounding runs still concat.
    expect(visibleText(blocks)).toBe("ABC");
  });
});

describe("marked-for-deletion runs", () => {
  test("struck text is kept whole, excluded from visible text, never splits a paragraph", () => {
    // "keep\ngo" with the leading "keep\n" suggestion-deleted (msfd over 1..5).
    const model = reconstruct([
      { ty: "is", s: "keep\ngo", ibi: 1, revision_id: 1 },
      { ty: "msfd", si: 1, ei: 5, revision_id: 2 },
    ]);
    const blocks = blocksAt(model);
    // The struck "keep\n" must not forge a paragraph boundary: visible text is
    // exactly currentText (which excludes the struck run + its newline).
    expect(visibleText(blocks)).toBe(currentText(model));
    const struck = blocks.flatMap((b) => b.runs).find((r) => r.kind === "marked-for-deletion");
    expect(struck?.kind === "marked-for-deletion" ? struck.text : "").toContain("\n");
  });
});

describe("global run seq", () => {
  test("seq is contiguous and unique across the whole block tree", () => {
    const blocks = blocksAt(
      reconstruct([
        { ty: "is", s: "a\nb", ibi: 1, revision_id: 1 },
        { ty: "opaque", structure: "table", position: 1, revision_id: 2 },
      ]),
    );
    const seqs = blocks.flatMap((b) => b.runs).map((r) => r.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs[0]).toBe(0);
    expect(seqs.at(-1)).toBe(seqs.length - 1);
  });
});

describe("single-arg purity: snapshot path == linear path", () => {
  // A multi-revision changelog with paragraph breaks, a suggestion, a struck
  // range, and an embed, so every blocksAt branch is exercised across scrubbing.
  const changelog: ReadonlyArray<Record<string, unknown>> = [
    { ty: "is", s: "Intro line\n", ibi: 1, revision_id: 1 },
    { ty: "is", s: "Second\nThird\n", ibi: 12, revision_id: 2 },
    { ty: "iss", s: "[draft] ", ibi: 1, revision_id: 3 },
    { ty: "opaque", structure: "image", position: 1, revision_id: 4 },
    { ty: "is", s: "tail\n\nend", ibi: 40, revision_id: 5 },
    { ty: "msfd", si: 1, ei: 8, revision_id: 6 },
  ];

  function linearModelTo(n: number): DocumentModel {
    const model = createModel();
    const revisions = decodeOperations({ changelog });
    for (let i = 0; i < n; i++) {
      const revision = revisions[i];
      if (revision) applyRevision(model, revision);
    }
    return model;
  }

  test("snapshot-assisted scrub yields identical blocks to a fresh linear replay", () => {
    const revisions = decodeOperations({ changelog });
    // cadence=2 forces real snapshots so the snapshot+replay-forward path runs.
    const index = buildReplayIndex(revisions, 2);
    for (let n = 0; n <= revisions.length; n++) {
      const viaSnapshot = blocksAt(modelAtRevisionIndex(index, n));
      const viaLinear = blocksAt(linearModelTo(n));
      expect(JSON.stringify(viaSnapshot)).toBe(JSON.stringify(viaLinear));
    }
  });
});

describe("empty document", () => {
  test("an empty model produces no visible runs", () => {
    const blocks = blocksAt(createModel());
    expect(visibleText(blocks)).toBe("");
    expect(blocks.flatMap((b) => b.runs)).toHaveLength(0);
  });
});
