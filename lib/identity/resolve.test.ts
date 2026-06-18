// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import {
  attachCollaboratorEmails,
  mergeIdentities,
  parseAccountLabel,
  parseDriveShareAcl,
  parseOwnGaia,
  parseTilesHovercardIds,
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

describe("parseTilesHovercardIds", () => {
  test("maps each token to its peopleHovercardId, skipping entries without one", () => {
    expect(
      parseTilesHovercardIds({
        userMap: {
          "03089517982426497767": { name: "RB Boot", peopleHovercardId: "104941268820871967559" },
          "12090495620932845773": {
            name: "Mr Torrint",
            peopleHovercardId: "  109650672404104410772  ",
          },
          noHover: { name: "Nameless" },
          blank: { name: "Blank", peopleHovercardId: "   " },
          notRecord: "nope",
        },
      }),
    ).toEqual({
      "03089517982426497767": "104941268820871967559",
      "12090495620932845773": "109650672404104410772",
    });
  });

  test("tolerates a malformed or absent payload without throwing", () => {
    expect(parseTilesHovercardIds(null)).toEqual({});
    expect(parseTilesHovercardIds({})).toEqual({});
    expect(parseTilesHovercardIds({ userMap: [] })).toEqual({});
    expect(parseTilesHovercardIds("nope")).toEqual({});
  });
});

