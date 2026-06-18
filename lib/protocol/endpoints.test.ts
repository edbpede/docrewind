// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { asDocId, asRevisionId } from "../domain/ids";
import { buildRevisionsLoadUrl, buildRevisionsTilesUrl } from "./endpoints";

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

describe("buildRevisionsTilesUrl", () => {
  test("builds the single-account revisions/tiles URL with the required params", () => {
    const url = new URL(
      buildRevisionsTilesUrl({
        docId: asDocId("doc_123"),
        userIndex: null,
        token: "ABg6iW:1781785865135",
        ouid: "114356712814895346910",
      }),
    );
    expect(url.pathname).toBe("/document/d/doc_123/revisions/tiles");
    expect(url.searchParams.get("id")).toBe("doc_123");
    expect(url.searchParams.get("token")).toBe("ABg6iW:1781785865135");
    expect(url.searchParams.get("ouid")).toBe("114356712814895346910");
    expect(url.searchParams.get("revisionBatchSize")).toBe("1500");
    expect(url.searchParams.get("includes_info_params")).toBe("true");
  });

  test("puts /u/{N} after /document and honours a custom batch size", () => {
    const url = new URL(
      buildRevisionsTilesUrl({
        docId: asDocId("doc_123"),
        userIndex: 1,
        token: "t:1",
        ouid: "999",
        revisionBatchSize: 50,
      }),
    );
    expect(url.pathname).toBe("/document/u/1/d/doc_123/revisions/tiles");
    expect(url.searchParams.get("revisionBatchSize")).toBe("50");
  });

  test("rejects invalid userIndex values", () => {
    expect(() =>
      buildRevisionsTilesUrl({
        docId: asDocId("doc_123"),
        userIndex: -1,
        token: "t:1",
        ouid: "999",
      }),
    ).toThrow(TypeError);
  });
});
