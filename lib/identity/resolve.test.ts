// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { parseAccountLabel, parseOwnGaia, resolveSelfIdentity } from "./resolve";

describe("parseAccountLabel", () => {
  test("splits a OneGoogle account label into name + email", () => {
    expect(parseAccountLabel("Google Account: Ada Lovelace\n(ada@example.com)")).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  test("tolerates a localized prefix and collapsed whitespace", () => {
    expect(parseAccountLabel("Google-konto: Mofo Ker  (flylocious@gmail.com)")).toEqual({
      name: "Mofo Ker",
      email: "flylocious@gmail.com",
    });
  });

  test("falls back to the email local part when no name is present", () => {
    expect(parseAccountLabel("Account: (jane.doe@example.org)")).toEqual({
      name: "jane.doe",
      email: "jane.doe@example.org",
    });
  });

  test("keeps a bare name with no email", () => {
    expect(parseAccountLabel("Signed in as Grace Hopper")).toEqual({
      name: "Signed in as Grace Hopper",
      email: null,
    });
  });

  test("returns null for empty or identity-free input", () => {
    expect(parseAccountLabel("")).toBeNull();
    expect(parseAccountLabel("()")).toBeNull();
  });
});

describe("parseOwnGaia", () => {
  test("extracts the ogi/oui Gaia id from bootstrap text", () => {
    expect(parseOwnGaia("…,'ogi': '07280646734247216338' ,'oui':'07280646734247216338',…")).toBe(
      "07280646734247216338",
    );
    expect(parseOwnGaia('{"oui":"114356712814895346910"}')).toBe("114356712814895346910");
  });

  test("returns null when no id is present", () => {
    expect(parseOwnGaia("no identity here")).toBeNull();
    expect(parseOwnGaia("'ogi':''")).toBeNull();
  });
});

describe("resolveSelfIdentity", () => {
  test("builds an identity keyed by the own Gaia id", () => {
    expect(
      resolveSelfIdentity("07280646734247216338", "Google Account: Ada Lovelace (ada@example.com)"),
    ).toEqual({ userId: "07280646734247216338", name: "Ada Lovelace", email: "ada@example.com" });
  });

  test("returns null when either input is missing", () => {
    expect(resolveSelfIdentity(null, "Google Account: Ada (ada@example.com)")).toBeNull();
    expect(resolveSelfIdentity("07280646734247216338", null)).toBeNull();
  });
});
