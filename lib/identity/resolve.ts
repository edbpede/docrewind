// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Identity resolution (PRD §9.7). The changelog's stable per-author token lives
// at tuple position [2] — a ~20-digit obfuscated Gaia account id (see decode.ts).
// By default it is shown as an opaque "Author N" label and NOTHING is resolved.
//
// When — and only when — the user opts in via the `realIdentities` setting, we
// map that token to a real display name using data ALREADY present on the open
// Docs page (the signed-in account label + the page's own `ogi`/`oui` id). This
// is deliberately a zero-network resolution: no per-id lookup, no People/Drive
// API, no rate-limit surface — the name rides in on the page the user already
// loaded. Obfuscated Gaia ids are not freely resolvable cookie-only, so this
// covers the dominant self-authored case (author == viewer); collaborators in a
// shared doc resolve through the same map when their ACL names are harvested.
//
// This module is PURE (string parsers only). The DOM read lives in the Docs
// content script and the cache/read in the replay page — both call these.

/** A resolved real-world identity for one opaque author token (Gaia id). */
export interface ResolvedIdentity {
  /** The changelog author token this identity belongs to (tuple position [2]). */
  readonly userId: string;
  /** Human display name (falls back to the email's local part if name is absent). */
  readonly name: string;
  /** Account email, or null when the page exposes only a name. */
  readonly email: string | null;
  /**
   * Google's assigned collaborator colour (a CSS hex string, e.g. `#673AB7`) when the
   * source carried one. Present only on the tiles/userMap path; absent on the self path
   * (the OneGoogle account label exposes no colour). UI accent only — never identifying.
   */
  readonly color?: string;
}

/** A gaia→identity cache, keyed by the opaque author token. */
export type IdentityMap = Readonly<Record<string, ResolvedIdentity>>;

const EMAIL_RE = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;

/** Escape regex metacharacters so a captured value can be matched literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a Google account-switcher label into a name + email. The OneGoogle bar
 * renders these as e.g. `"Google Account: Ada Lovelace\n(ada@example.com)"`; the
 * exact prefix is localized, so we key off structure (the parenthesised email and
 * the leading `…:` prefix) rather than the literal English words. Returns null
 * when the string carries no usable identity.
 */
export function parseAccountLabel(label: string): { name: string; email: string | null } | null {
  if (typeof label !== "string" || label.length === 0) {
    return null;
  }
  const email = label.match(EMAIL_RE)?.[0] ?? null;
  // Drop only the parenthesised group that holds the captured email, so legitimate
  // display names containing parentheses (e.g. an embedded role) survive. With no
  // email present we fall back to removing any parenthesised group.
  const dropParens =
    email !== null ? new RegExp(`\\(\\s*${escapeRegExp(email)}\\s*\\)`, "g") : /\([^)]*\)/g;
  let name = label
    .replace(dropParens, " ")
    .replace(/^[^:]*:/, " ") // drop a leading localized "Google Account:" prefix
    .replace(/\s+/g, " ")
    .trim();
  if (email !== null && name.includes(email)) {
    name = name.replace(email, "").replace(/\s+/g, " ").trim();
  }
  if (name.length > 0) {
    return { name, email };
  }
  if (email !== null) {
    // No display name on the page — fall back to the email's local part.
    return { name: email.split("@")[0] ?? email, email };
  }
  return null;
}

