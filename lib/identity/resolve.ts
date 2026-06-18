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

// The ACL is embedded in a ~78 KB HTML document (module header) with markup and other JSON
// before AND after it, so we cannot match it with a single greedy/lazy regex: greedy
// `[\s\S]*` over-captures to the last `]}` in the whole document, while lazy `[\s\S]*?`
// stops at the FIRST `]}` and truncates if any permission carries a nested array. Instead we
// anchor on the permissions array opener with a whitespace-tolerant regex, then walk the
// `[…]` forward tracking bracket depth — ignoring structural characters inside JSON string
// literals — to slice exactly that array and parse it directly. Parsing the array (not its
// enclosing object) means we depend on neither `permissions` being the first key nor compact
// serialization: a leading `{"kind":…,"permissions":[` or pretty-printed `{ "permissions" : [`
// both resolve, where the old literal `{"permissions":[` marker silently missed them.
//
// We scan ALL `"permissions":[` matches in document order (not just the first) and use the
// first that parses to a valid ACL array, because an unrelated earlier `"permissions"` array
// (app config / capability list) in the same blob would otherwise shadow the real ACL and drop
// every email. Narrowing the anchor to the wrapper instead (e.g. `{"permissions":[`) was
// rejected: it reintroduces a first-key + compact-serialization dependency. The `g` flag is
// kept on a local clone of the regex per call so its `lastIndex` state is never shared.
const ACL_ARRAY_ANCHOR_RE = /"permissions"\s*:\s*\[/g;

/**
 * Does a parsed array look like a sharing ACL? Real ACL entries (user/group/domain/anyone) each
 * carry a string `type`; unrelated config/numeric arrays do not. We require ≥1 such entry — loose
 * enough to accept an ACL that legitimately holds only group/domain/deleted entries (it then
 * yields no emails), tight enough to skip a shadowing array of numbers or plain objects.
 */
function isAclCandidate(arr: readonly unknown[]): boolean {
  return arr.some((el) => isRecord(el) && typeof el.type === "string");
}

/**
 * Return the substring of `text` spanning the balanced `open`/`close` pair that begins at
 * `start` (which must index an opening `open` char), walking forward until depth returns to
 * zero. String literals are skipped wholesale (including their escaped quotes), so brackets/
 * braces that appear inside an `emailAddress`, display name, URL, etc. never miscount. Returns
 * null when the span never closes (truncated input). Used for both `{…}` objects and `[…]`
 * arrays — pass the matching pair.
 */
function balancedSpan(text: string, start: number, open: string, close: string): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++; // skip the escaped character (e.g. `\"`, `\\`) — it can't close the string
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/** A single ACL permission object — only the fields we consume are typed; the feed carries more. */
interface AclPermission {
  readonly type?: unknown;
  readonly deleted?: unknown;
  readonly emailAddress?: unknown;
  readonly userId?: unknown;
}

/** Reduce a parsed ACL array to `{ gaiaUserId → email }` for active user permissions. */
function extractAclEmails(permissions: readonly unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const perm of permissions as readonly AclPermission[]) {
    if (!isRecord(perm)) {
      continue;
    }
    // Skip deleted perms and non-user (group/domain) entries; require an email and a
    // digit-only Gaia id (the real userId is always numeric; guard against anything else).
    if (perm.deleted === true || perm.type !== "user") {
      continue;
    }
    const { emailAddress, userId } = perm;
    if (typeof emailAddress === "string" && typeof userId === "string" && /^\d+$/.test(userId)) {
      out[userId] = emailAddress;
    }
  }
  return out;
}

/**
 * Parse `drivesharing/driveshare` HTML into `{ gaiaUserId → email }` for active user
 * permissions. The blob is deeply escaped, so we first un-escape `\"`→`"`, then scan EVERY
 * `"permissions":[` array opener (whitespace-tolerant anchor) in document order: for each we
 * slice exactly that `[…]` array via a string-literal-aware balanced-bracket walk and
 * `JSON.parse` it directly — reading each permission's fields structurally rather than with
 * field-order-dependent regex windows, and depending on neither the array being the enclosing
 * object's first key nor compact serialization. The first array that parses to a valid ACL
 * (see {@link isAclCandidate}) wins, so an unrelated earlier `"permissions"` array can't shadow
 * the real one. We keep an entry only when it is `type:"user"`, not `deleted`, and carries both
 * an `emailAddress` and a digit-only `userId`. Non-string / no-match / malformed input → `{}`;
 * never throws (every parse is wrapped).
 */
export function parseDriveShareAcl(html: string): Readonly<Record<string, string>> {
  if (typeof html !== "string" || html.length === 0) {
    return {};
  }
  const unescaped = html.replace(/\\"/g, '"');
  // Local global regex so its `lastIndex` state is per-call, never shared across invocations.
  const anchor = new RegExp(ACL_ARRAY_ANCHOR_RE.source, "g");
  let match: RegExpExecArray | null = anchor.exec(unescaped);
  while (match !== null) {
    // The match ends on the opening `[`; slice the balanced array from there.
    const arrayStart = match.index + match[0].length - 1;
    const blob = balancedSpan(unescaped, arrayStart, "[", "]");
    if (blob !== null) {
      let permissions: unknown;
      try {
        permissions = JSON.parse(blob);
      } catch {
        // Malformed slice — skip this candidate and keep scanning; never throw (a miss only
        // costs the optional email row, see module header).
        permissions = undefined;
      }
      if (Array.isArray(permissions) && isAclCandidate(permissions)) {
        return extractAclEmails(permissions);
      }
    }
    match = anchor.exec(unescaped);
  }
  return {};
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
