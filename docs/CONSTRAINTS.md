# DocRewind — PRD Invariant Checklist

> A single linear checklist of the **non-negotiable invariants** that bind
> implementation, distilled from `docs/docrewind-prd.md` (Revision 5) prose into
> one referenceable place. The PRD is the authoritative source; each item cites
> its governing section. Violating any of these is a hard rejection, not a
> trade-off. Where this checklist and the PRD could diverge, **the PRD governs**.

## 1. Privacy (PRD §13 — canonical)

- **Zero non-Google network requests.** The only network requests are to Google
  Docs origins, using the user's existing session, for the current document. No
  remote backend.
- **No transmission** of document content, revision data, metadata, derived
  signals, or usage behavior to maintainers, analytics, or any third party.
- **No telemetry, no analytics, no crash reporting, no third-party tracking, no
  remote feature flags.**
- **No account creation.**
- **No remote code execution** or remotely hosted application scripts (complies
  with store CSP / remote-code policies).
- **Local-only persistence** (see §2). Minimize the lifetime of sensitive data in
  memory where practical.
- **Never render raw response bodies or document fragments** in UI or error views;
  sanitize any display derived from document content.

## 2. Storage tiering (PRD §9.8 / §10.6)

- **Bulk / structured data → IndexedDB via the `idb` wrapper**: raw revision
  chunks, decoded operations, reconstruction snapshots, operation/timeline
  indexes, per-document metadata, and **resumable-retrieval checkpoints**.
- **Small settings/preferences → WXT typed `storage.defineItem` over
  `storage.local`** (area-prefixed, versioned with migrations, **non-synced** to
  avoid leaking preferences/doc identifiers through browser sync — §14).
- **Ephemeral per-session cache → `storage.session`.**
- **Never `localStorage`** (synchronous; unavailable in service workers).
- **LRU pruning drops raw chunks first**, preserving decoded operations,
  snapshots, and timeline indexes. Honor the per-document (~50 MB) and global
  (~500 MB–1 GB) budgets; poll `navigator.storage.estimate()` to stay under ~80%
  of quota; call `navigator.storage.persist()`; handle `QuotaExceededError`.
- **Cache versioning keyed on parser version**: a parser upgrade marks decoded
  data stale while retaining raw when safe; if raw was discarded, flag for
  re-fetch. (OPFS is deferred — not part of the MVP storage path.)

## 3. Protocol isolation (PRD §19 "Compatibility Requirements" / §10.2 / Appendix A)

- **All Google Docs protocol assumptions live behind one dedicated module**
  (`lib/protocol/*`): endpoint URLs, request/auth shape, response framing, and
  operation schema. This is the single place to repair when Google changes
  internals. (The isolation mandate is stated in §19; §10.2 "Separation of
  Concerns" is the architectural rationale; §10.9 cross-references §19.)
- **Schema detection must fail safe** — never corrupt playback on an unrecognized
  shape (PRD §9.4).
- **Do not hard-code transport framing, headers, op-codes, or the discovery
  mechanism as live-current** (the `)]}'` prefix, `X-Same-Domain`/XSRF tokens,
  binary-search-on-HTTP-500, operation codes) **until the Phase 3.1 live capture
  confirms them** (PRD §24). Detect the multi-account `/u/{N}/` URL variant
  (Appendix A.5) or requests silently fail.

## 4. Permissions (PRD §12)

- **Host permission limited to `*://docs.google.com/*`** — the confirmed minimal
  footprint. **Never `<all_urls>`** or broader all-sites access.
- No persistent access to page content until the user activates on a supported
  document; plain-language permission explanations.
- Declare **"no remote code"** and a single-purpose statement for store review.
- Fallback only if a store rejects the standing host permission: `activeTab` /
  optional-permission granted on the open Docs tab at activation.

## 5. Surface & heavy-work architecture (PRD §10.3 / §10.9)

- **The dedicated replay tab is the PRIMARY surface** — its own browser tab, the
  long-lived host for parsing/reconstruction Web Workers (chosen over popup / side
  panel / injected panel).
- **Heavy work (decode/reconstruct/timeline) runs in a Web Worker owned by the
  replay page**, never in the ephemeral background.
- **Background is ephemeral** on both browsers (Chromium MV3 service worker /
  Firefox MV3 event page); holds no authoritative in-memory state; all `browser.*`
  calls inside the entrypoint callback, never module top level.
- **Retrieval is chunked and resumable**, checkpointing to IndexedDB so a
  terminated worker continues rather than restarts. The content script only
  detects + triggers (typed `@webext-core/messaging`); it does not own the fetch.
- **No auto-load** of revision history on page load — require explicit user
  activation (PRD §9.2).

## 6. Error taxonomy (PRD §10.7)

Errors are classified by **domain, not raw exception**. Each carries a user-facing
message, technical category, recoverability status, and suggested next action.
Categories: unsupported page; missing document identifier; insufficient document
permission; revision endpoint unavailable; unsupported revision format; network
failure; quota/storage failure; reconstruction failure; user cancellation. Raw
response bodies and document fragments are never shown in error views (ties §13.7).

## 7. Licensing & provenance (PRD §11.6)

- **License: AGPL-3.0-or-later** for all first-party source. A `LICENSE` file and
  **per-file `SPDX-License-Identifier: AGPL-3.0-or-later` headers** are required.
- **Contributions: DCO `Signed-off-by` sign-off** on commits; **no CLA**, no
  copyright assignment.
- **Dependencies must be AGPL-compatible**; audit licenses in CI and reject
  incompatible ones.
- **Prior-art provenance:** grammar ported from `harvard-vpal/gdocrevisions`
  (**MIT**) must **retain MIT attribution alongside the AGPL header** on derived
  files. `jsomers/draftback` and unlicensed gists are **study-for-facts-only** —
  confirm protocol facts, never reuse their code; never decompile the shipping
  Draftback extension.
