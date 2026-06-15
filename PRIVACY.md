<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# DocRewind Privacy Policy

**This document is the canonical privacy specification for DocRewind.** It
restates PRD §13 ("Privacy & Data Handling Specification") as the authoritative,
user-facing privacy policy. Other documents reference this file rather than
restating it.

DocRewind is a local-first browser extension. Its core design promise is simple:
**your document data never leaves your machine, and DocRewind talks to no server
other than Google's — on your behalf, using your own session.**

## The guarantees

1. **No remote backend.** DocRewind operates without any server owned or operated
   by its authors or maintainers.

2. **No data transmission to third parties.** DocRewind does **not** transmit
   document content, revision data, metadata, derived writing-process signals, or
   usage behavior to the authors, maintainers, or any analytics or third-party
   provider. The **only** network requests it makes are to Google Docs origins
   (`*://docs.google.com/*`), using your existing authenticated session, for the
   document you are currently viewing.

3. **No analytics or tracking.** DocRewind includes no analytics, no crash
   reporting, no third-party tracking, and no remote feature flags.

4. **No accounts.** DocRewind requires no account creation, sign-in, or
   registration of any kind.

5. **Browser-local persistence only.** All persisted data stays in your browser:
   document-derived data (raw revision chunks, decoded operations, reconstruction
   snapshots, timeline indexes) in **IndexedDB**, and lightweight settings in
   extension **`storage.local`**. DocRewind never uses `localStorage`, and
   settings use non-synced storage so preferences and document identifiers are
   **not** leaked through browser account sync.

6. **Minimal in-memory lifetime.** DocRewind minimizes how long sensitive data
   lives in memory where practical.

7. **No raw data in the UI or logs.** DocRewind sanitizes any display of data
   derived from document content and **never renders raw response bodies or
   document fragments** in errors, diagnostics, or logs.

8. **No remote code.** DocRewind uses no remote code execution and no remotely
   hosted application scripts. All JavaScript (and WASM, if any) ships inside the
   package, complying with browser-store content-security and remote-code
   policies.

9. **Minimal permissions.** DocRewind does not request host permissions beyond
   what Google Docs operation requires. The sole host permission is
   `*://docs.google.com/*`; it never requests `<all_urls>`. The only other
   permission is `storage`, used purely for the local persistence described above.

10. **Transparency.** This repository includes a clear privacy policy (this file),
    a [security policy and threat model](SECURITY.md), and the UI surfaces a
    plain-language privacy summary.

## What data DocRewind handles, and where it stays

| Data | Source | Where it lives | Leaves your machine? |
|------|--------|----------------|----------------------|
| Raw revision chunks | Google Docs `revisions/load` (your session) | IndexedDB (local) | **No** |
| Decoded operations, reconstruction snapshots, timeline | Computed locally from the above | IndexedDB (local) | **No** |
| Settings (theme, cache/diagnostics preferences) | You | `storage.local` (non-synced) | **No** |

DocRewind reads only revision data you are **already entitled to view**, using
**your own session** — there is no credential sharing and no access to other
users' private data.

## Activation is always explicit

DocRewind never loads or stores a document's revision history on page load. It
acts **only** after you explicitly activate it on a supported, open document
(PRD §9.2). You can clear cached data — for the current document or all of it —
from the options page at any time.

## Network isolation, verified

The "zero non-Google network requests" guarantee is enforced, not just asserted:

- a **runtime audit** in CI observes the exercised flow and fails on any request
  to a non-Google host (`e2e/network-isolation.spec.ts`); and
- a **static guard** rejects any non-Google network target named in the primary
  source directories (`scripts/check-no-foreign-hosts.sh`).

Both run in CI on every change (PRD §17).

## A note on Google's Terms of Service

DocRewind accesses revision data through Google Docs' internal, undocumented
endpoints. This is done strictly on a **self-access** basis — user-initiated, for
your own authorized documents, with no circumvention of access controls — but
programmatic use of internal endpoints may be in tension with Google's Terms of
Service even for an authorized user. This is documented openly as a known,
unresolved risk in PRD §21.5. It does not change any of the privacy guarantees
above.

## Changes to this policy

Because DocRewind has no backend and collects no data, this policy describes
behavior baked into the code. Any change to data handling is a change to the
source, reviewable in this repository's history and enforced by the CI audits
above.