describe("parseDriveShareAcl", () => {
  // The live `drivesharing/driveshare` blob is deeply escaped JSON (`\"`), fields
  // alphabetical. `esc` reproduces that escaping over readable JSON. Captured shape
  // 2026-06-18: two active user perms, one group (skipped), one deleted user (skipped).
  const esc = (json: string) => json.replace(/"/g, '\\"');
  const acl = esc(
    '{"permissions":[' +
      '{"capabilities":{"canShare":true},"deleted":false,"domain":"gmail.com",' +
      '"emailAddress":"cautiosreboot0402@gmail.com","id":"06332265589177339962",' +
      '"isCollaboratorAccount":false,"role":"writer","type":"user",' +
      '"userId":"104941268820871967559"},' +
      '{"capabilities":{"canShare":false},"deleted":false,"domain":"gmail.com",' +
      '"emailAddress":"s14s14s14mail@gmail.com","id":"06332265589177339963",' +
      '"isCollaboratorAccount":false,"role":"writer","type":"user",' +
      '"userId":"109650672404104410772"},' +
      '{"capabilities":{},"deleted":false,"emailAddress":"team@example.com",' +
      '"id":"77","role":"reader","type":"group","userId":"222"},' +
      '{"capabilities":{},"deleted":true,"domain":"gmail.com",' +
      '"emailAddress":"left@gmail.com","id":"88","type":"user","userId":"333"}' +
      "]}",
  );

  test("returns {gaia→email} for active user perms only (skips groups + deleted)", () => {
    expect(parseDriveShareAcl(acl)).toEqual({
      "104941268820871967559": "cautiosreboot0402@gmail.com",
      "109650672404104410772": "s14s14s14mail@gmail.com",
    });
  });

  test("keeps an active perm that directly follows a deleted one", () => {
    // The look-back must be scoped to the current object: a DELETED perm sitting just
    // before an ACTIVE one must not leak its `"deleted":true` flag forward and suppress it.
    const deletedThenActive = esc(
      '{"permissions":[' +
        '{"capabilities":{},"deleted":true,"domain":"gmail.com",' +
        '"emailAddress":"left@gmail.com","id":"88","type":"user","userId":"333"},' +
        '{"capabilities":{"canShare":true},"deleted":false,"domain":"gmail.com",' +
        '"emailAddress":"cautiosreboot0402@gmail.com","id":"06332265589177339962",' +
        '"isCollaboratorAccount":false,"role":"writer","type":"user",' +
        '"userId":"104941268820871967559"}' +
        "]}",
    );
    expect(parseDriveShareAcl(deletedThenActive)).toEqual({
      "104941268820871967559": "cautiosreboot0402@gmail.com",
    });
  });

  test("extracts emails when a key precedes `permissions` in the wrapper object", () => {
    // Drive API v3 PermissionList emits `kind` FIRST, so the live wrapper is
    // `{"kind":"drive#permissionList","permissions":[…]}`. Anchoring on the array opener
    // (not the literal `{"permissions":[`) means a preceding key no longer hides the ACL.
    const precedingKey = esc(
      '{"kind":"drive#permissionList","permissions":[' +
        '{"deleted":false,"emailAddress":"cautiosreboot0402@gmail.com",' +
        '"type":"user","userId":"104941268820871967559"}' +
        "]}",
    );
    expect(parseDriveShareAcl(precedingKey)).toEqual({
      "104941268820871967559": "cautiosreboot0402@gmail.com",
    });
  });

  test("extracts emails when the marker carries whitespace (pretty-printed JSON)", () => {
    // A literal `{"permissions":[` marker fails the instant the serializer inserts spaces
    // around the colon or brackets; the whitespace-tolerant `"permissions"\s*:\s*\[` anchor
    // matches the pretty-printed form too.
    const prettyPrinted = esc(
      '{ "permissions" : [ ' +
        '{ "deleted": false, "emailAddress": "s14s14s14mail@gmail.com", ' +
        '"type": "user", "userId": "109650672404104410772" } ' +
        "] }",
    );
    expect(parseDriveShareAcl(prettyPrinted)).toEqual({
      "109650672404104410772": "s14s14s14mail@gmail.com",
    });
  });

  test("excludes a deleted perm whose field value before emailAddress contains a '{'", () => {
    // Structural defect the regex-window approach was vulnerable to: a field value carrying
    // a literal `{` (here a displayName-like field, alphabetically between deleted and
    // emailAddress) used to defeat the `{`-anchored look-back and leak the deleted email.
    const deletedWithBrace = esc(
      '{"permissions":[' +
        '{"capabilities":{},"deleted":true,"displayName":"Team {Alpha}","domain":"gmail.com",' +
        '"emailAddress":"left@gmail.com","id":"88","type":"user","userId":"333"}' +
        "]}",
    );
    expect(parseDriveShareAcl(deletedWithBrace)).toEqual({});
  });

  test("keeps an active perm whose field value contains a '{'", () => {
    const activeWithBrace = esc(
      '{"permissions":[' +
        '{"capabilities":{"canShare":true},"deleted":false,"displayName":"Team {Beta}",' +
        '"domain":"gmail.com","emailAddress":"keep@gmail.com","id":"99","type":"user",' +
        '"userId":"444"}' +
        "]}",
    );
    expect(parseDriveShareAcl(activeWithBrace)).toEqual({ "444": "keep@gmail.com" });
  });

  test("extracts emails when the array is embedded in surrounding HTML", () => {
    // The real response is a ~78 KB HTML document: markup + other JSON before the ACL and
    // a later `]}` / markup after it. A greedy slice over-captures to the trailing `]}`
    // and JSON.parse throws → all emails lost; the balanced-span walk stops at the ACL's
    // own close.
    const embedded =
      "<!DOCTYPE html><html><body><script>var x = [1, 2];</script>" +
      esc(
        '{"permissions":[' +
          '{"deleted":false,"emailAddress":"cautiosreboot0402@gmail.com",' +
          '"type":"user","userId":"104941268820871967559"}' +
          "]}",
      ) +
      '<div data-foo="[trailing]">later</div>{"unrelated":[9]}</body></html>';
    expect(parseDriveShareAcl(embedded)).toEqual({
      "104941268820871967559": "cautiosreboot0402@gmail.com",
    });
  });

  test("extracts emails when a permission carries a nested-array field", () => {
    // A naive lazy `*?` slice stops at the FIRST `]}`, truncating after a nested array
    // field (here `permissionDetails`) and losing the perm. The balanced-span walk tracks
    // depth, so the nested `]` does not close the outer object early.
    const nestedArray = esc(
      '{"permissions":[' +
        '{"deleted":false,"emailAddress":"s14s14s14mail@gmail.com",' +
        '"permissionDetails":[{"role":"writer","permissionType":"user"}],' +
        '"type":"user","userId":"109650672404104410772"}' +
        "]}",
    );
    expect(parseDriveShareAcl(nestedArray)).toEqual({
      "109650672404104410772": "s14s14s14mail@gmail.com",
    });
  });

  test("rejects a non-numeric userId (the real Gaia id is always digits)", () => {
    const nonNumericId = esc(
      '{"permissions":[' +
        '{"deleted":false,"emailAddress":"spoof@gmail.com",' +
        '"type":"user","userId":"not-a-gaia-id"}' +
        "]}",
    );
    expect(parseDriveShareAcl(nonNumericId)).toEqual({});
  });

  test("ignores an unrelated earlier `permissions` array that shadows the real ACL", () => {
    // The ~78 KB blob can carry an unrelated `"permissions":[…]` (app config / capability list)
    // BEFORE the real sharing ACL. First-match-wins would slice that decoy and drop every email.
    // Merging every array's extraction skips the numeric decoy (it yields nothing) and resolves
    // the real ACL regardless of order.
    const shadowed = esc(
      '{"config":{"permissions":[1,2,3]}}' +
        '{"permissions":[' +
        '{"deleted":false,"emailAddress":"cautiosreboot0402@gmail.com",' +
        '"type":"user","userId":"104941268820871967559"}' +
        "]}",
    );
    expect(parseDriveShareAcl(shadowed)).toEqual({
      "104941268820871967559": "cautiosreboot0402@gmail.com",
    });
  });

  test("extracts the real ACL when a type-keyed decoy array precedes it (no short-circuit)", () => {
    // Regression for reviewer 3438249973: a decoy `"permissions"` array that DOES contain a
    // `type`-keyed object (so an `isAclCandidate`-style predicate would accept it) but is NOT a
    // real user ACL — e.g. a feature-flag list — placed BEFORE the real ACL. First-match-wins
    // would slice the decoy, find no user perms, return {}, and never reach the real ACL.
    // Merging every array's extraction means the decoy contributes nothing and the real email
    // still surfaces.
    const decoyWithType = esc(
      '{"config":{"permissions":[{"type":"feature","name":"beta"}]}}' +
        '{"permissions":[' +
        '{"deleted":false,"emailAddress":"cautiosreboot0402@gmail.com",' +
        '"type":"user","userId":"104941268820871967559"}' +
        "]}",
    );
    expect(parseDriveShareAcl(decoyWithType)).toEqual({
      "104941268820871967559": "cautiosreboot0402@gmail.com",
    });
  });

  test("returns {} when the only `permissions` array is unrelated (yields no user emails)", () => {
    const onlyDecoy = esc('{"config":{"permissions":[{"foo":true},{"bar":1}]}}');
    expect(parseDriveShareAcl(onlyDecoy)).toEqual({});
    // A type-keyed-but-non-user decoy alone also yields nothing.
    const onlyTypedDecoy = esc('{"config":{"permissions":[{"type":"feature","name":"beta"}]}}');
    expect(parseDriveShareAcl(onlyTypedDecoy)).toEqual({});
  });

  test("tolerates malformed/empty input without throwing", () => {
    expect(parseDriveShareAcl("")).toEqual({});
    expect(parseDriveShareAcl("no acl here")).toEqual({});
    // @ts-expect-error — exercises the runtime non-string guard
    expect(parseDriveShareAcl(null)).toEqual({});
  });
});

describe("attachCollaboratorEmails", () => {
  const identities = {
    tokA: { userId: "tokA", name: "RB Boot", email: null, color: "#673AB7" },
    tokB: { userId: "tokB", name: "Mr Torrint", email: null },
    self: { userId: "self", name: "Mofo Ker", email: "flylocious@gmail.com" },
  };
  const hovercardByToken = { tokA: "gaiaA", tokB: "gaiaB", self: "gaiaSelf" };

  test("fills the email when the join resolves, preserving name + colour", () => {
    expect(
      attachCollaboratorEmails(identities, hovercardByToken, {
        gaiaA: "cautiosreboot0402@gmail.com",
        gaiaSelf: "someoneelse@gmail.com",
      }),
    ).toEqual({
      tokA: {
        userId: "tokA",
        name: "RB Boot",
        email: "cautiosreboot0402@gmail.com",
        color: "#673AB7",
      },
      // No ACL entry for gaiaB → stays null.
      tokB: { userId: "tokB", name: "Mr Torrint", email: null },
      // A pre-existing (self) email is preserved, never overwritten by the ACL.
      self: { userId: "self", name: "Mofo Ker", email: "flylocious@gmail.com" },
    });
  });

  test("leaves email null when the token has no hovercard id to join on", () => {
    expect(
      attachCollaboratorEmails(
        { x: { userId: "x", name: "X", email: null } },
        {},
        { g: "e@x.com" },
      ),
    ).toEqual({ x: { userId: "x", name: "X", email: null } });
  });
});
