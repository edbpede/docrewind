# Product Requirements Document: DocRewind — Local-First Google Docs Revision Replay Extension

**Working name:** DocRewind (repository / package slug: `docrewind`)
**License:** AGPL-3.0-or-later
**Status:** Revision 5 — Phase 0 research (two rounds) complete; verdict **Conditional-Go**, pending live network capture
**Revision note:** Revision 3 folded in Round 1 research; Revision 4 folded in Round 2 (operation grammar source-confirmed; stack settled). Revision 5 aligns the technical stack to the project coding guidelines in `.augment/rules/bun-solid-pro.md`, which is the **authoritative reference** for stack versions, project layout, and framework idioms. That alignment: (a) **keeps `presetWind4`** (reversing Revision 4's interim downgrade to `presetWind3` — the guidelines pin presetWind4 and the incompatibility that prompted the downgrade only affects legacy-Tailwind migrations, which do not apply to a greenfield codebase); (b) adopts WXT's **polyfill-free `browser` global** (no `webextension-polyfill` wrapper); (c) makes **`idb`-backed IndexedDB the single bulk-storage engine**, demoting OPFS to a deferred, profile-driven optimization; (d) splits testing into **Bun (pure logic) + Vitest (Solid/storage/browser-API) + Playwright (Chromium-only E2E)**, with Firefox validated manually / via `web-ext`; and (e) adds **Biome** for lint+format. The hard unknowns remain transport-layer and are routed to live capture (§24). See the Decision Log below.

---

## 0. Decision Log (through Revision 5)

These were previously open or underspecified. Each is now a committed decision; rationale lives in the referenced section. **Authoritative stack reference:** all framework, tooling, layout, and idiom choices defer to `.augment/rules/bun-solid-pro.md`; where this PRD and that document could differ, the guidelines govern, and §11 records the reconciliation.

1. **License:** AGPL-3.0-or-later, DCO sign-off for contributors (no CLA). → §11.6
2. **Primary extension surface:** dedicated replay page in its own browser tab, opened from the toolbar action. → §10.3, §8.4
3. **Raw payload retention:** retained by default after parsing, bounded by a storage budget with LRU pruning that drops raw chunks before derived data; user-configurable. → §9.8, §10.6
4. **MVP reconstruction fidelity:** faithful linear-text reconstruction (insert/delete order + timing + paragraph structure); end-of-replay text equals current document text; non-text structures degrade to placeholders, never crash. → §9.4, §15.3
5. **Collaborative attribution:** pseudonymous color+label authors by default; real identities only on explicit opt-in. → §9.7, §9.11
6. **Diagnostics redaction:** anonymized-by-construction (no document text) by default; structural/length-only operation mode for parser bugs; interactive redaction UI deferred. → §10.8
7. **Non-text structures:** suggestions/tracked-changes are inline character-stream operations (`iss`/`dss`/`msfd`/`usfd`) and are therefore best-effort *reconstructable* in MVP; comments (out-of-band) and images/tables/footnotes/equations/drawings/list-formatting (outside the plain character stream) degrade to typed placeholders / timeline annotations, never crash. → §9.4, §9.6, §15.3
8. **Background context model:** ephemeral on both browsers (MV3 service worker on Chromium — terminating after ~30s idle / 5min hard cap; MV3 event page on Firefox); no authoritative in-memory state. The credentialed, chunked, **resumable** retrieval runs in the background context, checkpointed to IndexedDB so a terminated worker resumes; heavy parsing/reconstruction runs in a Web Worker owned by the replay page. The content script only detects and triggers, via WXT's promise-based `browser` global (no `webextension-polyfill`). → §10.3, §10.9
9. **Build claim:** "verifiable, pinned builds with published checksums," not byte-for-byte reproducibility (the latter is a stretch goal via a pinned container). → §11.4
10. **Quantified success metrics:** concrete MVP targets for fidelity, load time, responsiveness, coverage, and network isolation. → §17
11. **ToS/legal position:** documented known risk with mitigations and a distribution fallback; requires project legal review before public launch. → §21.5
12. **Name:** DocRewind (subtitle: "Local revision replay for Google Docs"). → §26
13. **Extension framework:** WXT (Vite-based, framework-agnostic with a first-class SolidJS template, per-browser MV3 outputs, polyfill-free `browser`, generated manifest), per `.augment/rules/bun-solid-pro.md`. Plasmo (maintenance mode) and CRXJS (build-only/abandonment risk) rejected. → §11.4
14. **Styling preset:** UnoCSS **`presetWind4`** (the current Tailwind-4-compatible preset, per the guidelines), with its integrated reset. The oklch/`presetLegacyCompat` incompatibility noted in earlier research applies only to legacy-Tailwind migration, which does not apply here; an early-build watch-item verifies `@apply`/color behavior against the component set. → §11.3
15. **Storage engines:** a single bulk engine — **IndexedDB accessed via `idb`** — for raw revision chunks, decoded operations, snapshots, indexes, and resumable-retrieval checkpoints; WXT typed `storage.defineItem` over `storage.local` for settings; `storage.session` for ephemeral per-session cache. OPFS is **deferred** as a profile-driven optimization for the heaviest documents only (typical docs are a few MB; heavy ones tens of MB — within comfortable IndexedDB range). Default ~50 MB/document budget; global LRU cap ~500 MB–1 GB; call `navigator.storage.persist()`; handle `QuotaExceededError`. → §9.8, §10.6
16. **Firefox target:** Firefox ≥127 for install-time host-permission grant; older Firefox gets a clear first-run prompt to enable access on `docs.google.com`. → §9.10, §12
17. **Permission fallback:** if a store rejects the `*://docs.google.com/*` host permission, fall back to `activeTab` / optional permission granted on the open Docs tab. → §12, §23
18. **Browser-API access:** WXT's unified promise-based `browser` global throughout (typed from `@types/chrome`); never `webextension-polyfill` or `chrome.*` callbacks. Typed cross-context messaging via `@webext-core/messaging`. → §9.10, §10.9, §11.4
19. **Testing split:** Bun's test runner for pure, DOM-free logic (parser, reconstruction, timeline); Vitest with `WxtVitest`, `@solidjs/testing-library`, and the in-memory `fakeBrowser` for Solid components, storage, and browser-API behavior; Playwright for end-to-end — **Chromium-only**, so Firefox is validated by manual exploratory testing and `web-ext` smoke checks. → §11.5
20. **Lint/format:** Biome (single tool, replacing ESLint+Prettier), relying on Biome's recommended + type-aware rules plus Solid's compile-time reactivity warnings. → §11.4

The two prior research rounds are complete (verdict: **Conditional-Go**) and the build stack is now aligned to `.augment/rules/bun-solid-pro.md`, leaving only transport-layer unknowns (response framing, required headers/tokens, revision-count discovery, non-text encoding, chunk sizes, rate limits). These cannot be resolved from public sources and are routed to a focused live-capture pass (Phase 0, §16, §24). Do not hard-code the parser to assumptions about the `)]}'` prefix, headers, or discovery method until that capture passes.

---

## 1. Product Summary

DocRewind is a free/libre and open-source browser extension that lets users replay, inspect, and analyze the revision history of Google Docs documents they are authorized to access. It is inspired by Draftback's core user value: transforming Google Docs' fine-grained revision data into an interactive writing-playback experience.

The extension is privacy-first, local-only, cross-browser, and transparent. It works on Chromium-based browsers and Firefox. It does not require user accounts, remote servers, telemetry, analytics, subscriptions, or cloud processing.

The product is built with SolidJS (fine-grained reactivity, no virtual DOM), TypeScript (strict), UnoCSS `presetWind4`, and the WXT extension framework (Vite under the hood) producing Chromium and Firefox builds, with Biome for lint+format. Bun is the package manager, script runner, and runner for pure-logic unit tests; the extension runtime depends only on standard browser and WebExtension APIs. The authoritative reference for stack versions, project layout, and framework idioms is `.augment/rules/bun-solid-pro.md` (see §11).

## 2. Product Vision

Writers, teachers, researchers, editors, and students should be able to understand how a Google Doc was written without surrendering document content to a third party.

The extension makes document evolution visible: when text appeared, how writing sessions unfolded, where large pasted sections entered, and how the document changed over time — while keeping all document data inside the user's browser.

The long-term vision is a trustworthy, local writing-process microscope for Google Docs.

## 3. Problem Statement

Google Docs stores detailed revision information to support collaboration and history, but the native interface does not offer a rich replay of the writing process. Existing tools show such replay is possible, but users may want a transparent, auditable, FLOSS alternative that does not rely on remote infrastructure or opaque data handling.

Users need to inspect document authorship and writing process while preserving privacy, respecting browser permissions, and avoiding unnecessary data extraction.

## 4. Target Users

### 4.1 Primary Users
- Teachers and academic staff reviewing writing-process evidence in student-submitted Google Docs.
- Writers and editors understanding the evolution of their own drafts.
- Researchers studying writing process, revision behavior, or collaborative composition.
- Privacy-conscious users who want local-only document tooling.

### 4.2 Secondary Users
- Open-source contributors who want to audit or improve the extension.
- Institutions wanting a self-contained extension without vendor lock-in.
- Developers experimenting with document reconstruction and playback.

## 5. Goals
- Provide a local replay experience for Google Docs revision history.
- Support Chromium-compatible browsers and Firefox from MVP, with Firefox validated by real browser testing.
- Keep all parsed content, revision history, derived events, and caches local to the browser.
- Avoid all telemetry, analytics, remote licensing, cloud processing, or third-party document transmission.
- Use a modern, type-safe SolidJS + TypeScript frontend.
- Ship a transparent AGPL-3.0-or-later codebase with clear privacy guarantees and verifiable builds.
- Handle large documents via chunked loading, incremental parsing, cache management, and efficient rendering.
- Make technical limitations explicit, especially reliance on undocumented Google Docs revision behavior.

## 6. Non-Goals
- No AI-writing detection or claims about AI-generated text.
- No bypassing Google Docs permissions or accessing documents unavailable to the current user.
- No server-side storage of document data.
- No cross-device synchronization of history.
- No attempt to support every Google Workspace editor in MVP.
- Not a replacement for Google Docs revision history.
- No guarantee of compatibility with future Google Docs internal changes.
- Not a standalone web service.

## 7. Product Positioning

DocRewind is a local, auditable revision-replay tool for documents the user already has permission to access. It avoids adversarial or surveillance-oriented messaging.

Recommended positioning: "Replay how a Google Doc changed over time, locally in your browser."

Avoid "catch cheaters," "detect AI," or "prove authorship." The extension may surface process signals, but interpretation remains the user's responsibility.

## 8. Core User Experience

### 8.1 First Install
The user installs from a browser extension store or a verified release package. Onboarding explains that the extension activates only on Google Docs pages and stores data locally. The user sees a plain privacy summary: no accounts, no telemetry, no remote backend, no document upload, local cache only. (Canonical guarantees: §13.)

### 8.2 Activation on a Google Doc
When the user opens a supported document, the content script detects the editing/viewing context and presents an unobtrusive entry point (toolbar action; optional small in-page affordance). The extension does **not** load revision history until the user explicitly activates replay.

### 8.3 Revision Loading
After activation, the extension identifies the current document and retrieves revision data available to the current session. It shows high-level progress: discovering revision range, loading revisions, reconstructing states, preparing playback. Meaningful failure states are shown for unsupported, inaccessible, too-large, or format-changed documents (error model: §10.7).

### 8.4 Replay View
Replay opens in a **dedicated extension page in its own browser tab** (primary surface; rationale §10.3). It provides a document viewport, timeline, play/pause, speed control, and navigation to key events. It emphasizes writing flow over raw technical data and communicates that it is a reconstruction from available revision data.

### 8.5 Local Cache Management
The extension caches parsed revision data locally to avoid repeated loading. Users can clear the cache for the current document or all documents. The cache UI discloses approximate storage usage (§9.8, §10.6).

### 8.6 Export and Sharing
MVP may include local-only exports of summary/timeline metadata, generated entirely in-browser, with a clear statement of what is included. Video export, animated replay export, and shareable reports are deferred until the core replay engine is stable.

## 9. Functional Requirements

### 9.1 Document Detection
- Detect when the active tab is a supported Google Docs document.
- Extract the document identifier from page context in a browser-safe way.
- Distinguish unsupported Google Workspace pages from supported document pages.
- Degrade gracefully if Google Docs changes URL structure or page behavior.

### 9.2 User-Initiated Loading
- Never retrieve revision history automatically on page load.
- Require explicit user activation before retrieval.
- Show the current document title when available, avoiding unnecessary metadata extraction.

### 9.3 Revision Retrieval
- Retrieve revision data using the authenticated browser session of the current user.
- Request data only from Google Docs origins necessary for current-document replay.
- Handle revision data in chunks, not as a single complete payload.
- Support retry, partial progress, and cancellation.
- Detect and report common failures: insufficient permission, unavailable revision data, network interruption, unsupported response format, document too large.
- Retrieve the fine-grained changelog from the internal `revisions/load` endpoint (Appendix A.1) via a first-party credentialed request from the `docs.google.com` context; the public Drive/Docs APIs do not expose keystroke-level history and are not a usable source (Appendix A.6).
- Discover the available revision range via the binary-search bound-finding technique (treating HTTP 500 as "range too high"), seeded where possible by the document-info blob in the editor page (Appendix A.4).
- Handle the multi-account URL variant (`/document/u/{N}/d/...`) — the documented historical cause of third-party-tool breakage (Appendix A.5).

### 9.4 Revision Decoding and Reconstruction
- Transform retrieved payloads into an internal typed representation.
- Reconstruct document states over time by applying operations in order, against a flat character-array model (insert splices at the insert index; delete pops the range; compound "multi" operations recurse over their sub-operations), per Appendix A.2.
- Preserve enough timing and ordering to support playback (each revision carries user, session, revision id, and timestamp; characters carry insert/delete revision and a suggestion flag — Appendix A.2).
- Tolerate partially unknown operation types by isolating unsupported operations and continuing when safe.
- **Suggestions / tracked changes** are inline character-stream operations (`iss`/`dss`/`msfd`/`usfd`) and are reconstructed best-effort (shown distinctly from accepted text).
- **Other non-text structures** — comments (out-of-band) and images, tables, footnotes, equations, drawings, and list formatting (which ride outside the plain character stream) — are decoded as typed opaque placeholders that preserve position and timing and must never abort reconstruction. (Rendering: §9.6; fidelity bar: §15.3.)
- Decode against the source-confirmed operation grammar in Appendix A.2, strip Google's `)]}'` anti-hijacking guard before parsing (Appendix A.3), and treat the *transport* details (framing, headers, discovery) as **provisional** until confirmed by live capture (§24). The grammar is confirmed from open MIT source; the 2026 wire format is not, so include schema-version detection that fails safe rather than corrupting playback.
- Avoid corrupting cached data when reconstruction fails.
- Include an opt-in diagnostics mode for reporting unsupported formats without uploading document content by default (§10.8).

### 9.5 Timeline Generation
- Derive a replay timeline from decoded revisions.
- Represent writing activity, pauses, large insertions, deletions, and major structural changes.
- Support multiple playback speeds.
- Allow jumping to a timestamp, revision cluster, or notable event.
- Expose uncertainty where event grouping is inferred rather than directly available.

### 9.6 Playback Interface
- Include play, pause, restart, speed selection, scrubber navigation, and progress display.
- Show the reconstructed document state at the selected point in time.
- Support large documents via virtualized or incremental rendering where needed.
- Prioritize readability and responsiveness over pixel-perfect imitation of Google Docs.
- Render suggestions/tracked changes inline but visually distinct from accepted text; render comments as timeline annotations and other non-text structures (images, tables, footnotes, equations, drawings) as labeled inline placeholders rather than merging them into the main text stream (MVP).
- Communicate clearly that the view is a reconstruction.

### 9.7 Summary Insights
- Provide local summary insights: total replay duration, number of revision events, major writing sessions, large inserted blocks, large deletions, and inactivity periods.
- Where author attribution is available, present per-event authors as pseudonymous, color-coded labels (Author 1, Author 2…) by default. Real names/emails are shown only on explicit user opt-in, and always labeled as "attributed by revision data, may be incomplete."
- Insights are process signals, not conclusions. No judgments about authorship, intent, plagiarism, or AI generation.

### 9.8 Local Storage
- Use local browser storage only, under the extension's own origin (`chrome-extension://` / `moz-extension://`), which is largely exempt from the web-origin LRU eviction that affects ordinary sites. Still call `navigator.storage.persist()` and handle `QuotaExceededError`.
- **Storage engines (per `.augment/rules/bun-solid-pro.md`):** all bulk and structured data — raw revision chunks, decoded operations, reconstruction snapshots, operation/timeline indexes, and resumable-retrieval checkpoints — lives in **IndexedDB accessed through the `idb` wrapper** (which works in the background, the replay page, and Workers alike). Lightweight settings/preferences use WXT's typed `storage.defineItem` over `storage.local` (area-prefixed, versioned with migrations, non-synced); ephemeral per-session cache uses `storage.session`. `localStorage` is never used (unavailable in service workers).
- **OPFS is deferred:** the Origin Private File System (Worker-only sync access, materially faster for very large sequential blob writes) is a profile-driven optimization reserved for the heaviest documents, adopted only if IndexedDB write throughput proves a bottleneck in practice. It is not part of the MVP storage path.
- Provide a clear cache-deletion interface.
- Apply cache versioning so parser upgrades can invalidate stale data safely.
- **Raw payload retention:** retain raw revision chunks by default after parsing so parser upgrades can re-decode locally without re-fetching (re-fetching is the most fragile, ToS-sensitive operation). Retention is bounded by a storage budget — default **~50 MB per document**, with a global LRU cap of **~500 MB–1 GB**, evicting whole-document caches least-recently-viewed first and polling `navigator.storage.estimate()` to stay under ~80% of reported quota. When over budget, pruning removes raw chunks **first**, preserving decoded operations, snapshots, and timeline indexes (expensive to recompute, equally sensitive). A setting — "Keep raw revision data for faster re-parsing (uses more storage)," default ON — lets users discard raw after successful reconstruction.
- Sizing reference: a ~10,000-word / ~500-revision document occupies a few MB of raw JSON; a ~10,000-revision document occupies tens of MB — comfortably within IndexedDB's per-origin quota, so the per-document budget rarely binds for typical documents.
- Per-document cache metadata: document identifier, cache creation time, last accessed time, parser version, estimated storage size, reconstruction status, and whether raw payloads are retained.

### 9.9 Privacy Controls
All privacy controls implement the canonical specification in §13. Summary: no transmission of document content, revision data, metadata, or usage to any non-Google server; no analytics, crash reporting, third-party tracking, or remote feature flags; no account creation; no host permissions beyond what Google Docs operation requires; clear in-UI and in-repo privacy documentation.

### 9.10 Cross-Browser Support
- Support Chromium-based browsers and Firefox from a shared codebase.
- Use WXT's unified, promise-based `browser` global (auto-imported, polyfill-free, typed from `@types/chrome`) to smooth Chromium/Firefox differences; never import `webextension-polyfill` or use `chrome.*` callback APIs. Feature-detect APIs that do not exist everywhere (e.g., side panel) rather than assuming presence.
- Author the manifest in MV3 form in `wxt.config.ts` and let WXT generate per-browser manifests; target **Firefox MV3 (event page)** to keep a single ephemeral-background mental model. Firefox MV2 (persistent background) is a sanctioned fallback if MV3 event-page issues arise — its persistent background would, if anything, simplify long-fetch resumability.
- Provide separate browser build targets and packaging outputs.
- Validate Firefox with real browser testing, not assumed from Chromium behavior. Note that automated end-to-end testing (Playwright) is **Chromium-only**; Firefox validation is therefore manual exploratory testing plus `web-ext`-based smoke checks (§11.5).
- Target Firefox ≥127, where host permissions are shown in the install prompt and granted at install; on older Firefox, host permissions are opt-in/runtime-granted, so ship a clear first-run prompt guiding the user to enable access on `docs.google.com`. Chrome grants host permissions at install.

### 9.11 Accessibility
- Keyboard-navigable UI; playback controls fully operable without a mouse.
- Visible focus states.
- Accessible names and state descriptions for timeline controls.
- Never convey critical information through color alone (author labels pair color with text/pattern).
- Support reduced-motion preferences in the replay view where possible.

### 9.12 Internationalization Readiness
- MVP may ship English-only, but user-visible strings are organized for later localization.
- The reconstruction engine must not assume English-language content.
- The UI handles right-to-left document text gracefully where browser rendering allows.

## 10. High-Level Programmatic Design

### 10.1 System Shape
Isolated, typed subsystems communicating through explicit data boundaries:
- **Content-page integration** — detects Google Docs context; provides activation points.
- **Orchestration** — manages user intent, document identity, permission checks, task progress, cancellation, error states.
- **Revision retrieval** — fetches revision ranges via the user's authenticated session.
- **Decoding** — converts raw payloads into typed revision events and operations.
- **Reconstruction** — applies operations to an internal model; emits replayable states or deltas.
- **Timeline** — groups low-level revisions into user-comprehensible events.
- **Persistence** — manages IndexedDB caches, schema versions, invalidation, storage limits.
- **Presentation** — renders playback, controls, timeline, summaries, diagnostics, settings.

### 10.2 Separation of Concerns
Google Docs integration knows how to discover context, not how to render UI. Retrieval knows how to request data, not how to reconstruct. The reconstruction engine operates on typed inputs and does not depend on browser-extension APIs. Playback consumes timeline/document-state abstractions, not raw payloads. The storage layer is replaceable with an in-memory implementation in tests.

This matters because Google Docs internals are the least stable part of the product; the rest must remain testable and maintainable even when retrieval or decoding needs repair.

### 10.3 Extension Contexts and Primary Surface
Each context is a WXT entrypoint (the manifest is generated, never hand-written; §11.4):
- **Content script** — page detection, user-visible activation, safe messaging into the extension environment. Minimizes DOM coupling and never injects large application state into the Google Docs page; any in-page UI mounts in a style-isolated shadow root (§11.2).
- **Background context** — coordinates privileged operations, typed cross-context messaging, the resumable retrieval task, and lightweight cache-lifecycle work. Treated as ephemeral (§10.9).
- **Replay page (PRIMARY surface)** — a dedicated extension page opened in its own browser tab, the main application surface for analysis and playback, and the long-lived host for parsing/reconstruction Web Workers.
- **Options page** — privacy information, cache controls, diagnostic preferences, settings.

**Why a dedicated tab over popup / side panel / injected panel:** replay is a rich, sustained experience needing real viewport space; popups are cramped and die on blur; side-panel APIs diverge across Chromium and Firefox and are width-constrained; an injected panel risks style leakage into Google Docs (which §11.3 forbids). A dedicated tab also provides a long-lived context to host Web Workers, which the ephemeral background cannot. A side panel may be added as a Phase 2+ enhancement sharing the same SolidJS app.

### 10.4 Internal Data Flow
1. User activates the extension on a Google Doc.
2. A local replay task is created for the current document.
3. Retrieval discovers available revision ranges and loads them incrementally.
4. Raw payloads are stored locally with cache metadata.
5. The decoder converts raw payloads into typed operations.
6. The reconstruction engine applies operations and produces states/snapshots/deltas.
7. The timeline layer derives user-facing events.
8. The UI renders progress, then switches to replay mode when a usable timeline is ready.
9. The cache records successful processing state for future sessions.

### 10.5 Typed Domain Model
A typed model around documents, revision ranges (requested vs received spans), raw payloads, decoded revisions, document operations, document state, timeline events, playback sessions, cache records, and diagnostic reports. Document identity is handled carefully: the identifier is needed for cache lookup, but UI/export avoid exposing unnecessary metadata. Decoded operations preserve source order, approximate time, author attribution where available, operation type, affected range, inserted content where relevant, and structural effects where known. Document state supports efficient incremental updates, snapshotting, and replay rendering. Timeline events carry confidence/provenance where useful.

### 10.6 Storage Design
The local store is organized by document cache record and held in **IndexedDB via `idb`** — raw revision chunks, decoded operations, reconstruction snapshots, operation/timeline indexes, per-document processing metadata, LRU bookkeeping, and resumable-retrieval checkpoints (object stores with appropriate indexes, e.g. by-updated). The schema is versioned through `idb`'s upgrade path. Parser-version changes mark decoded data stale while retaining raw payloads when safe; if raw was discarded, the record is flagged for re-fetch on next activation. The storage layer supports deleting one document, deleting all, estimating usage, and LRU pruning (raw chunks first, per §9.8), and is replaceable with an in-memory implementation in tests (§10.2). OPFS may later back only the raw-chunk store if profiling shows IndexedDB write throughput is a bottleneck (§9.8). Sensitive content is never written to logs, console, remote endpoints, or error messages.

### 10.7 Error Model
Errors are classified by domain, not raw exceptions. Categories: unsupported page, missing document identifier, insufficient document permission, revision endpoint unavailable, unsupported revision format, network failure, quota/storage failure, reconstruction failure, user cancellation. Each carries a user-facing message, a technical category, recoverability status, and a suggested next action. Raw response bodies and document fragments are never shown in error views.

### 10.8 Diagnostics Model
Diagnostics are opt-in and local by default, and are **anonymized by construction**:
- **Default report:** environment metadata only — browser family, extension version, parser version, manifest target, high-level error category, anonymized operation statistics. No document content.
- **Structural mode** (for parser bugs): operation types, counts, ranges, and structural shape, with all inserted text replaced by length-only tokens (e.g., `insert: 42 chars`).
- **Full raw export:** requires a separate, explicit user action with a clear warning.
- Interactive redaction tooling (reviewing/scrubbing specific content before sharing) is deferred beyond MVP.
- The repo provides guidance for filing useful bug reports without sharing private content.

### 10.9 Background and Heavy-Work Architecture (cross-browser)
- The background context is **ephemeral on both browsers**: an MV3 service worker on Chromium, an MV3 event page on Firefox (the Firefox event page retains DOM/WebAPI access; the Chromium service worker does not, and per its lifecycle terminates after roughly 30 seconds of inactivity, with a hard cap around 5 minutes for a single running activity). It holds no authoritative in-memory state; all durable state lives in IndexedDB. All `browser.*` calls sit inside the entrypoint's main callback, never at module top level (WXT imports the file at build time).
- **Retrieval** runs in the background context, gated on the `*://docs.google.com/*` host permission, using WXT's promise-based `browser`. A credentialed first-party request attaches the user's Docs session cookies in both browsers — a same-site request, not a third-party-cookie scenario, so SameSite, CHIPS, and Firefox Total Cookie Protection do not block it. Because the service worker can be terminated mid-task, retrieval is **chunked and resumable**, checkpointing progress to IndexedDB (via `idb`) so a restarted worker continues rather than restarts. The content script only detects the document and triggers (typed `@webext-core/messaging`); it does not own the fetch. (`declarativeNetRequest` is not needed for authenticated GETs; the multi-account `/document/u/{N}/d/` URL variant must be detected or requests silently fail — Appendix A.5.)
- **Heavy work** (decoding, reconstruction, timeline derivation) runs in a **Web Worker owned by the long-lived replay page**, never in the ephemeral background. The Worker reads raw chunks and writes decoded results through `idb`, and posts reconstructed states/deltas to the SolidJS UI via messages (using Transferable buffers for zero-copy) to hold main-thread blocking under the §18 budget.
- Pipeline: content script triggers → background fetches chunks (resumable) → parse Worker decodes against the operation grammar and reconstructs the character array, persisting through `idb` → posts frames to the replay UI, leaving the main thread free for timeline playback.
- All Google Docs protocol assumptions are isolated in a dedicated module (§19, Appendix A).

## 11. Technical Stack Requirements

### 11.1 Language
All application source in TypeScript under `strict` (with the additional safety flags the guidelines specify, e.g. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), and domain-specific types — discriminated unions for message and operation shapes, branded types for opaque identifiers (document id, revision id) — for revision, reconstruction, storage, and playback concepts. TypeScript is a type-checker only here (`noEmit`); WXT/Vite transpiles for the browser and Bun runs scripts directly. JavaScript only where generated by tooling. Conventions follow `.augment/rules/bun-solid-pro.md`.

The §11 sections below record stack choices; where any detail here could diverge from `.augment/rules/bun-solid-pro.md`, that document governs.

### 11.2 UI Framework
SolidJS for the replay page, options page, and any extension-rendered interactive surfaces, mounted with `render` from `solid-js/web` (never React or `react-dom`). The fine-grained model is load-bearing: components run once and only signal-reading expressions update, so the codebase follows Solid idioms — props accessed reactively (never destructured; `mergeProps`/`splitProps` where needed), derived values via `createMemo` rather than effect-driven state mirroring, and control flow via `<For>`/`<Index>`/`<Show>`/`<Switch>` rather than array `map`/ternaries. Module-scope signals are an idiomatic option for shared state.

In-page UI (the content-script affordance and any injected panels) mounts through WXT's `createShadowRootUi`, which creates a style-isolated shadow root and injects the extension's generated CSS inside it, so styles neither leak into nor inherit from the Google Docs page; page-event leakage is suppressed via the mount's event-isolation option. The replay surface itself is a dedicated extension page (§10.3), not an injected panel.

### 11.3 Styling
UnoCSS with **`presetWind4`** (the current Tailwind-4-compatible preset, per `.augment/rules/bun-solid-pro.md`), wired through the `@wxt-dev/unocss` module and excluded from the background entrypoint (no DOM there); the virtual stylesheet is imported once per UI entrypoint. presetWind4's reset is integrated (no separate reset dependency). The oklch-color-model and `presetLegacyCompat` incompatibility that earlier research raised applies only to migrating an existing legacy-Tailwind project; DocRewind is greenfield, so it does not bind — an early-build watch-item nonetheless verifies `@apply` and color behavior against the actual component set, with no expectation of a blocker. A design system defines reusable primitives (buttons, panels, timelines, progress states, warnings, document rendering). Generated styles are scoped inside the content-script shadow root (§11.2) to avoid leakage into Google Docs.

### 11.4 Build and Tooling
- **Bun** for package management and script running, with the committed `bun.lock` text lockfile and `--frozen-lockfile` in CI. Bun's server/runtime APIs are irrelevant here (nothing Bun-runtime ships to the browser); its role is install, run scripts, and run pure-logic tests fast.
- **Extension framework: WXT** — Vite-based, framework-agnostic with a first-class SolidJS template (`@wxt-dev/module-solid`), UnoCSS via `@wxt-dev/unocss`, and WXT typed storage; it generates per-browser manifests from `wxt.config.ts` and the `entrypoints/` convention (no hand-written `manifest.json`), exposes all utilities through the `#imports` virtual module and a polyfill-free `browser`, and handles the Chromium-service-worker vs Firefox-event-page split with HMR. Plasmo (maintenance mode) and CRXJS (build-only/abandonment risk) are rejected.
- **Lint/format: Biome** — a single tool replacing ESLint+Prettier, run as a combined check (format + lint + import-organize); there is no Biome equivalent of an `eslint-plugin-solid`, so Solid correctness relies on Biome's recommended + type-aware rules plus Solid's compile-time reactivity warnings from `vite-plugin-solid`.
- **Build verifiability and AMO source review:** pin the toolchain (Bun version, any Node version) and all dependencies via the committed lockfile; publish SHA-256 checksums and build provenance for every release artifact. Firefox AMO requires reviewable source for bundled/minified output — a reviewer rebuilds from submitted source + lockfile and diffs against the artifact, which must match — so the WXT build must be **deterministic from the committed lockfile** (obfuscation prohibited; minification allowed with sources), and the AMO submission documents the exact Bun version (WXT/Vite output under Bun should reproduce deterministically; native-dependency edge cases under Bun are validated as part of release). This makes a deterministic source build a release gate.

### 11.5 Testing
- **Pure logic — Bun test runner.** The parser, reconstruction engine, and timeline derivation are pure and DOM-free, so they run under Bun's fast runner: fixture-based parser/reconstruction tests, and deterministic timeline tests for session grouping, large-insertion detection, deletion events, and pause detection.
- **Components, storage, browser APIs — Vitest.** Solid components, the `idb` storage layer (migrations and cache invalidation), and browser-API behavior run under Vitest with the `WxtVitest` plugin (jsdom, `@solidjs/testing-library`, and the in-memory `fakeBrowser` reset between tests). Solid component tests render a function returning JSX and drive updates via signals, never via re-render. (Bun's runner is not used for these — it does not apply the Solid JSX transform or provide the fake browser.)
- **End-to-end — Playwright, Chromium-only.** Playwright drives the built extension via a persistent context loading `.output/chrome-mv3`. Extension loading is **Chromium-only**, so E2E coverage is Chromium.
- **Firefox validation.** Because Playwright cannot load the Firefox build, Firefox is validated by manual exploratory testing and `web-ext`-based smoke checks (load, activate, retrieve, replay) — this is how the §9.10 "validate Firefox for real" requirement is met in the absence of automated Firefox E2E.
- **Manual exploratory matrix** (both browsers): small / long / collaborative documents, copied-and-pasted content, comments and suggestions, images and tables, and mixed-language / RTL content.

### 11.6 Licensing and Contribution
- **License:** AGPL-3.0-or-later for all first-party source. (`-or-later` permits adopting future AGPL versions; switch to `AGPL-3.0-only` if the project prefers to pin the version.) A `LICENSE` file and per-file SPDX headers (`SPDX-License-Identifier: AGPL-3.0-or-later`) are required.
- **Practical note:** AGPL's §13 network-interaction clause is effectively inert for a local-only extension with no network-accessible service, but AGPL remains a strong-copyleft signal aligned with the project's transparency goals, and is accepted by both the Chrome Web Store and AMO. Forks distributed to users must carry the same license and offer corresponding source.
- **Dependencies:** must be AGPL-compatible. Audit licenses in CI; reject incompatible (e.g., proprietary or non-redistributable) dependencies. The core stack — WXT, SolidJS, UnoCSS, Bun, Biome, `idb`, `@webext-core/messaging` — is permissively licensed (MIT/Apache-class) and compatible.
- **Contributions:** Developer Certificate of Origin (DCO) sign-off (`Signed-off-by`) on commits; no CLA and no copyright assignment, keeping the project decentralized and trustworthy.
- **Prior-art provenance (important for an AGPL project):** the operation grammar may be ported directly from `harvard-vpal/gdocrevisions`, which is **MIT-licensed** (MIT → AGPL incorporation is permitted) — retain the MIT attribution alongside the AGPL header on derived files. Etherpad (Apache-2.0) and operational-transform literature are safe conceptual references. The `jsomers/draftback` repository (no license = all-rights-reserved, and in any case the old Rails/PHP web app, not the current closed-source extension) and the benmarwick gist (no license) are **study-for-facts-only**: confirm protocol facts from them, never reuse their code. Draftback's shipping extension is proprietary and must not be decompiled or copied.

## 12. Permissions Model
- Request the narrowest permissions possible.
- Host permissions limited to the Google Docs origins required for operation; no broad all-sites access.
- No persistent access to page content until the user activates the extension on a supported document.
- Plain-language permission explanations so users understand why each permission is needed.
- Research confirms a minimal viable footprint of a single host permission, `*://docs.google.com/*`, with no broader access required (Appendix A.7). Declare "no remote code" (the extension is fully local) and a single-purpose statement for store review (§21.5).
- **Fallback:** if either store rejects the standing `*://docs.google.com/*` host permission, fall back to an `activeTab` / optional-permission model granted on the open Docs tab at activation time.

## 13. Privacy & Data Handling Specification (Canonical)

This section is the single source of truth for privacy guarantees. Other sections reference it rather than restating it.

1. The extension operates without a remote backend.
2. It does not transmit document content, revision data, metadata, derived signals, or usage behavior to the authors, maintainers, or any analytics/third-party provider. The only network requests are to Google Docs origins, using the user's existing session, for the current document.
3. It includes no analytics, crash reporting, third-party tracking, or remote feature flags.
4. It requires no account creation.
5. It uses browser-local persistence only (IndexedDB for document-derived data; extension local storage for lightweight settings).
6. It minimizes the lifetime of sensitive data in memory where practical.
7. It sanitizes any UI display of data derived from document content and never renders raw response bodies or document fragments in errors.
8. It uses no remote code execution or remotely hosted application scripts, complying with browser-store content-security and remote-code policies.
9. It does not request host permissions beyond what Google Docs operation requires.
10. The repository includes a clear privacy policy, security policy, and threat model; the UI surfaces a plain-language privacy summary.

## 14. Threat Model
- **Assets:** document content, revision history, document metadata, author information, derived writing-process signals.
- **Primary privacy risk:** accidental leakage via telemetry, logs, diagnostics, exports, browser sync, overly broad permissions, or third-party libraries. Mitigated by §13, the anonymized diagnostics model (§10.8), and dependency auditing (§11.6).
- **Primary technical risk:** misinterpreting undocumented Google Docs revision data. Mitigated by isolation (§19), fixture tests (§11.5), and conservative fidelity claims (§15.3).
- **Primary user risk:** a reader overinterpreting replay as proof of misconduct or authorship. Mitigated by positioning (§7), uncertainty disclosure (§9.5, §9.7), and disclaimers (§21).
- **Primary maintenance risk:** Google changing revision internals, breaking retrieval/decoding. Mitigated by isolation and fixture-driven regression detection.
- **Note on browser sync:** settings stored in extension storage must use non-synced (`storage.local`) storage to avoid leaking preferences or document identifiers through browser account sync.

## 15. MVP Scope

### 15.1 Included in MVP
- Support for current Google Docs documents opened in the browser.
- Manual per-document activation.
- Local revision retrieval and parsing.
- Basic document reconstruction (fidelity bar §15.3).
- Interactive replay: play, pause, scrubber, speed control.
- Basic activity timeline.
- Local IndexedDB cache with clearing controls.
- Chromium-compatible build and Firefox build (first-class, validated before public release).
- Privacy documentation and AGPL-licensed open-source repository with build instructions.

### 15.2 Deferred Beyond MVP
Video export; PDF report generation; multi-document comparison; Google Slides/Sheets support; advanced collaborative attribution views; institutional deployment controls; cloud sync; remote diagnostics; AI-generation detection claims; automated grading/scoring; interactive diagnostic redaction tooling; side-panel surface; full rendering of images/tables/footnotes/comments and list formatting (text content and suggestions are in MVP scope per §15.3).

### 15.3 MVP Reconstruction Fidelity Bar
- **MUST:** plain-text insertions, deletions, their ordering and timestamps, and paragraph structure. Playing to the end of the timeline must reproduce text equal to the document's current text (text-level equality, ignoring rich formatting) for the simple fixture corpus.
- **SHOULD (best-effort, non-blocking):** basic styling (bold/italic); list *text* content (which lives in the character stream) reconstructed as paragraphs even where list *formatting* is approximated; and suggestions/tracked changes, which are inline operations (`iss`/`dss`/`msfd`/`usfd`) shown distinctly from accepted text.
- **OUT OF SCOPE for fidelity (degrade to placeholders / annotations):** images, tables, footnotes, equations, drawings, and list formatting (all outside the plain character stream), plus comments (out-of-band). These render as labeled placeholders or timeline annotations and must never abort reconstruction.

## 16. Release Phases

### Phase 0: Live Capture Prototype (gating)
Desk research across two rounds is complete (Conditional-Go; the operation grammar is source-confirmed in Appendix A.2). Phase 0 narrows to the transport-layer residue that only a live capture can settle. Run an authenticated network capture in current Chrome and Firefox against three documents: (a) a small text doc, (b) a doc containing images, tables, footnotes, equations, and lists, and (c) a multi-account (`/u/1/`) session. Record: response framing (is the `)]}'` prefix present; JSON vs a `batchexecute`-style wrapper), the operation codes actually present, any required headers/XSRF/page token for the *read*, the revision-count discovery mechanism and its location, per-call chunk size/latency and any soft rate limits, and how non-text structures appear (inline vs out-of-band). Also confirm a credentialed first-party fetch succeeds from an MV3 service worker and from a Firefox event page, and exercise Chromium service-worker termination during a long chunked fetch (resumability). Build a minimal parser for the confirmed operations and create sanitized fixtures. **Go/no-go:** Phase 1 does not begin until retrieval + decoding of a simple document is confirmed live in both browsers, and is re-triggered if any stop condition in §24 appears.

### Phase 1: Local Replay MVP
Build the extension shell, document detection, user activation, revision retrieval, local cache, parser, reconstruction engine, and basic replay UI. Focus on single-author and simple multi-author text documents. Provide clear failure messages for unsupported documents.

### Phase 2: Robustness and Firefox Parity
Improve parser coverage. Add full Firefox validation — manual exploratory plus `web-ext`-based smoke checks, since Playwright E2E is Chromium-only (§11.5). Confirm the Firefox MV3 event-page background and host-permission first-run UX on a real build (falling back to Firefox MV2 only if MV3 event-page issues arise, §9.10). Improve storage migration and cache management. Add diagnostics export controls (anonymized/structural modes). Test larger and more complex documents.

### Phase 3: Process Insights
Add writing-session summaries, large-paste indicators, deletion summaries, pause visualization, and timeline clustering. Keep insights descriptive; avoid unsupported judgments.

### Phase 4: Distribution Readiness
Prepare a deterministic `bun run build` with committed lockfile and an AMO source-submission README *before* first submission. Submit to AMO (source review is the long pole — automated review can be minutes, human review of a build-tooled extension days to weeks) and the Chrome Web Store in parallel; on CWS, file the single-purpose statement, the "no remote code" declaration, and the `docs.google.com` host-permission justification emphasizing local-only processing. Finalize privacy policy, security policy, contributor documentation (DCO), and release process; publish verifiable release artifacts with checksums and provenance. Complete legal/ToS review (§21.5) before public launch. If either store rejects on host-permission grounds, switch to the `activeTab`/optional-permission fallback (§12).

## 17. Success Metrics (quantified MVP targets, subject to Phase 0 validation)
- **Fidelity/coverage:** end-to-end reconstruction with end-of-replay text equal to current text for ≥90% of a curated "simple" fixture corpus (single- and simple multi-author, text-focused).
- **Cold load:** a ~10,000-word, ~500-revision document reaches interactive replay in ≤60s on a mid-range laptop.
- **Warm load:** cached reload reaches interactive replay in ≤5s.
- **Responsiveness:** no main-thread block >100ms during parsing or replay (heavy work in Web Workers).
- **Memory:** peak heap for the reference document stays within a defined budget (target ~512MB) or degrades gracefully with explicit messaging.
- **Network isolation:** zero non-Google network requests during document processing, verified by a network audit in CI and manual testing.
- **Test coverage:** ≥85% line coverage on parser/reconstruction modules exercised by fixtures.
- **Cross-browser:** Chromium and Firefox builds produced from one codebase, both passing integration tests.
- **Usability:** users can clear cached data in ≤2 interactions; contributors can reproduce a build and run tests from documented steps on a clean machine.

## 18. Performance Requirements
- Immediate feedback after user activation.
- Streamed loading progress, never silent blocking.
- Parsing/reconstruction never freeze the UI (Web Workers, §10.9).
- Large documents processed in chunks.
- Replay stays responsive during timeline navigation.
- Cache reuse makes repeated replay significantly faster than first load (§17 warm-load target).
- Cancellation available for long-running processing.
- Graceful handling of storage-quota limits.

## 19. Compatibility Requirements
- Support current stable Chromium-compatible browsers and current stable Firefox.
- Resilient to common Google Docs UI changes by minimizing dependence on page DOM structure.
- Isolate all Google Docs protocol assumptions (endpoint URLs, request/auth shape, response framing, operation schema; Appendix A) in a single dedicated module — the one place to repair when Google changes internals.
- Use feature detection rather than hardcoded browser assumptions.

## 20. UX Principles
- Calm, transparent, trustworthy.
- Never load or store document history without explicit activation.
- Communicate uncertainty and limitations clearly.
- Prioritize "show what changed" over "judge what happened."
- Make privacy controls easy to find.
- Keep the replay experience understandable to non-technical users.

## 21. Legal and Ethical Considerations

### 21.1
Respect user permissions; never attempt to access documents beyond the current session's authorization.

### 21.2
Include disclaimers that replay is reconstructed from available revision information and may be incomplete or affected by Google Docs behavior.

### 21.3
Discourage use as the sole basis for disciplinary or high-stakes decisions.

### 21.4
Avoid implying affiliation with Google or Draftback; the name avoids trademark confusion (§26).

### 21.5 Terms-of-Service Position (expanded)
Authorization and Terms of Service are distinct concerns. DocRewind only accesses revision data the authenticated user is already entitled to view, using their own session, with no credential sharing and no access to other users' private data. **However**, programmatic use of Google Docs' internal, undocumented revision endpoints may be in tension with Google's Terms of Service even when the user is fully authorized to read the document. This is treated as a known, unresolved risk, not a solved problem.

Mitigations:
- User-initiated only; no automatic or background scraping.
- Minimal, rate-limited requests scoped to the current document and only the needed revision ranges.
- No circumvention of access controls or authentication.
- Clear disclaimers and no affiliation claims.

Distribution fallback if a store rejects the extension on these grounds:
- Distribute via self-hosted signed releases plus Firefox AMO (historically more permissive about source review), in addition to or instead of the Chrome Web Store.
- Document the risk openly in the repository.

Enforcement posture (from Phase 0 research): Google's Terms broadly prohibit accessing services "through the use of any automated means," which a programmatic call to an internal endpoint plausibly implicates even for an authorized user on their own document. Recent enforcement — for example Google's December 2025 DMCA suit against a search-results scraping service — has targeted large-scale scraping of public data for resale, not single-user first-party self-access. The realistic risk to a privacy-preserving, user-initiated, local extension is therefore primarily **extension-store policy review** rather than litigation; Draftback's continued store listing (a Docs-internals reader with hundreds of thousands of users) is a non-guaranteeing data point that the category is tolerated, though commentary that it "doesn't follow best practices" signals the policy posture could tighten. The mitigations above are designed to keep DocRewind firmly on the self-access side of that line.

Store-review specifics: the Chrome Web Store applies a single-purpose policy (DocRewind's purpose — "replay your Google Doc's writing history locally" — is narrow and clear), a minimum-permissions expectation (request only `*://docs.google.com/*`, never `<all_urls>`), and an MV3 remote-code ban (DocRewind is fully local and declares no remote code). Firefox AMO requires reviewable source for bundled output (§11.4). No clear store rejection-with-reasons for a revision-reader was found in research, so actual approval is itself a Phase 4 unknown to be confirmed by submission, with the `activeTab`/optional-permission model (§12) as the fallback.

Official-API note: research confirms Google's Drive/Docs APIs expose only coarse, merged "named" revisions — the list may be incomplete for frequently edited Docs and revision content cannot be downloaded via the API — so no sanctioned path provides the keystroke-level data this product requires (Appendix A.6). **This PRD does not constitute legal advice; obtain project legal review before public launch.**

## 22. Key Risks
- Google may change revision endpoints, payload structures, or access requirements.
- Some document structures may be difficult or impossible to reconstruct accurately.
- Large documents may exceed practical local processing or storage limits.
- Firefox/Chromium divergence may require target-specific workarounds, and automated E2E (Playwright) is Chromium-only; mitigated by WXT's per-browser manifest generation and polyfill-free `browser`, plus dedicated manual / `web-ext` Firefox validation (§9.10, §11.5).
- Users may overinterpret process signals as proof of authorship or misconduct.
- Browser stores may scrutinize Google Docs access permissions and undocumented-endpoint use (ToS, §21.5).

## 23. Risk Mitigations
- Isolate and well-test Google Docs protocol assumptions (§19).
- Fixture-based parser tests to detect regressions (§11.5).
- Clear unsupported-format errors (§10.7).
- Chunked processing and cache versioning (§9.8, §10.6).
- Narrow permissions (§12).
- Clear privacy policy and threat model (§13, §14).
- Conservative product language around insights (§7, §9.7).
- Browser-specific test coverage (§11.5, §9.10).
- Adaptive chunk sizing and backoff; treat HTTP 500 as "range too high" (also the range-discovery signal); handle the `/document/u/{N}/d/` multi-account URL variant (Appendix A.4, A.5, A.9).
- Schema-version detection so a Google-side format change degrades gracefully instead of silently corrupting playback.
- Hard stop-and-re-evaluate triggers (mirrored in §24): the endpoint returns protobuf instead of JSON, a new mandatory page-derived token appears, or Google publishes guidance restricting the editor endpoints.

## 24. Phase 0 Research Outcome & Remaining Live Capture
Two research rounds returned a **Conditional-Go**. Round 1 established feasibility with a current existence proof (a maintained MV3 Draftback build). Round 2 pinned the **operation grammar from open MIT source** (`harvard-vpal/gdocrevisions`, corroborated by the 2014 teardown) — see Appendix A.2 — and confirmed that no sanctioned Google API can reconstruct keystroke-level history. What everything DocRewind needs to *grammar-decode* is now known; everything it needs to *fetch correctly in 2026* is **transport-layer and unconfirmable from public sources**.

**RESOLVED 2026-06-12** — the live capture was performed (Chromium-149 / Helium, authenticated, throwaway docs; see `docs/protocol-capture.md`). **No stop-condition fired.** The transport residue (1–10) is confirmed and encoded in `lib/protocol/*` + the live adapter in `entrypoints/background.ts`; item 11 is reclassified to a release gate. A same-day **Firefox follow-up** (Firefox 151 + `firefox-devtools` MCP, real signed-in session) then closed items **7** (rich/suggesting doc) and **8** (multi-account `/u/1/`) live, confirmed the Firefox first-party read + affordance mount (10/12), and left the Firefox extension-background fetch (10) and a deterministic event-page-termination kill (9) **honestly unverified** for documented MCP-tooling reasons. The original residue list, now answered:

1. Exact 2026 JSON shape of `revisions/load`, and whether the `)]}'` prefix is still present.
2. Whether `revisions/load` still uses the legacy endpoint or a `batchexecute`/`rpcids` wrapper.
3. Whether any custom header (e.g., `X-Same-Domain`) is required for the read.
4. Whether any XSRF/`at` token is required for *reads* (it is classically a write-path requirement), and its bootstrap origin if so.
5. The precise current-revision-count discovery mechanism (binary-search-on-HTTP-500 vs. a metadata field / changelog / tile endpoint) and its location.
6. Sane chunk sizes and any soft rate limits on the endpoint.
7. How images/tables/footnotes/equations/drawings/lists actually appear (inline ops vs out-of-band) in a live capture; confirm suggestions are the inline `iss`/`dss`/`msfd`/`usfd` ops.
8. Multi-account `/document/u/{N}/d/` URL handling on a real multi-login session.
9. Chromium service-worker termination behavior during long chunked fetches (resumability test).
10. Credentialed first-party fetch success from an MV3 service worker and a Firefox event page.
11. ~~Actual CWS and AMO review outcomes~~ — **RECLASSIFIED (2026-06-12) to a release gate**, not a transport blocker: real store-review outcomes require submitting the extension. Current posture is policy-compliant (MV3, `storage`-only, `*://docs.google.com/*`-only, no remote code); the review outcome is pending submission (release phase).
12. WXT Firefox MV3 event-page + host-permission first-run UX, and `presetWind4` behavior against the real component set (engineering confirmations, lower-stakes).

**Stop and re-evaluate the whole approach if** the endpoint returns protobuf instead of JSON or moves behind a `batchexecute` wrapper, a new mandatory page-derived token appears for reads, or Google publishes guidance specifically restricting the editor endpoints. *(Checked 2026-06-12 against the live endpoint: none observed.)*

## 25. Recommended MVP Definition
A local-only browser extension that activates on an open Google Doc, loads available revision data after explicit user action, reconstructs text-focused document history (fidelity bar §15.3), and presents an interactive replay timeline. It supports Chromium-compatible browsers first and Firefox as a first-class target before public release. It makes no authorship judgments, no AI-detection claims, and no high-fidelity rendering of every Google Docs feature. Its value is transparent, local replay of the writing process with clear privacy guarantees and honest limitations.

## 26. Product Name
**DocRewind** — subtitle "Local revision replay for Google Docs." Repository and package slug: `docrewind`.

The name is literal and immediately legible to the target audience (teachers, researchers, students, editors): it says what the product does — rewind a document's history. It avoids the "Draft-" stem, keeping clear distance from "Draftback," and contains no Google or Docs trademark in the core mark; "for Google Docs" is used only descriptively (nominative use). Tradeoff: "rewind" is a common term, so a trademark/availability search and a domain/handle check should be completed before the name is locked, to rule out collisions in adjacent classes. (The brand is written DocRewind; the lowercase `docrewind` is reserved for technical identifiers — repo, package, extension slug.)

---

## Appendix A — Google Docs Revision Protocol (isolated assumptions, as of Phase 0 research, June 2026)

This appendix is the canonical reference for the volatile, undocumented Google Docs behavior the product depends on. All of it must live behind the single protocol module (§19). Every item is labeled with confidence; items marked **provisional** are pending the live validation in §24. This is reverse-engineered, undocumented behavior that Google may change without notice.

**A.1 Primary changelog endpoint.** `GET https://docs.google.com/document/d/{docId}/revisions/load?id={docId}&start={startRev}&end={endRev}`, returning a `)]}'`-guarded JSON changelog of fine-grained mutation operations. This is the source for keystroke-level replay. A separate `showrevision` endpoint returns a *rendered* single-revision snapshot (what File → Version history calls) and is **not** the replay source. *[**CONFIRMED 2026-06-12:** exactly this URL returns HTTP 200 `application/json`; the top-level payload is an object `{ chunkedSnapshot, changelog }` where `changelog` is an array of 9-element revision tuples `[op, time, sessionId, revisionId, userId, …]`. See docs/protocol-capture.md Q1.]*

**A.2 Operation vocabulary (source-confirmed grammar).** The document is modeled as a flat character array; each changelog entry carries a type discriminator `ty`. The following grammar is **confirmed from open MIT source** (`harvard-vpal/gdocrevisions`, last release 2018) and matches the 2014 teardown — two independent open sources agree:
- `is` — InsertString: `s` (string), `ibi` (insert-begin-index, 1-indexed). Splices characters at `ibi-1`.
- `ds` — DeleteString: `si` (start index), `ei` (end index), 1-indexed inclusive. Pops the range.
- `mlti` — MultiOperation (compound): `mts` (array of sub-operations); recurse depth-first.
- `iss` — InsertStringSuggestion (suggestion form of insert).
- `dss` — DeleteStringSuggestion (suggestion delete, range).
- `msfd` — MarkStringForDeletion (suggestion; range).
- `usfd` — UnmarkStringForDeletion (range).

Attribution/timing: each revision carries `user_id`, `session_id`, `revision_id`, and `time`; each character carries its insert/delete revision and a suggestion flag. An `EndOfBody` sentinel separates body text from footnote text. Style-apply (formatting over a character range) exists but is secondary for text replay. *[Grammar Confirmed-from-source (MIT, 2018) + corroborated by 2014 teardown. Caveat: both sources predate 2026; that the live wire format still matches is **provisional** until §24 capture. Do not assume the codes are current without confirming.]*

**A.3 Response framing.** Strip Google's standard `)]}'` anti-JSON-hijacking prefix line before `JSON.parse`. The payload is JSON (text), not protobuf, per available evidence; a migration to protobuf is a defined stop condition (§24). *[**CONFIRMED 2026-06-12:** the `)]}'` guard line is present and the body is JSON (`content-type: application/json`); `lib/protocol/framing.ts#stripGuard` strips it. Not protobuf — stop-condition NOT fired.]*

