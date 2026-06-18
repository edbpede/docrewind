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
