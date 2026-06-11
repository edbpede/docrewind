// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { runPipeline, runPipelineOverBodies } from "./pipeline";

const GUARD = ")]}'\n";

function framed(value: unknown): string {
  return GUARD + JSON.stringify(value);
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