**A.4 Revision-range discovery.** There is no "all revisions" call and `start=1&end=-1` is rejected; a real upper bound is required. The documented method (2014) finds the maximum revision number by binary search (HTTP 500 ⇒ range too high, HTTP 200 ⇒ in range). Draftback issue history indicates a "Changelog and RevisionCount" endpoint also exists; a direct revision-count metadata field/endpoint likely exists today but its exact name/location is unconfirmed. Somers' examples used ~10 revisions per call; sane chunk sizes and any soft limits are unpublished. *[**CONFIRMED 2026-06-12:** the current count is published in the editor bootstrap as `"revision":N` (the metadata path used by discovery); out-of-range `end` now returns **HTTP 400** (not the 2014-era 500), in-range returns 200 — the binary-search fallback keys on that 400 boundary. Chunk sizing was not stress-tested (anti-abuse); `DEFAULT_CHUNK_SIZE=100` + adaptive shrink-on-failure is retained. See protocol-capture.md Q5/Q6.]*

**A.5 Known breakage modes.** Multi-account sessions rewrite the path to `https://docs.google.com/document/u/{N}/d/...`; hardcoded single-account paths break (the documented 2017 third-party-tool failure). The protocol module must handle the `/document/u/{N}/d/` variant. *[Confirmed-historical 2017.]*

