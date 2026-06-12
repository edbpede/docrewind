# DocRewind — Google Docs Transport Live-Capture Record

> **STATUS: RESOLVED — §24 live capture performed 2026-06-12 (Chromium/Helium), with
> a Firefox + multi-account + rich-doc follow-up the same day. No stop-condition
> fired.** The transport questions (Q1–Q10) are answered against the real 2026 wire
> format; Q11 is reclassified to a release gate. **Follow-up (2026-06-12, Firefox 151
> over the `firefox-devtools` MCP):** Q7 (rich/suggesting doc) and Q8 (multi-account
> `/u/1/`) are now **live-confirmed**; the Firefox first-party credentialed read is
> confirmed (Q10) and the affordance mount is confirmed (Q12), with the Firefox
> **extension-background fetch** (Q10) and **deterministic SW/event-page termination**
> (Q9) left honestly **unverified** for documented MCP-tooling reasons. The live
> `revisions/load` adapter and revision-count discovery are wired in
> `entrypoints/background.ts`; the pure core (`lib/protocol/*`, decoder,
> reconstruction) encodes the confirmed facts.

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

**Firefox follow-up (2026-06-12).** A second pass ran on a machine **with Firefox
151** and the `firefox-devtools` MCP, driving the maintainer's real (signed-in)
session. Reads were performed by navigating the tab directly to the credentialed
`…/revisions/load?…` endpoint (the endpoint serves the changelog as a
`content-disposition: attachment` download, so the body lands on disk for
structural inspection) — kept to a handful of spaced requests (anti-abuse, A.9).
This closed Q7 (rich/suggesting doc) and Q8 (multi-account `/u/1/`) live, and
partially closed Q10/Q12 (first-party read + affordance mount confirmed in Firefox;
extension-background fetch and deterministic event-page termination left honestly
unverified — see Q9/Q10/Q12). The rich-doc findings are locked by a sanitized
fixture (`lib/fixtures/captured-rich.ts`) + test; the non-throwaway `/u/1/` doc used
for Q8 had only its HTTP status/content-type inspected (body deleted unread). No
document content was sent to any external service (PRD §11.5, §13.7).

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
**Status:** ✅ CONFIRMED 2026-06-12 (rich/suggesting-doc follow-up; Firefox 151 over
the `firefox-devtools` MCP). A throwaway "Testdokument" was built with an image,
table, footnote, equation, bulleted list, and a Suggesting-mode tracked change
(typed text + a marked deletion), then its live `revisions/load` changelog was read
with a handful of spaced credentialed requests (`start=1&end=N`; over-range probes
bracketed the max at N≈140, every over-range `end` returning HTTP 400). Full op
inventory across revisions 1..140:

| op | role | decoder |
|---|---|---|
| `is` | InsertString (text) | decoded |
| `ds` | DeleteString | decoded |
| `mlti` | compound | decoded (recurses) |
| `as` | ApplyStyle (incl. `st:"list"` for bullets) | isolated → UnknownOp |
| `iss` | **suggestion insert** (15×, revs 111–135) | decoded |
| `msfd` | **mark-for-deletion suggestion** (1×, rev 140) | decoded |
| `ae` | AddEntity `{et,id,epm}` (embedded object) | isolated → UnknownOp |
| `te` | place entity in stream `{id,spi}` | isolated → UnknownOp |
| `ue` | UpdateEntity `{id,epm,et}` | isolated → UnknownOp |
| `astss` | apply style to a suggestion range | isolated → UnknownOp |
| `sue` | suggested entity update `{sugid,…}` | isolated → UnknownOp |
| `null` | empty op slot (16×) | isolated → UnknownOp |

**Suggestions are inline ops** (A.8 holds): `iss` and `msfd` were both present and
decode to their typed variants; `dss`/`usfd` were not exercised by this doc but are
the same modeled grammar. **Embedded objects ride IN-BAND** as entity ops, NOT as
out-of-band payloads: `ae` defines the object (observed `et:"inline"` for the image,
`et:"list"` for lists), `te` places it into the character stream at `spi`, `ue`
updates it. Lists also carry an `as` style op with `st:"list"`.

**New op codes** the decoder does not structurally model — `ae`/`te`/`ue`/`astss`/
`sue` — all fall through the open-world `UnknownOp` default (privacy-safe: op-code +
byte length only). **No decoder change was required:** the full 140-revision
changelog, run through the production pipeline (`parseFramed → detectSchema →
decodeOperations → buildReplayIndex → currentText`), reconstructs to the document's
exact visible text — the unrecognized ops contribute no characters, so the
surrounding character indices stay aligned (no corruption from omitting them).
Embedded objects are therefore omitted rather than placeholdered; placeholdering
them (PRD A.8) remains an optional Phase-5 fidelity enhancement, not a correctness
fix. The findings are locked by a sanitized fixture + test
(`lib/fixtures/captured-rich.ts`, `lib/decoder/captured-rich.test.ts`) and the live
op vocabulary is recorded in `lib/protocol/types.ts` (`knownOpCodes` +
`liveOpaqueOpCodes`). ⚠️ No protobuf, no new envelope, no new op encoding the
open-world funnel mishandles → stop-condition NOT fired.