// The viewer's own obfuscated Gaia id is published in the Docs bootstrap as
// `'ogi':'<digits>'` / `'oui':'<digits>'` (single- or double-quoted, with optional
// whitespace). It equals the changelog author token for a self-authored doc.
const OWN_GAIA_RE = /['"]o(?:gi|ui)['"]\s*:\s*['"](\d{8,})['"]/;

/** Extract the viewer's own Gaia id (`ogi`/`oui`) from Docs page text, or null. */
export function parseOwnGaia(pageText: string): string | null {
  if (typeof pageText !== "string") {
    return null;
  }
  return pageText.match(OWN_GAIA_RE)?.[1] ?? null;
}

/**
 * Build the self identity from a (gaia, account-label) pair, or null when either
 * is missing/unparseable. Pure glue so the content script's DOM read stays a thin
 * adapter over testable logic.
 */
export function resolveSelfIdentity(
  ownGaia: string | null,
  accountLabel: string | null,
): ResolvedIdentity | null {
  if (ownGaia === null || accountLabel === null) {
    return null;
  }
  const parsed = parseAccountLabel(accountLabel);
  if (parsed === null) {
    return null;
  }
  return { userId: ownGaia, name: parsed.name, email: parsed.email };
}

// ── Collaborator resolution via the `revisions/tiles` userMap (PRD §9.7) ──────
//
// Reverse-engineered live 2026-06-18 (multi-author capture): the version-history
// feed `…/revisions/tiles` returns `)]}'`-framed JSON `{ tileInfo, userMap, firstRev }`.
// Its `userMap` keys are EXACTLY the changelog tuple `[2]` author tokens, so
// `userMap[userId].name` resolves a collaborator the self-path cannot (their Gaia
// id never appears in the page bootstrap). The feed carries name + colour + photo
// but NO email — only the viewer's own email is ever known (the self account
// label). This map is harvested in the background, ONLY when `realIdentities` is
// on, and merged into the same `resolvedIdentities` cache the replay surface reads.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A single `userMap` entry — only the fields we consume are typed; the feed carries more. */
function readUserMapName(entry: unknown): string | null {
  if (!isRecord(entry)) {
    return null;
  }
  // Skip anonymous viewers — they carry no real identity to surface.
  if (entry.anonymous === true) {
    return null;
  }
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  return name.length > 0 ? name : null;
}

/** Read a `userMap` entry's collaborator colour (a non-empty trimmed string), or null. */
function readUserMapColor(entry: unknown): string | null {
  if (!isRecord(entry)) {
    return null;
  }
  const color = typeof entry.color === "string" ? entry.color.trim() : "";
  return color.length > 0 ? color : null;
}

/**
 * Parse a deframed `revisions/tiles` payload into an {@link IdentityMap} keyed by
 * the opaque author token (Gaia id). Tolerant by construction (open-world, R-series):
 * a non-record payload, a missing/!record `userMap`, anonymous entries, and entries
 * without a usable name are all skipped — never a throw. Collaborators resolve to a
 * name (and the feed's colour when present); `email` is always null — the feed exposes
 * no address.
 */
export function parseUserMap(tilesPayload: unknown): IdentityMap {
  const userMap = isRecord(tilesPayload) ? tilesPayload.userMap : undefined;
  if (!isRecord(userMap)) {
    return {};
  }
  const out: Record<string, ResolvedIdentity> = {};
  for (const [userId, entry] of Object.entries(userMap)) {
    if (userId.length === 0) {
      continue;
    }
    const name = readUserMapName(entry);
    if (name === null) {
      continue;
    }
    const color = readUserMapColor(entry);
    out[userId] =
      color !== null ? { userId, name, email: null, color } : { userId, name, email: null };
  }
  return out;
}

/**
 * From a deframed `revisions/tiles` payload, return `{ authorToken → peopleHovercardId }`.
 * The `peopleHovercardId` is the collaborator's real Gaia id — the join key to the sharing
 * ACL (the changelog token at tuple `[2]` is a *different* obfuscated id, so this bridge is
 * what lets an ACL email be attached to a changelog author). Tolerant by construction
 * (open-world, R-series): a non-record payload, a missing/!record `userMap`, and entries
 * lacking a string `peopleHovercardId` are all skipped — never a throw.
 */
export function parseTilesHovercardIds(tilesPayload: unknown): Readonly<Record<string, string>> {
  const userMap = isRecord(tilesPayload) ? tilesPayload.userMap : undefined;
  if (!isRecord(userMap)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [token, entry] of Object.entries(userMap)) {
    if (token.length === 0 || !isRecord(entry)) {
      continue;
    }
    const hovercardId =
      typeof entry.peopleHovercardId === "string" ? entry.peopleHovercardId.trim() : "";
    if (hovercardId.length === 0) {
      continue;
    }
    out[token] = hovercardId;
  }
  return out;
}

// ── Collaborator EMAIL resolution via the `drivesharing/driveshare` ACL ───────
//
// Reverse-engineered live 2026-06-18: the same-origin, credentialed GET
// `docs.google.com/drivesharing/driveshare?…&command=init_share` returns ~78 KB of
// HTML with deeply-escaped embedded JSON carrying the full sharing ACL — but ONLY
// when the viewer can manage sharing (owner / editor-with-share); a reader gets a
// reduced/empty ACL. Each permission object (fields alphabetical) carries
// `emailAddress`, `type:"user"`, `deleted`, and `userId` (the real Gaia id). That
// `userId` === the tiles `peopleHovercardId`, so joining ACL→tiles→changelog token
// surfaces a collaborator's email on the same data Google already shows this viewer
// in its own Share dialog (no People/Drive API, no new scope). Tolerant + best-effort
// like the tiles path: a miss only costs the (optional) email row.

// One `type:"user"` permission object: capture its `emailAddress` then, without
// crossing into the NEXT permission's `emailAddress`, its adjacent `"type":"user","userId"`
// pair (alphabetical field order makes type+userId adjacent — see the live capture). The
// no-cross-emailAddress guard confines a match to a single object, so a group/domain entry
// (type !== "user") can never be mis-paired with a following user's id.
const ACL_USER_PERMISSION_RE =
  /"emailAddress":"([^"]+)"(?:(?!"emailAddress")[\s\S]){0,2000}?"type":"user","userId":"(\d+)"/g;