**A.6 No sanctioned alternative.** The Drive `revisions` resource and the Docs API expose only coarse, merged "named" revisions; the list may be incomplete for frequently edited Docs, and Docs revision content cannot be downloaded via the API. The Drive Activity API gives change events, not the operation stream. The internal endpoint is the only source for replay. *[Confirmed-current against Google docs, ~May 2026.]*

**A.7 Auth & permissions.** Authentication is the user's existing first-party `docs.google.com` session cookies — no OAuth, no API key. Evidence (a 2024 capture of the sibling `showrevision` endpoint working logged-in without `token`/`ouid`) suggests reads need only the session cookie, and that the `at`/XSRF token is classically a *write*-path requirement; whether `revisions/load` requires any header/token for the read today is **provisional** (§24). A credentialed `fetch(..., {credentials:'include'})` from the background context attaches these cookies given the `*://docs.google.com/*` host permission, in both Chromium and Firefox (mechanics: §10.9). Minimal host permission: `*://docs.google.com/*`, with no broader access. *[**CONFIRMED 2026-06-12:** the read needs ONLY the session cookie — no custom header (no `X-Same-Domain`) and no XSRF/`at`/page-derived token returns 200. Verified from the page context AND from the built extension's MV3 service-worker context (200 `application/json`). No new read token — stop-condition NOT fired. See protocol-capture.md Q3/Q4/Q10.]* *[**Firefox follow-up 2026-06-12 (§24 Q10):** the credentialed first-party read is confirmed live in Firefox (200 `application/json`, no sign-in bounce), including under `/u/1/`; the `*://docs.google.com/*` host match is active (the content script injects). The credentialed fetch from the **Firefox extension background/event-page context specifically** was NOT autonomously verified — the `firefox-devtools` MCP cannot reach that context (no JS-eval; the affordance trigger lives in a closed-over shadow root) and Firefox MV3 may treat `host_permissions` as optional (user-granted). The cookie-attachment mechanism is the one already proven on Chromium MV3; closing it in Firefox is a one-line manual background-console check.]*