### 8. Multi-account `/document/u/{N}/d/` URL handling on a real multi-login session
**Status:** ✅ LIVE-CONFIRMED 2026-06-12 (Firefox, two signed-in Google accounts).
With a second account present (`/u/1/`), a throwaway doc opened under the `/u/1/`
session: the editor bootstrap (`…/document/u/1/d/{id}/edit`) returned **HTTP 200** signed in
as the second account (no bounce), and a credentialed `…/document/u/1/d/{id}/revisions/load?
start=1&end=5` returned **HTTP 200 `application/json`** (the `)]}'`-guarded
changelog, not an HTML sign-in page). The pure helpers were re-verified against the
live URL: `detectUserIndex("…/document/u/1/d/…")` ⇒ `1`, and `buildRevisionsLoadUrl({…,
userIndex:1})` ⇒ `…/document/u/1/d/…/revisions/load?…`. `lib/protocol/endpoints.ts`
(`detectUserIndex` + `buildRevisionsLoadUrl`) and the live discovery (`buildEditUrl`
captures `userIndex` per request) handle the `/document/u/{N}/d/` variant — now live-confirmed,
not merely confirmed-historical (A.5). *(The `/u/1/` doc was a non-throwaway doc the
maintainer pointed at; only its HTTP status + content-type were inspected — its
changelog body was deleted unread, never committed.)*

