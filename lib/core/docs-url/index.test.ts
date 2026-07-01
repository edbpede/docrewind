// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { asDocId } from "@/lib/core/domain/ids";
import { extractDocId, parseDocsUrl } from "./index";

const ID = "1aB2_c-3D4eF";

describe("extractDocId", () => {
  test("extracts the id from a single-account document URL", () => {
    expect(extractDocId(`https://docs.google.com/document/d/${ID}/edit`)).toBe(asDocId(ID));
  });

  test("extracts the id from a multi-account /u/{N}/ URL", () => {
    expect(extractDocId(`https://docs.google.com/document/u/1/d/${ID}/edit`)).toBe(asDocId(ID));
  });

  test("extracts the id from a spreadsheets URL (kind sheet)", () => {
    expect(extractDocId("https://docs.google.com/spreadsheets/d/abc/edit")).toBe(asDocId("abc"));
  });

  test("extracts the id regardless of host (host is gated by the content-script `matches`, not here)", () => {
    expect(extractDocId("https://example.com/document/d/abc")).not.toBeNull();
  });

  test("returns null when there is no /document/d/ segment", () => {
    expect(extractDocId("https://docs.google.com/")).toBeNull();
  });

  test("returns null when the id segment fails validation", () => {
    // A bang is not a valid Docs id character.
    expect(extractDocId("https://docs.google.com/document/d/bad!id/edit")).toBeNull();
  });

  test("ignores a /document/d/ embedded only in the query string", () => {
    expect(extractDocId("https://docs.google.com/?x=/document/d/spoof/edit")).toBeNull();
  });

  test("extracts the id from the Classroom grading iframe URL (/d/{id}/grading)", () => {
    expect(
      extractDocId(
        `https://docs.google.com/document/d/${ID}/grading?authuser=0&enable_comments=true`,
      ),
    ).toBe(asDocId(ID));
  });
});

describe("parseDocsUrl", () => {
  test("returns docId + null userIndex for a single-account URL", () => {
    expect(parseDocsUrl(`https://docs.google.com/document/d/${ID}/edit`)).toEqual({
      docId: asDocId(ID),
      userIndex: null,
      kind: "doc",
    });
  });

  test("returns docId + the /u/{N}/ index for a multi-account URL", () => {
    expect(parseDocsUrl(`https://docs.google.com/document/u/2/d/${ID}/edit`)).toEqual({
      docId: asDocId(ID),
      userIndex: 2,
      kind: "doc",
    });
  });

  test("returns null for a malformed / non-document URL", () => {
    expect(parseDocsUrl("https://docs.google.com/document/")).toBeNull();
  });

  test("reads the authuser slot from a Classroom grading iframe URL", () => {
    expect(parseDocsUrl(`https://docs.google.com/document/d/${ID}/grading?authuser=0`)).toEqual({
      docId: asDocId(ID),
      userIndex: 0,
      kind: "doc",
    });
  });
  test("tags a spreadsheets URL with kind sheet (multi-account aware)", () => {
    expect(parseDocsUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toEqual({
      docId: asDocId(ID),
      userIndex: null,
      kind: "sheet",
    });
    expect(parseDocsUrl(`https://docs.google.com/spreadsheets/u/3/d/${ID}/edit`)).toEqual({
      docId: asDocId(ID),
      userIndex: 3,
      kind: "sheet",
    });
  });
});