**A.8 Non-text structures.** The model is fundamentally a character stream. Suggestions/tracked changes **are** inline operations (`iss`/`dss`/`msfd`/`usfd`) and are reconstructable. Comments are out-of-band (separate Docs comments store). Images, tables, footnotes, equations, drawings, and list *formatting* ride as styled/embedded objects outside the plain character stream (the open reference decoder renders characters only and does not decode them). DocRewind reconstructs text + suggestions and placeholders the rest (§15.3). *[**CONFIRMED 2026-06-12** (rich/suggesting-doc capture, Firefox; §24 Q7): suggestions ARE inline ops — `iss` (insert) and `msfd` (mark-for-deletion) both appeared live and decode to typed variants (`dss`/`usfd` not exercised, same grammar). Embedded objects (image/table/footnote/equation/list) ride **IN-BAND** as entity ops `ae` (AddEntity `{et,id,epm}`; `et:"inline"` for the image, `et:"list"` for lists) + `te` (place in stream at `spi`) + `ue` (UpdateEntity); lists also carry an `as` op with `st:"list"`. Suggestion styling/entities add `astss` and `sue`. The decoder structurally models `is`/`ds`/`mlti`/`iss`/`dss`/`msfd`/`usfd` and **isolates** `as`/`ae`/`te`/`ue`/`astss`/`sue` via the open-world `UnknownOp` path. The full 140-revision changelog reconstructs to the doc's exact visible text through the production pipeline — embedded objects are omitted (not placeholdered) with **no** index drift; placeholdering them stays an optional Phase-5 fidelity item. Locked by `lib/fixtures/captured-rich.ts` + `lib/decoder/captured-rich.test.ts`. See protocol-capture.md Q7.]*

**A.9 Rate limiting.** No public evidence of captcha or hard anti-automation friction on `revisions/load` for normal interactive use; aggressive large-range scraping risks HTTP 500s and undocumented soft limits. Use adaptive chunk sizing and backoff. *[**CONFIRMED-as-designed 2026-06-12:** discovery and chunk fetching are kept low-volume (one bootstrap metadata read; a single in-range call returned the full history). Large ranges were deliberately NOT stress-tested (anti-abuse); the orchestrator's adaptive shrink + exponential backoff (now also triggered by a 400) absorbs soft limits without a tight loop.]*

**A.10 Currency note.** The operation grammar (A.2, A.8) is confirmed from open MIT source; the **transport layer** (framing A.3, headers/token A.7, discovery A.4, rate limits A.9) was **CONFIRMED on the live wire 2026-06-12** in Chromium (Helium 149) — see `docs/protocol-capture.md`, no stop-condition fired. The confirmed facts are encoded as typed constants in `lib/protocol/types.ts` (`DEFAULT_TRANSPORT`) and `lib/protocol/discovery.ts`, with the live adapter in `entrypoints/background.ts`; the fail-safe schema detector remains the safety net for future drift in this undocumented surface. The **2026-06-12 Firefox follow-up** additionally confirmed, live in Firefox: the rich/suggesting-doc op grammar (A.8 — `iss`/`msfd` suggestions + in-band `ae`/`te`/`ue` entity ops, decoder unchanged), the multi-account `/u/1/` read (A.5), and the first-party credentialed read + affordance mount. Remaining live gaps are now narrowed to two, both with documented MCP-tooling causes (not transport blockers): the credentialed fetch from the **Firefox extension background context** specifically, and a **deterministic SW/event-page-termination kill** on a large doc — both release-phase smoke tests (the latter best run on Chromium MV3). A real Firefox UX finding was also recorded: `presetWind4`/content-script CSS is CSP-blocked on Google Docs in Firefox, so the affordance renders unstyled (Phase-5 fix).