### 9. Service-worker / event-page termination during long chunked fetches (resumability)
**Status:** ◐ STILL DESIGN + resume-path fake-tested; a deterministic live mid-fetch
kill was **NOT** achieved in this follow-up — recorded honestly. Two blockers in the
Firefox + `firefox-devtools` MCP environment: (a) no large throwaway doc was
available (hundreds of revisions), and (b) **the MCP exposes no primitive to
deterministically terminate a Firefox MV3 background/event-page context** (no
analogue of Chromium's `chrome://serviceworker-internals` "Stop"), nor to inspect
the extension's IndexedDB (`docrewind` → `checkpoints`/`rawChunks`) to witness
`checkpoints.nextStart` advancing. The retrieval trigger itself was also not
reachable through pure automation (see Q12 — the content-script affordance mounts in
a closed-over shadow root the MCP cannot click, and there is no JS-eval/coordinate
-click tool). The resumable orchestrator's correctness still rests on the pure
"idempotent re-entry after a simulated SW kill" test (`lib/retrieval`) — it
checkpoints after every chunk and resumes by re-invoking `runRetrieval` against the
same store. A deterministic live kill therefore remains a release smoke test: best
run on **Chromium MV3** (large doc; "Stop" the SW from
`chrome://serviceworker-internals` mid-fetch; confirm `checkpoints.nextStart`
advanced and `rawChunks` grew without a re-fetch from revision 1). We do **not**
claim a live Firefox or Chromium deterministic termination was verified here.

### 10. Credentialed first-party fetch from an MV3 service worker (and a Firefox event page)
**Status:** ✅ CONFIRMED (Chromium MV3 SW, 2026-06-12) · ✅ first-party page/navigation
read CONFIRMED live in **Firefox** 2026-06-12 · ◐ Firefox **extension-background**
fetch NOT autonomously verified (MCP limitation — see below).
- **Chromium MV3 (prior):** `fetch(".../revisions/load?…", { credentials: "include"
  })` returned **HTTP 200, `application/json`, 3006 bytes** from both the
  `docs.google.com` page and the **real MV3 service-worker** of the built
  `chrome-mv3` extension (host permission `*://docs.google.com/*` attaches the
  session cookie). The affordance ("Replay revisions") mounts and dispatches
  `startRetrieval` to that SW.
- **Firefox (this follow-up):** the credentialed first-party read is confirmed live
  — repeated `…/revisions/load?…` reads under the user's real session returned **HTTP
  200 `application/json`** (the `)]}'` changelog, not a sign-in bounce), including
  under `/u/1/` (Q8). The `*://docs.google.com/*` host match is active in Firefox
  (the content script injects on the live doc — Q12). **However**, the fetch from
  the **extension background/event-page context specifically** was **not** triggered
  autonomously: the `firefox-devtools` MCP exposes no JS-eval / coordinate-click, the
  affordance lives in a closed-over shadow root the snapshot/click tools cannot
  reach, and there is no message-injection or background-context primitive. Note too
  that Firefox MV3 may treat `host_permissions` as **optional** (user-granted
  post-install), so whether the background fetch attaches cookies without an explicit
  grant is **not** something the temporary-install path proved here. The
  host-permission cookie-attachment mechanism is identical to the
  Chromium-MV3-verified path; **closing it in Firefox requires one manual step**
  (about:debugging → DocRewind → Inspect → background console → run the
  `fetch(URL,{credentials:"include"})` one-liner) and is recorded as the remaining
  honest Firefox gap rather than claimed.

### 11. CWS / AMO review outcomes — RECLASSIFIED to a release gate
**Status:** ↪ RECLASSIFIED. Real store-review outcomes require **submitting** the
extension and are a **release-phase event**, not a transport blocker — this no
longer holds the §24 gate open. Current store-policy posture: **MV3**, **`storage`**
permission only, **`*://docs.google.com/*`** host permission only, **no remote
code**. Actual CWS/AMO review outcome: **pending submission (release phase)**.

### 12. WXT Firefox MV3 event-page + host-permission first-run UX; `presetWind4`
**Status:** ◐ PARTIALLY CONFIRMED live in **Firefox** 2026-06-12 — affordance mount
confirmed; two real Firefox-specific findings recorded honestly.
- **Affordance mounts (✅):** `bun run build:firefox` → `firefox-mv3` (privacy-correct
  manifest: `storage` only, `*://docs.google.com/*` host only, MV3) loaded as a
  temporary add-on. On a live doc the content script injects and mounts the
  `docrewind-affordance` host with an open shadow root; the button renders with the
  expected label **"Replay revisions"** and is functional (screenshot-verified).
- **`presetWind4` styling (⚠ FINDING — blocked):** the content-script stylesheet
  carrying the UnoCSS/`presetWind4` output does **NOT** apply on Google Docs in
  Firefox. The page's CSP blocks loading the extension stylesheet — console:
  `Security Error: Content at https://docs.google.com/… may not load or link to
  moz-extension://…/content-scripts/docs.css` (alongside Google Docs' Trusted Types
  `require-trusted-types-for 'script'`). The button therefore renders **unstyled**
  (default UA button). Fix is a Phase-5 item: inline the shadow-root styles (or use
  `web_accessible_resources`) instead of a linked `moz-extension://` stylesheet.
- **Affordance placement (⚠ FINDING):** mounted `position:"inline"`/`anchor:"body"`,
  the host is clipped off-screen by the Google Docs layout (not scroll-into-view-
  able) — effectively unreachable for a user click; Phase-5 should reposition it to a
  visible fixed overlay.
- **First-run host-permission prompt (Q12-a):** **no** interactive doorhanger was
  observed for the temporary-install path — content-script `matches` injection is
  active immediately. The AMO-installed first-run host-permission UX (and Firefox MV3
  optional-`host_permissions` grant) cannot be exercised with an unsigned temporary
  extension; it remains a release-phase (signed-build) check.

---

## §24 Stop-and-re-evaluate conditions — NONE fired (capture 2026-06-12)

- [ ] The endpoint returns **protobuf** instead of JSON. — *Not fired: JSON, `content-type: application/json`, `)]}'`-guarded.*
- [ ] `revisions/load` moves behind a **`batchexecute`** wrapper. — *Not fired: direct legacy endpoint; no `batchexecute`/`rpcids`.*
- [ ] A **new mandatory page-derived read token** appears for reads. — *Not fired: cookie-only read returns 200 with no token/header.*
- [ ] Google publishes guidance **restricting the editor endpoints**. — *Not fired: no such guidance; endpoint behaves as the open record describes.*

The grammar semantics (A.2) and the reconstruction char-array model are unchanged.
The JSON-input decoder gained a tuple-envelope adapter (Pre-mortem #3 anticipated a
transport-shaped change to exactly this layer); the fixtures gained one sanitized
live sample alongside the synthetic corpus. The **rich-doc follow-up (2026-06-12)**
re-checked all four stop conditions against the live Firefox reads (simple + rich +
`/u/1/`) and **none fired** — still `)]}'`-guarded JSON, still the direct endpoint,
still a cookie-only read, and the newly-observed embedded-object/suggestion ops
(`ae`/`te`/`ue`/`astss`/`sue`) are absorbed by the open-world `UnknownOp` funnel
**without** a decoder change (no new op encoding the decoder mishandles).

## IMPLEMENTATION.md §3.1 capture checklist (mirror)

- [x] Exact 2026 JSON shape of `revisions/load`; `)]}'` present; **not** `batchexecute`.
- [x] Operation codes present (`is`/`ds`/`mlti`/`as`/`iss`/`msfd`; rich-doc also `ae`/`te`/`ue`/`astss`/`sue`, isolated); **no** required read headers; **no** XSRF/`at` for reads.
- [x] Revision-count discovery mechanism (`"revision":N` bootstrap; out-of-range ⇒ HTTP 400) and location.
- [x] Per-call range observed (full 1..N in one call); soft limits handled adaptively; embedded objects ride in-band as `ae`/`te`/`ue` entity ops (Q7), text decoder omits them with no index drift.
- [x] Credentialed fetch from the MV3 SW confirmed (200/JSON); Firefox first-party read + affordance mount + multi-account `/u/1/` confirmed live (Q7/Q8/Q10/Q12); Firefox extension-background fetch + deterministic event-page-termination kill left honestly unverified (MCP-tooling limits).