/**
 * Parse `drivesharing/driveshare` HTML into `{ gaiaUserId → email }` for active user
 * permissions. The blob is deeply escaped, so we first un-escape `\"`→`"`. Entries that
 * are not `type:"user"` (groups/domains) never match the pair regex; entries flagged
 * `"deleted":true` are skipped via a short look-back (the field sits just before
 * `emailAddress` in the alphabetical object). Non-string / no-match input → `{}`; never
 * throws.
 */
export function parseDriveShareAcl(html: string): Readonly<Record<string, string>> {
  if (typeof html !== "string" || html.length === 0) {
    return {};
  }
  const unescaped = html.replace(/\\"/g, '"');
  const out: Record<string, string> = {};
  ACL_USER_PERMISSION_RE.lastIndex = 0;
  for (
    let match = ACL_USER_PERMISSION_RE.exec(unescaped);
    match !== null;
    match = ACL_USER_PERMISSION_RE.exec(unescaped)
  ) {
    const email = match[1];
    const userId = match[2];
    if (email === undefined || userId === undefined) {
      continue;
    }
    // `"deleted":true` precedes `emailAddress` (deleted < domain < emailAddress); a
    // bounded look-back stays inside this object (the large `capabilities` block sits
    // before `deleted`, so it can't reach a previous permission's flag).
    const preceding = unescaped.slice(Math.max(0, match.index - 400), match.index);
    if (/"deleted":true/.test(preceding)) {
      continue;
    }
    out[userId] = email;
  }
  return out;
}

/**
 * Attach collaborator emails to an {@link IdentityMap} by joining through the tiles
 * hovercard ids: for each token, look up its `peopleHovercardId`, then the ACL email for
 * that Gaia id. The email is filled ONLY when both lookups succeed AND the entry's email
 * is currently `null` — so the self-path email (resolved from the account label) is never
 * overwritten. Returns a new map; pure join, no I/O.
 */
export function attachCollaboratorEmails(
  identities: IdentityMap,
  hovercardByToken: Readonly<Record<string, string>>,
  emailByGaia: Readonly<Record<string, string>>,
): IdentityMap {
  const out: Record<string, ResolvedIdentity> = {};
  for (const [token, identity] of Object.entries(identities)) {
    const gaiaId = hovercardByToken[token];
    const email = gaiaId !== undefined ? emailByGaia[gaiaId] : undefined;
    out[token] = identity.email === null && email !== undefined ? { ...identity, email } : identity;
  }
  return out;
}

// The editor bootstrap publishes the per-session revisions/tiles credentials inside
// an `"info_params":{ "token":"…:<ms>", "ouid":"<digits>" }` block. The token is
// short-lived (it embeds a millisecond timestamp) so it must be read fresh per
// request. The SERVER-rendered `/edit` HTML uses double-quoted JSON here (the live
// post-script DOM uses a single-quoted mirror); we key off the JSON form the
// background actually fetches.
const TILES_TOKEN_RE = /"info_params":\{[^}]*?"token":"([^"]+:\d{6,})"/;
const TILES_TOKEN_FALLBACK_RE = /"token":"([^"]+:\d{6,})"/;
const TILES_OUID_RE = /"ouid":"(\d{8,})"/;

