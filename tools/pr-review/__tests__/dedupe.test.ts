// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { dropDuplicates, extractFingerprints, fingerprint, markerFor, withMarker } from "../dedupe";

const inputA = { path: "a.ts", line: 10, side: "RIGHT", body: "Null check missing." };
const inputB = { path: "b.ts", line: 5, side: "LEFT", body: "Different issue." };

describe("fingerprint", () => {
  it("is stable across trivial whitespace/case body edits", () => {
    const fp1 = fingerprint(inputA);
    const fp2 = fingerprint({ ...inputA, body: "  null   CHECK missing.  " });
    expect(fp1).toBe(fp2);
  });

  it("differs when path/line/side differ", () => {
    expect(fingerprint(inputA)).not.toBe(fingerprint({ ...inputA, line: 11 }));
  });

  it("ignores an already-embedded marker when fingerprinting", () => {
    const fp = fingerprint(inputA);
    const withMark = { ...inputA, body: withMarker(inputA.body, fp) };
    expect(fingerprint(withMark)).toBe(fp);
  });
});

describe("extractFingerprints", () => {
  it("pulls fingerprints out of prior comment bodies", () => {
    const fp = fingerprint(inputA);
    const set = extractFingerprints([`Some text\n${markerFor(fp)}`, "no marker here"]);
    expect(set.has(fp)).toBe(true);
    expect(set.size).toBe(1);
  });
});

describe("dropDuplicates", () => {
  it("skips candidates already posted (by prior fingerprint)", () => {
    const prior = new Set([fingerprint(inputA)]);
    const kept = dropDuplicates([inputA, inputB], prior);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.comment.path).toBe("b.ts");
  });

  it("collapses intra-batch duplicates", () => {
    const kept = dropDuplicates([inputA, { ...inputA }], new Set());
    expect(kept).toHaveLength(1);
  });

  it("returns each survivor paired with its fingerprint", () => {
    const kept = dropDuplicates([inputA], new Set());
    expect(kept[0]?.fp).toBe(fingerprint(inputA));
  });
});
