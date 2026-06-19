// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { textAtRevisionIndex } from "../reconstruction/snapshot";
import { type PipelineResult, runPipeline, runPipelineOverBodies } from "./pipeline";

const GUARD = ")]}'\n";

function framed(value: unknown): string {
  return GUARD + JSON.stringify(value);
}

/** Final reconstructed text of a successful pipeline result (guarded). */
function finalText(result: PipelineResult): string {
  if (result.kind !== "ok") throw new Error(`expected ok pipeline, got ${result.kind}`);
  return textAtRevisionIndex(result.replayIndex, result.revisions.length);
}

const changelog = {
  changelog: [
    { ty: "is", s: "Hello", ibi: 1, revision_id: 1 },
    { ty: "is", s: " world", ibi: 6, revision_id: 2 },
  ],
};

describe("runPipeline (single body)", () => {
  test("decodes a framed json-changelog into revisions + replay index + timeline", () => {
    const result = runPipeline(framed(changelog));
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.revisions).toHaveLength(2);
      expect(result.replayIndex.revisions).toHaveLength(2);
      expect(Array.isArray(result.timeline)).toBe(true);
      expect(result.skippedChunks).toBe(0);
    }
  });

  test("accepts an already-parsed (non-string) body", () => {
    const result = runPipeline(changelog);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.revisions).toHaveLength(2);
  });

  test("short-circuits an unknown schema to a diagnostic (never throws)", () => {
    const result = runPipeline(framed({ notAChangelog: true }));
    expect(result).toEqual({ kind: "unsupported", reason: "unknown-schema" });
  });

  test("short-circuits malformed JSON to a parse-error (never throws)", () => {
    const result = runPipeline(`${GUARD}{ not valid json`);
    expect(result).toEqual({ kind: "unsupported", reason: "parse-error" });
  });
});

describe("runPipelineOverBodies (multi-chunk)", () => {
  test("concatenates revisions across supported chunks", () => {
    const chunkA = { changelog: [{ ty: "is", s: "A", ibi: 1, revision_id: 1 }] };
    const chunkB = { changelog: [{ ty: "is", s: "B", ibi: 2, revision_id: 2 }] };
    const result = runPipelineOverBodies([framed(chunkA), framed(chunkB)]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.revisions).toHaveLength(2);
  });

  test("skips an unsupported chunk but keeps the good ones", () => {
    const good = { changelog: [{ ty: "is", s: "A", ibi: 1, revision_id: 1 }] };
    const result = runPipelineOverBodies([framed(good), framed({ junk: 1 })]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.revisions).toHaveLength(1);
      expect(result.skippedChunks).toBe(1);
    }
  });

  test("returns unsupported only when every chunk fails", () => {
    const result = runPipelineOverBodies([framed({ junk: 1 }), `${GUARD}bad`]);
    expect(result).toEqual({ kind: "unsupported", reason: "unknown-schema" });
  });
});

describe("pipeline — pre-existing/base content", () => {
  test("rplc revision-1 template load reconstructs base + edits aligned (the live shape)", () => {
    // Mirrors the live Classroom payload: rev 1 is a bulk replace carrying the
    // template; later edits assume it is present.
    const body = {
      chunkedSnapshot: [],
      changelog: [
        { ty: "rplc", snapshot: [{ ty: "is", s: "Q1. ", ibi: 1 }], revision_id: 1 },
        { ty: "is", s: "answer", ibi: 5, revision_id: 2 },
      ],
    };
    expect(finalText(runPipeline(framed(body)))).toBe("Q1. answer");
  });

  test("a body's chunkedSnapshot seeds the base document for its changelog", () => {
    const body = {
      chunkedSnapshot: [[{ ty: "is", s: "TEMPLATE ", ibi: 1 }]],
      changelog: [{ ty: "is", s: "edit", ibi: 10, revision_id: 1 }],
    };
    expect(finalText(runPipeline(framed(body)))).toBe("TEMPLATE edit");
  });

  test("only the FIRST body's snapshot seeds the base (later snapshots are not double-counted)", () => {
    // body1 establishes base "AAA"; body2 carries its OWN (redundant) snapshot that
    // must be ignored, while its changelog continues from body1's content.
    const body1 = {
      chunkedSnapshot: [[{ ty: "is", s: "AAA", ibi: 1 }]],
      changelog: [{ ty: "is", s: "B", ibi: 4, revision_id: 1 }],
    };
    const body2 = {
      chunkedSnapshot: [[{ ty: "is", s: "ZZZ", ibi: 1 }]],
      changelog: [{ ty: "is", s: "C", ibi: 5, revision_id: 2 }],
    };
    const result = runPipelineOverBodies([framed(body1), framed(body2)]);
    expect(result.kind === "ok" ? result.revisions.length : 0).toBe(2);
    // "AAA" + B (ibi 4) + C (ibi 5) = "AAABC"; "ZZZ" never appears.
    expect(finalText(result)).toBe("AAABC");
  });

  test("a resumed first body (non-empty snapshot, no rev-1 rplc) still reconstructs", () => {
    // Simulates retrieval resuming mid-document: the first stored body starts past
    // revision 1, so its chunkedSnapshot carries the accumulated base content.
    const resumedBody = {
      chunkedSnapshot: [[{ ty: "is", s: "Seeded ", ibi: 1 }]],
      changelog: [{ ty: "is", s: "tail", ibi: 8, revision_id: 42 }],
    };
    expect(finalText(runPipeline(framed(resumedBody)))).toBe("Seeded tail");
  });
});