/** Credentials the `revisions/tiles` request requires beyond the doc id. */
export interface TilesParams {
  readonly token: string;
  readonly ouid: string;
}

/**
 * Extract the `revisions/tiles` `token` + `ouid` from edit-page HTML, or null when
 * either is absent. Pure so the background's network adapter stays a thin shell over
 * a tested regex. The token shape (`<opaque>:<ms-timestamp>`) is required in the match
 * so an unrelated `"token"` field can't be mistaken for the tiles credential.
 */
export function parseTilesParams(html: string): TilesParams | null {
  if (typeof html !== "string") {
    return null;
  }
  const token = (html.match(TILES_TOKEN_RE) ?? html.match(TILES_TOKEN_FALLBACK_RE))?.[1] ?? null;
  const ouid = html.match(TILES_OUID_RE)?.[1] ?? null;
  return token !== null && ouid !== null ? { token, ouid } : null;
}

/**
 * Merge harvested identities into an existing cache. `incoming` names win (the tiles
 * feed is the single consistent source across all collaborators), but an existing
 * `email` is preserved when the incoming entry has none — so a later name-only tiles
 * harvest never erases the email the self-path resolved for the viewer. `color` is
 * carried the same way (incoming wins, else the existing colour survives), so the
 * self-path's later name-only refresh never drops a colour the tiles harvest found.
 */
export function mergeIdentities(base: IdentityMap, incoming: IdentityMap): IdentityMap {
  const out: Record<string, ResolvedIdentity> = { ...base };
  for (const [userId, next] of Object.entries(incoming)) {
    const existing = out[userId];
    const email = next.email ?? existing?.email ?? null;
    const color = next.color ?? existing?.color;
    out[userId] =
      color !== undefined
        ? { userId, name: next.name, email, color }
        : { userId, name: next.name, email };
  }
  return out;
}

/**
 * Fold the viewer's own resolved identity into the cache, returning the map to persist
 * or `null` when nothing should change (so the caller can skip a redundant write).
 *
 * The version-history `userMap` is authoritative for name + colour, so an already-cached
 * token is never renamed — but that feed carries NO email, and the viewer's own address
 * is knowable only via the self-path. So: an unresolved token is added in full; an
 * already-resolved token that lacks an email is ENRICHED with the viewer's email in place
 * (its name + colour preserved); an entry that already has an email — or a self identity
 * that carries none — is left untouched. This is what lets the viewer's own contributor
 * card show their address even when the tiles harvest populated the entry first.
 */
export function withSelfIdentity(current: IdentityMap, self: ResolvedIdentity): IdentityMap | null {
  const existing = current[self.userId];
  if (existing === undefined) {
    return mergeIdentities(current, { [self.userId]: self });
  }
  if (existing.email === null && self.email !== null) {
    return mergeIdentities(current, { [self.userId]: { ...existing, email: self.email } });
  }
  return null;
}
