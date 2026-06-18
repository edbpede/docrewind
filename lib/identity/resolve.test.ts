// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import {
  mergeIdentities,
  parseAccountLabel,
  parseOwnGaia,
  parseTilesParams,
  parseUserMap,
  resolveSelfIdentity,
  withSelfIdentity,
} from "./resolve";

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

describe("parseUserMap", () => {
  // Shape captured live 2026-06-18 from `…/revisions/tiles` for the multi-author doc.
  const tilesPayload = {
    firstRev: 1,
    tileInfo: [{ start: 1, end: 1, users: ["07280646734247216338"] }],
    userMap: {
      "03089517982426497767": { name: "RB Boot", color: "#673AB7", anonymous: false },
      "07280646734247216338": { name: "Mofo Ker", color: "#26A69A", anonymous: false },
      "12090495620932845773": { name: "Mr Torrint", color: "#F57C00", anonymous: false },
    },
  };

  test("maps every userMap entry to a name (+colour) identity keyed by the Gaia id", () => {
    expect(parseUserMap(tilesPayload)).toEqual({
      "03089517982426497767": {
        userId: "03089517982426497767",
        name: "RB Boot",
        email: null,
        color: "#673AB7",
      },
      "07280646734247216338": {
        userId: "07280646734247216338",
        name: "Mofo Ker",
        email: null,
        color: "#26A69A",
      },
      "12090495620932845773": {
        userId: "12090495620932845773",
        name: "Mr Torrint",
        email: null,
        color: "#F57C00",
      },
    });
  });

  test("omits colour when the entry carries none, and trims a present colour", () => {
    expect(
      parseUserMap({
        userMap: {
          a: { name: "Ada" },
          b: { name: "Bo", color: "  #ABCDEF  " },
        },
      }),
    ).toEqual({
      a: { userId: "a", name: "Ada", email: null },
      b: { userId: "b", name: "Bo", email: null, color: "#ABCDEF" },
    });
  });

  test("skips anonymous entries and entries without a usable name", () => {
    expect(
      parseUserMap({
        userMap: {
          a: { name: "Ada", anonymous: false },
          b: { name: "Ghost", anonymous: true },
          c: { name: "   " },
          d: { color: "#fff" },
          e: "not-a-record",
        },
      }),
    ).toEqual({ a: { userId: "a", name: "Ada", email: null } });
  });

  test("tolerates a malformed or absent payload without throwing", () => {
    expect(parseUserMap(null)).toEqual({});
    expect(parseUserMap({})).toEqual({});
    expect(parseUserMap({ userMap: [] })).toEqual({});
    expect(parseUserMap("nonsense")).toEqual({});
  });
});

describe("parseTilesParams", () => {
  // The server-rendered /edit HTML carries double-quoted JSON inside info_params.
  const html =
    'x,"docs-eivt":true,"info_params":{"token":"ABg6iWQeSna72N940iMkaGqYEAMf:1781785865135","ouid":"114356712814895346910"},"revision":308';

  test("extracts the token + ouid from edit-page bootstrap HTML", () => {
    expect(parseTilesParams(html)).toEqual({
      token: "ABg6iWQeSna72N940iMkaGqYEAMf:1781785865135",
      ouid: "114356712814895346910",
    });
  });

  test("returns null when token or ouid is absent", () => {
    expect(parseTilesParams('"ouid":"114356712814895346910"')).toBeNull();
    expect(parseTilesParams('"info_params":{"token":"ABg6iW:1781785865135"}')).toBeNull();
    expect(parseTilesParams("no identity here")).toBeNull();
  });

  test("ignores a token field lacking the :timestamp credential shape", () => {
    expect(parseTilesParams('"token":"plainvalue","ouid":"114356712814895346910"')).toBeNull();
  });
});

describe("mergeIdentities", () => {
  test("incoming names win while a pre-existing email is preserved", () => {
    const base = {
      "07280646734247216338": {
        userId: "07280646734247216338",
        name: "Mofo",
        email: "flylocious@gmail.com",
      },
    };
    const incoming = {
      "07280646734247216338": { userId: "07280646734247216338", name: "Mofo Ker", email: null },
      "03089517982426497767": { userId: "03089517982426497767", name: "RB Boot", email: null },
    };
    expect(mergeIdentities(base, incoming)).toEqual({
      "07280646734247216338": {
        userId: "07280646734247216338",
        name: "Mofo Ker",
        email: "flylocious@gmail.com",
      },
      "03089517982426497767": { userId: "03089517982426497767", name: "RB Boot", email: null },
    });
  });

  test("incoming colour wins while a pre-existing colour is preserved when absent", () => {
    const base = {
      keep: { userId: "keep", name: "Keep", email: null, color: "#111111" },
      over: { userId: "over", name: "Over", email: null, color: "#222222" },
    };
    const incoming = {
      keep: { userId: "keep", name: "Keep", email: null }, // name-only refresh
      over: { userId: "over", name: "Over", email: null, color: "#999999" },
      fresh: { userId: "fresh", name: "Fresh", email: null, color: "#abcabc" },
    };
    expect(mergeIdentities(base, incoming)).toEqual({
      keep: { userId: "keep", name: "Keep", email: null, color: "#111111" },
      over: { userId: "over", name: "Over", email: null, color: "#999999" },
      fresh: { userId: "fresh", name: "Fresh", email: null, color: "#abcabc" },
    });
  });

  test("does not mutate the base map", () => {
    const base = { a: { userId: "a", name: "A", email: null } };
    mergeIdentities(base, { b: { userId: "b", name: "B", email: null } });
    expect(base).toEqual({ a: { userId: "a", name: "A", email: null } });
  });
});

describe("withSelfIdentity", () => {
  const self = { userId: "0728", name: "Mofo Ker", email: "flylocious@gmail.com" };

  test("adds the viewer in full when the token is not yet resolved", () => {
    expect(withSelfIdentity({}, self)).toEqual({
      "0728": { userId: "0728", name: "Mofo Ker", email: "flylocious@gmail.com" },
    });
  });

  test("enriches a tiles-resolved entry with the email, keeping its name + colour", () => {
    // The tiles harvest landed first: authoritative name + colour, but no email.
    const current = {
      "0728": { userId: "0728", name: "Mofo Ker", email: null, color: "#26A69A" },
    };
    expect(withSelfIdentity(current, self)).toEqual({
      "0728": { userId: "0728", name: "Mofo Ker", email: "flylocious@gmail.com", color: "#26A69A" },
    });
  });

  test("is a no-op (null) when the cached entry already has an email", () => {
    const current = {
      "0728": { userId: "0728", name: "Mofo Ker", email: "flylocious@gmail.com", color: "#26A69A" },
    };
    expect(withSelfIdentity(current, self)).toBeNull();
  });

  test("is a no-op (null) when the self identity carries no email to add", () => {
    const current = { "0728": { userId: "0728", name: "Mofo Ker", email: null } };
    expect(withSelfIdentity(current, { userId: "0728", name: "Mofo Ker", email: null })).toBeNull();
  });
});
