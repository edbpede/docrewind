// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { asDocId, asRevisionId } from "../domain/ids";
import { buildRevisionsLoadUrl } from "./endpoints";

describe("buildRevisionsLoadUrl", () => {
  test("builds the single-account revisions/load URL", () => {
    expect(
      buildRevisionsLoadUrl({
        docId: asDocId("doc_123"),
        start: asRevisionId(1),
        end: asRevisionId(5),
        userIndex: null,
      }),
    ).toBe("https://docs.google.com/document/d/doc_123/revisions/load?id=doc_123&start=1&end=5");
  });

  test("puts /u/{N} after /document for multi-account revisions/load URLs", () => {
    expect(
      buildRevisionsLoadUrl({
        docId: asDocId("doc_123"),
        start: asRevisionId(1),
        end: asRevisionId(5),
        userIndex: 1,
      }),
    ).toBe(
      "https://docs.google.com/document/u/1/d/doc_123/revisions/load?id=doc_123&start=1&end=5",
    );
  });

  test("rejects invalid userIndex values", () => {
    expect(() =>
      buildRevisionsLoadUrl({
        docId: asDocId("doc_123"),
        start: asRevisionId(1),
        end: asRevisionId(5),
        userIndex: -1,
      }),
    ).toThrow(TypeError);
  });
});
