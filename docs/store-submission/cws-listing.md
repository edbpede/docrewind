<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Chrome Web Store listing & review notes (DocRewind)

Planning artifact for the Chrome Web Store (CWS) submission. Prepared in Phase 7;
actual submission is PRD §16 Phase 4 / post-MVP. Everything here is written to be
accurate to the **shipped bytes** (`scripts/verify-manifest.sh` audits the same
properties on the built zip).

## Single-purpose statement

> DocRewind has one purpose: to let a user replay the local revision history of a
> Google Doc they can already open. It reconstructs the document's edit timeline
> entirely on the user's own machine and plays it back. It does nothing else.

There is no second feature, no account, no analytics, no background data
collection — the single purpose is local revision replay for `docs.google.com`.

## Permissions justification

| Permission | Value | Why it is required (and minimal) |
|------------|-------|----------------------------------|
| `storage` | — | Persist user settings and cache decoded revision data **locally** (`storage.local` + IndexedDB). No remote storage. |
| `host_permissions` | `*://docs.google.com/*` | DocRewind only ever talks to Google Docs — to read the revision data of a doc the user already has open. This is the **sole** host; there is no `<all_urls>` and no other origin. |

There are **no** other permissions. No `tabs`, no `scripting` beyond the declared
content script, no `webRequest`, no `cookies`.

## "No remote code" declaration

DocRewind contains **no remotely hosted code**. All JavaScript and WASM (if any)
ships inside the package. The build:

- uses minification (esbuild via Vite) **with sources retained** — minified, not
  obfuscated (PRD §11.4; verified by `scripts/verify-manifest.sh` against
  `wxt.config.ts` + the `-sources.zip`);
- declares no `content_security_policy` that whitelists a remote origin, no
  `externally_connectable`, and no `update_url` pointing at third-party code;
- makes network requests to **`docs.google.com` only** — enforced at runtime
  (`e2e/network-isolation.spec.ts`) and statically
  (`scripts/check-no-foreign-hosts.sh`).

## Data use

DocRewind collects and transmits **no user data**. All processing is local. The
revision data it reads never leaves the user's machine. This maps to the CWS data
disclosure as: no data collected, no data sold, no data transferred.

## Host-permission contingency (NOT yet implemented)

The standing `*://docs.google.com/*` host permission is the cleanest UX (no
per-use prompt). **If a future CWS review rejects a standing host permission**, the
planned fallback is to switch to an `activeTab` + optional-host-permission model,
requesting `docs.google.com` access on user gesture instead of at install. This
fallback is **described as contingency only — it is not implemented today** (PRD
§12); adopting it would be a deliberate manifest change, re-audited by
`scripts/verify-manifest.sh`, not a silent toggle.

## Listing copy (draft)

- **Name:** DocRewind
- **Short description:** Replay the revision history of your Google Docs, locally.
- **Category:** Productivity
- **Long description:** DocRewind reconstructs and replays the edit timeline of a
  Google Doc you can open — entirely on your own machine. Scrub through how a
  document was written, revision by revision. Local-first and open source
  (AGPL-3.0): no account, no analytics, no data leaves your browser.
