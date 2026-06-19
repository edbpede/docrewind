// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { asRevisionId, asUserId } from "../domain/ids";
import type { DecodedRevision } from "../domain/model";
import { deriveAuthors } from "./authors";

function revision(
  id: number,
  time: number | null,
  userId: DecodedRevision["userId"],
): DecodedRevision {
  return { revisionId: asRevisionId(id), userId, sessionId: null, time, operations: [] };
}

describe("deriveAuthors", () => {
  test("collapses one author across many revisions into a single entry", () => {
    const authors = deriveAuthors(
      [
        revision(1, 1_000, asUserId("author-1")),
        revision(2, 5_000, asUserId("author-1")),
        revision(3, 9_000, asUserId("author-1")),
      ],
      false,
      {},
    );
    expect(authors).toHaveLength(1);
    expect(authors[0]?.key).toBe("author-1");
    expect(authors[0]?.edits).toBe(3);
    expect(authors[0]?.firstTime).toBe(1_000);
    expect(authors[0]?.lastTime).toBe(9_000);
  });

  test("numbers authors opaquely in first-seen order, ignoring null users", () => {
    const authors = deriveAuthors(
      [
        revision(1, null, null),
        revision(2, null, asUserId("zeta")),
        revision(3, null, asUserId("alpha")),
      ],
      false,
      {},
    );
    expect(authors.map((a) => a.label)).toEqual(["Author 1", "Author 2"]);
    expect(authors.map((a) => a.key)).toEqual(["zeta", "alpha"]);
  });

  test("resolves real name + colour only when realIdentities is on", () => {
    const identities = {
      gaia: { userId: "gaia", name: "Ada Lovelace", email: "ada@example.com", color: "#673AB7" },
    };
    const off = deriveAuthors([revision(1, null, asUserId("gaia"))], false, identities);
    expect(off[0]?.label).toBe("Author 1");
    expect(off[0]?.color).toBeNull();

    const on = deriveAuthors([revision(1, null, asUserId("gaia"))], true, identities);
    expect(on[0]?.label).toBe("Ada Lovelace");
    expect(on[0]?.email).toBe("ada@example.com");
    expect(on[0]?.color).toBe("#673AB7");
  });

  test("falls back to the opaque label (never the raw token) on a resolution miss", () => {
    const authors = deriveAuthors([revision(1, null, asUserId("unmapped"))], true, {});
    expect(authors[0]?.label).toBe("Author 1");
    expect(authors[0]?.color).toBeNull();
  });
});
