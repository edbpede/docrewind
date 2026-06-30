// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { type DocumentKind, isDocumentKind } from "./kind";

describe("isDocumentKind", () => {
  test.each<DocumentKind>(["doc", "sheet"])("accepts the known kind %p", (kind) => {
    expect(isDocumentKind(kind)).toBe(true);
  });

  // Each case is wrapped in a 1-tuple so `test.each` does not spread array
  // values (e.g. `["doc"]`) into separate arguments.
  test.each<[unknown]>([
    ["shet"],
    ["Sheet"],
    ["document"],
    [""],
    [undefined],
    [null],
    [0],
    [1],
    [{}],
    [["doc"]],
  ])("rejects out-of-set value %p", (bad) => {
    expect(isDocumentKind(bad)).toBe(false);
  });
});
