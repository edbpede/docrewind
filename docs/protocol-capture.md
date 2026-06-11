# DocRewind — Google Docs Transport Live-Capture Record

> **STATUS: BLOCKED — requires maintainer live capture (§24).**
>
> Every transport answer below is **UNANSWERED / BLOCKED** until an
> authenticated network capture is performed in **current Chromium AND Firefox**
> against three real Google Docs. This capture is **un-performable by an
> autonomous agent**: it needs the maintainer's logged-in, multi-account browser
> sessions, DevTools network capture, and runtime service-worker observation.
>
> The pure core (decoder, reconstruction, timeline, domain) and the protocol
> *skeleton* (`lib/protocol/*`) are built and tested against **synthetic**
> fixtures that encode the source-confirmed Appendix A.2 grammar. They do **not**
> depend on the answers below. **Phase 4 (network retrieval) cannot be safely
> started until this file is filled in and none of the stop-conditions fire.**

## How to perform the capture

Open DevTools → Network in current Chromium and again in current Firefox. Log in
and capture `revisions/load` traffic against **three documents**:

1. A simple text-only document.
2. A rich document containing images, tables, footnotes, equations, and lists.
3. A document opened under a **multi-account** session (`/u/1/…`).

Record each answer inline below, replacing `BLOCKED / UNANSWERED`, then flip the
`STATUS` banner once all twelve are answered and re-run the §24 stop-condition
check.

---

## The 12 §24 transport questions

### 1. Exact 2026 JSON shape of `revisions/load` + `)]}'` prefix presence
**Status:** `BLOCKED / UNANSWERED`
_Record the top-level JSON shape and whether the `)]}'` guard line is present
(A.3). `lib/protocol/framing.ts#stripGuard` already fail-safe-handles present/
absent; confirm the live shape so `schema-detect.ts` recognizes it._

### 2. Legacy endpoint vs. `batchexecute` / `rpcids` wrapper
**Status:** `BLOCKED / UNANSWERED`
_⚠️ **STOP-CONDITION** if it has moved behind a `batchexecute` wrapper._

### 3. Required custom read header (e.g. `X-Same-Domain`)
**Status:** `BLOCKED / UNANSWERED`
_Maps to `TransportConstants.requiredReadHeaders` (currently `UNCONFIRMED`)._

### 4. XSRF / `at` token requirement for reads + bootstrap origin
**Status:** `BLOCKED / UNANSWERED`
_Maps to `TransportConstants.readTokenRequired` (currently `UNCONFIRMED`).
⚠️ **STOP-CONDITION** if a new mandatory page-derived read token appears._

### 5. Current-revision-count discovery mechanism + location
**Status:** `BLOCKED / UNANSWERED`
_Binary-search-on-HTTP-500 vs. a metadata field / changelog / tile endpoint
(A.4). Maps to `discovery.ts#DiscoveryStrategy` (currently `unconfirmed`)._

### 6. Sane chunk sizes and any soft rate limits
**Status:** `BLOCKED / UNANSWERED`
_Informs adaptive chunk sizing + backoff in Phase 4 (A.9)._

### 7. How images/tables/footnotes/equations/drawings/lists appear; confirm suggestions are inline `iss`/`dss`/`msfd`/`usfd`
**Status:** `BLOCKED / UNANSWERED`
_Inline ops vs. out-of-band (A.8). The decoder already placeholders non-text
structures via `OpaquePlaceholder`; confirm the live encoding._

### 8. Multi-account `/u/{N}/` URL handling on a real multi-login session
**Status:** `BLOCKED / UNANSWERED`
_`endpoints.ts#detectUserIndex` + `buildRevisionsLoadUrl` handle the variant
(A.5); confirm against a live `/u/1/` session._

### 9. Chromium service-worker termination during long chunked fetches (resumability)
**Status:** `BLOCKED / UNANSWERED`
_Observe SW termination mid-fetch; informs the resumable-checkpoint design._

### 10. Credentialed first-party fetch from an MV3 service worker and a Firefox event page
**Status:** `BLOCKED / UNANSWERED`
_Confirm `fetch(url, { credentials: "include" })` attaches the session cookie in
both runtimes (A.7)._

### 11. Actual CWS and AMO review outcomes for a `docs.google.com` revision-reading MV3 extension
**Status:** `BLOCKED / UNANSWERED` (Phase 4 store-review confirmation)

### 12. WXT Firefox MV3 event-page + host-permission first-run UX; `presetWind4` behavior against the real component set
**Status:** `BLOCKED / UNANSWERED` (engineering confirmations, lower-stakes)

---

## §24 Stop-and-re-evaluate conditions (halt the whole approach if any fire)

- [ ] The endpoint returns **protobuf** instead of JSON.
- [ ] `revisions/load` moves behind a **`batchexecute`** wrapper.
- [ ] A **new mandatory page-derived read token** appears for reads.
- [ ] Google publishes guidance **restricting the editor endpoints**.

If any condition is observed, do **not** proceed to Phase 4: the
`decodeOperations(parsed)` JSON-input adapter and the JSON-shaped fixtures do not
survive a protobuf/`batchexecute` change (see plan Pre-mortem #3). The grammar
**semantics** (`is`/`ds`/`mlti`/suggestion rules) and the reconstruction
char-array model are wire-format-independent and survive.

## IMPLEMENTATION.md §3.1 capture checklist (mirror)

- [ ] Exact 2026 JSON shape of `revisions/load`; `)]}'` present vs `batchexecute`.
- [ ] Operation codes present; required read headers (`X-Same-Domain`) or XSRF/`at`.
- [ ] Revision-count discovery mechanism and location.
- [ ] Per-call chunk size/latency and soft rate limits; how non-text structures appear.
- [ ] Credentialed fetch from MV3 SW + Firefox event page; SW termination behavior.
