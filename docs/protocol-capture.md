# DocRewind — Google Docs Transport Live-Capture Record

> **STATUS: RESOLVED — §24 live capture performed 2026-06-12. No stop-condition
> fired.** The transport questions (Q1–Q10) are answered against the real 2026
> wire format; Q11 is reclassified to a release gate; Q8/Q9/Q12 are code-ready with
> their live verification scoped honestly below. The live `revisions/load` adapter
> and revision-count discovery are wired in `entrypoints/background.ts`; the pure
> core (`lib/protocol/*`, decoder, reconstruction) encodes the confirmed facts.

## How this capture was performed

Authenticated capture against a **throwaway** Google Doc using the maintainer's
own first-party `docs.google.com` session, driven over the Chrome DevTools
Protocol in **Helium 149** (a Chromium-149 fork) via `agent-browser`. Each finding
was taken by replaying `fetch(url, { credentials: "include" })` from inside the
`docs.google.com` page context (cookies first-party) and, for Q10, from inside the
**built extension's MV3 service-worker context**. Response bodies were inspected
**structurally** and the one committed fixture (`lib/fixtures/captured.ts`) is
**sanitized** (session/user ids + timestamps redacted; the op text is the
maintainer's own throwaway filler). No document content was sent to any external
service (PRD §11.5, §13.7).

Firefox-specific items (Q12 live UX, Q10 Firefox event page) could not be run:
**Firefox is not installed in the capture environment** — the `firefox-mv3` build
is verified instead, and the live Firefox checks are scoped as a follow-up below.

---

## The 12 §24 transport questions

### 1. Exact 2026 JSON shape of `revisions/load` + `)]}'` prefix presence
**Status:** ✅ CONFIRMED 2026-06-12.
`GET …/document/d/{id}/revisions/load?id={id}&start=1&end={N}` returns **HTTP 200,
`content-type: application/json`**, body **prefixed with the `)]}'` guard line**
(A.3 holds). The top-level payload is an **object** `{ chunkedSnapshot, changelog }`:
- `changelog` — the operation array. Each entry is a **9-element positional TUPLE**
  `[ op, time(ms), sessionId, revisionId, userId, …, false ]`. The op dict carries
  the `ty` discriminator (e.g. `{ ty:"is", s, ibi }`).
- `chunkedSnapshot` — the base-document state at `start` (style scaffolding; empty
  text at `start=1`); ignored by the text decoder.

`lib/protocol/schema-detect.ts` keys on the `changelog` array, so it already
recognizes this shape (the sibling `chunkedSnapshot` is irrelevant to detection) —
**no change required**. The synthetic corpus had modeled each entry as a flat
object, so the decoder gained a **tuple-envelope adapter**
(`lib/decoder/decode.ts#normalizeEntry`) that lifts `op`/`revisionId`/`userId`/
`sessionId`/`time` out of the tuple; it still accepts the flat-object fixture shape.
⚠️ JSON, **not protobuf** → stop-condition NOT fired.

### 2. Legacy endpoint vs. `batchexecute` / `rpcids` wrapper
**Status:** ✅ CONFIRMED 2026-06-12. The editor bootstrap contains **no
`batchexecute` and no `rpcids`**, and the direct `…/revisions/load?…` endpoint
returns JSON as above. ⚠️ **No `batchexecute` wrapper → stop-condition NOT fired.**

### 3. Required custom read header (e.g. `X-Same-Domain`)
**Status:** ✅ CONFIRMED 2026-06-12. A plain `fetch(url, { credentials: "include" })`
with **no custom headers** returns 200. `X-Same-Domain` is **not required** for the
read. → `TransportConstants.requiredReadHeaders = []`.

### 4. XSRF / `at` token requirement for reads + bootstrap origin
**Status:** ✅ CONFIRMED 2026-06-12. The read needs **only the session cookie** — no
XSRF/`at`/page-derived token. (A 42-char `"token"` exists in the bootstrap but the
read returns 200 **without** it.) → `TransportConstants.readTokenRequired = false`.
⚠️ **No new mandatory page-derived read token → stop-condition NOT fired.**

### 5. Current-revision-count discovery mechanism + location
**Status:** ✅ CONFIRMED 2026-06-12. The editor bootstrap (`…/document/d/{id}/edit`)
publishes the current count as **`"revision":N`** (observed N=2, then N=4 after two
edits — it tracks the max). Out-of-range `end` now returns **HTTP 400** (the 2014
teardown saw 500); in-range `end` returns 200; `end=-1` is rejected (400). Implemented
**metadata-primary** (one bootstrap read — gentlest, A.9) with a **binary-search on
the in-range(200)/over(400) boundary** fallback. → `discovery.ts` strategy
`revision-count-metadata`; the literal `binary-search-http-400` replaces the stale
`…-500`.

### 6. Sane chunk sizes and any soft rate limits
**Status:** ◐ PARTIAL (defaults retained; not stress-tested by design). The editor
does **not** call `revisions/load` during normal editing (it is a Draftback-style
explicit call), so there is no editor per-call size to mirror. A single call
returned the full `1..4` range cleanly. Larger ranges were **not** stress-tested
(anti-abuse, A.9). `DEFAULT_CHUNK_SIZE = 100` is retained; the orchestrator's
**adaptive shrink-on-failure** (which now also fires on a 400) plus exponential
backoff absorb undocumented soft limits without a tight loop.

### 7. Non-text structures + suggestion ops
**Status:** ◐ PARTIAL — text/style ops live-confirmed; suggestions + embedded
objects scoped as a rich-doc follow-up. Live op inventory on the simple doc:
**`is`** (InsertString `{ s, ibi }` — matches A.2 exactly; a 20-char insert decoded
1:1), **`mlti`** (compound; revision 1 wraps document/heading setup), and **`as`**
(ApplyStyle — the A.2 "secondary" style op). `as` carries no body text, so the text
decoder **isolates it via the open-world `UnknownOp` path** (verified in
`lib/decoder/captured-live.test.ts`). Suggestions (`iss`/`dss`/`msfd`/`usfd`) and
embedded objects (image/table/footnote/equation/list) were **not** present on this
simple doc; they remain **source-confirmed grammar** (Appendix A.2/A.8) that the
decoder already handles (suggestions) or placeholders (`OpaquePlaceholder`). A
live capture of a rich/suggesting doc is the recommended follow-up to fully close.

### 8. Multi-account `/u/{N}/` URL handling on a real multi-login session
**Status:** ◐ CODE-READY; live `/u/1/` not verified (no second account in the
capture environment). `lib/protocol/endpoints.ts` (`detectUserIndex` +
`buildRevisionsLoadUrl`) and the live discovery (`buildEditUrl` captures
`userIndex` per request) handle the `/u/{N}/` variant and are unit-tested.
Confirmed-historical (A.5); live multi-account verification deferred.

### 9. Chromium service-worker termination during long chunked fetches (resumability)
**Status:** ◐ Design + resume path fake-tested; deterministic mid-fetch kill not
run. The resumable orchestrator checkpoints **after every chunk** and resumes by
re-invoking `runRetrieval` against the same checkpoint store — exercised by the
"idempotent re-entry after a simulated SW kill" pure test. The throwaway doc is
tiny (4 revisions → retrieval is instantaneous), so there is **no mid-fetch window**
to interrupt deterministically. Recommended release smoke test: a large doc, kill
the SW from `chrome://serviceworker-internals` mid-fetch, confirm resume.

### 10. Credentialed first-party fetch from an MV3 service worker (and a Firefox event page)
**Status:** ✅ CONFIRMED 2026-06-12 (Chromium MV3 SW); Firefox event page deferred.
`fetch(".../revisions/load?…", { credentials: "include" })` returned **HTTP 200,
`application/json`, 3006 bytes** from **two** contexts: (a) the `docs.google.com`
page, and (b) the **real MV3 service-worker** of the built `chrome-mv3` extension
loaded in Chromium (host permission `*://docs.google.com/*` attaches the session
cookie). The content-script affordance ("Replay revisions") mounts on a live doc
and dispatches `startRetrieval` to that SW. The **Firefox** event-page context was
not run (Firefox not installed); the mechanism is identical (host-permission cookie
attachment) and is the recommended Firefox smoke test.

### 11. CWS / AMO review outcomes — RECLASSIFIED to a release gate
**Status:** ↪ RECLASSIFIED. Real store-review outcomes require **submitting** the
extension and are a **release-phase event**, not a transport blocker — this no
longer holds the §24 gate open. Current store-policy posture: **MV3**, **`storage`**
permission only, **`*://docs.google.com/*`** host permission only, **no remote
code**. Actual CWS/AMO review outcome: **pending submission (release phase)**.

### 12. WXT Firefox MV3 event-page + host-permission first-run UX; `presetWind4`
**Status:** ◐ Build verified; live Firefox UX deferred (Firefox not installed).
`bun run build:firefox` produces `firefox-mv3` with the privacy-correct manifest
(`storage` only, `*://docs.google.com/*` host only, MV3). The live first-run
host-permission prompt and `presetWind4` render against the real component set
require a Firefox-available environment (`web-ext run`) and are deferred there.

---

## §24 Stop-and-re-evaluate conditions — NONE fired (capture 2026-06-12)

- [ ] The endpoint returns **protobuf** instead of JSON. — *Not fired: JSON, `content-type: application/json`, `)]}'`-guarded.*
- [ ] `revisions/load` moves behind a **`batchexecute`** wrapper. — *Not fired: direct legacy endpoint; no `batchexecute`/`rpcids`.*
- [ ] A **new mandatory page-derived read token** appears for reads. — *Not fired: cookie-only read returns 200 with no token/header.*
- [ ] Google publishes guidance **restricting the editor endpoints**. — *Not fired: no such guidance; endpoint behaves as the open record describes.*

The grammar semantics (A.2) and the reconstruction char-array model are unchanged.
The JSON-input decoder gained a tuple-envelope adapter (Pre-mortem #3 anticipated a
transport-shaped change to exactly this layer); the fixtures gained one sanitized
live sample alongside the synthetic corpus.

## IMPLEMENTATION.md §3.1 capture checklist (mirror)

- [x] Exact 2026 JSON shape of `revisions/load`; `)]}'` present; **not** `batchexecute`.
- [x] Operation codes present (`is`/`mlti`/`as`); **no** required read headers; **no** XSRF/`at` for reads.
- [x] Revision-count discovery mechanism (`"revision":N` bootstrap; out-of-range ⇒ HTTP 400) and location.
- [x] Per-call range observed (full 1..N in one call); soft limits handled adaptively; non-text via `as`/opaque.
- [x] Credentialed fetch from the MV3 SW confirmed (200/JSON); Firefox event-page + SW-termination kill scoped as release smoke tests.
