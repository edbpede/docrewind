# DocRewind — Implementation Plan

A developer-facing execution checklist that turns `docs/docrewind-prd.md` into a linear, checkable sequence of tasks. Read the PRD first, then the coding playbook at `.augment/rules/bun-solid-pro.md`, then start here.

## 1. Document Purpose & How To Use This Plan

This document is a **task checklist**, not a spec. It exists so a contributor can pick up DocRewind, work top-to-bottom through the phases, and ship a v1.0.0 release without inventing structure that has already been decided.

What this document is:

- An ordered task tree for every phase of the PRD
- The single source of truth for execution sequence and verification gates
- The place where open questions are resolved with dated decisions

What this document is NOT:

- A product specification (that's `docs/docrewind-prd.md`)
- A coding standard (that's `.augment/rules/bun-solid-pro.md`)
- An architecture document (PRD §10 covers that; `docs/ARCHITECTURE.md` will summarize in Phase 4)

**Order of authority when documents disagree:** PRD > playbook > this plan > inline code comments. If you find a conflict, fix the lower-priority document, not the higher one.

**How to work the plan:** Pick the lowest-numbered open `[ ]` task whose dependencies are satisfied, set it to `[~]` in the same commit that begins the work, complete it under the verification rules in §2.4, and mark it `[x]` in the merge commit. If a task is no longer needed, mark it `[-]` with a one-line rationale appended on the same line.

## 2. Source Material & Conventions

### 2.1 Authoritative sources

- Product requirements: `docs/docrewind-prd.md`
- Coding playbook (Bun + Solid + UnoCSS + WebExtensions): `.augment/rules/bun-solid-pro.md`
- License: `LICENSE` (AGPL v3)

When this plan disagrees with the PRD or playbook, the PRD and playbook win. This plan is the execution sequence; it does not redefine requirements or coding standards.

### 2.2 Checkbox semantics

- `- [ ]` open, not started
- `- [~]` in progress (one author at a time; mention in commit body)
- `- [x]` done, verified
- `- [-]` cancelled — append a one-line rationale on the same task

### 2.3 Commit conventions

Conventional Commits, subsystem-scoped:

- `feat(retrieval): chunked range fetcher`
- `fix(reconstruct): tolerate unknown op type without aborting batch`
- `chore(repo): wxt config + Firefox build target`

Reference the plan task path (e.g. `§4.4`) in the commit body when applicable.

### 2.4 Verification expectations

A task is `[x]` only when:

1. Type-check passes: `bun run typecheck`
2. Tests pass: `bun test`
3. Build passes for both targets: `bun run build` (Chromium) and `bun run build:firefox`
4. Any new manifest field is documented in `docs/permissions.md`
5. The phase Verification block at the bottom of the section has been walked through manually

### 2.5 Tooling we deliberately do NOT adopt (yet)

Per the playbook ("Do not invent linters, formatters, test runners, routers, validation libraries, component libraries, extension helper frameworks not already present"):

- No linter (ESLint, Biome, Oxlint)
- No formatter (Prettier, dprint, Biome format)
- No test runner other than `bun test` for unit work; Playwright is added in Phase 2 for cross-browser E2E only
- No Vitest, no Jest
- No CSS framework other than UnoCSS `presetWind4()`
- No state management library beyond Solid primitives (`createSignal`, `createStore`, `createMemo`, `createResource`)
- No component library; primitives are written locally and styled with Uno shortcuts
- No router (the extension does not need one; options page is a single Solid app)

Reopen any of these in Phase 4 if contributors request; do not silently add.

### 2.6 High-signal anti-patterns to reject on sight

Lifted from the playbook because they recur:

- React hooks (`useState`, `useEffect`, `useMemo`, `useCallback`) in `.tsx` files — use Solid primitives
- Top-level prop destructuring (`const { x } = props`) or cached props (`const x = props.x`) — breaks reactivity; use `props.x`, `splitProps`, or accessor wrappers
- Effects that mirror derived state — use `createMemo` or inline derivation
- Direct store mutation (`state.foo.bar = 1`) — use `setStore(...)` or `produce(...)`
- Template-built Uno class names (`` `bg-${tone}-500` ``) — use static maps, `shortcuts`, or `safelist`
- Wind3/Tailwind theme keys in `presetWind4` config (`fontFamily`, `borderRadius`, `boxShadow`, `breakpoints`) — use the Wind4 keys (`font`, `radius`, `shadow`, `breakpoint`)
- `localStorage` for shared extension state — use `chrome.storage.local`
- `setTimeout`/`setInterval` for work that must survive background suspension — use `chrome.alarms`
- Manifest V2, `browser_action`, `page_action`, `extension.getURL()` — MV3 `action` and `runtime.getURL()` only
- Bare `<all_urls>` host permissions — `activeTab` first, `optional_host_permissions` second
- `Bun` globals in shared/browser modules — guard with `process.versions.bun` or keep Bun-only code in `scripts/`
- Multiple ad-hoc `chrome.runtime.onMessage` listeners — one typed dispatcher per context, `return true` for async
- Hand-edited `bun.lock` or multiple lockfiles — Bun-managed updates only
- Any analytics, crash reporter, third-party tracker, or remote-feature-flag dependency — banned by PRD §9.9, §13

## 3. Phase 0 — Research Prototype

**Goal:** Validate that we can retrieve and decode enough Google Docs revision data to reconstruct a simple single-author document. Produce sanitized fixtures and a written summary of what is and is not feasible.

**Entry criteria:** Repo has only PRD, playbook, license, gitignore.

**Exit criteria:** A captured fixture set, a passing parser unit test that reads one fixture and emits a typed operation stream, and a written feasibility note in `docs/phase-0-findings.md`.

### 3.1 Scaffolding (one-time, reused by all later phases)

- [ ] Initialize Bun project with `bun init` and discard the generated `index.ts`
  - [ ] Create `package.json` with `"type": "module"`, `"private": true`, and Bun engines pin
  - [ ] Add `"license": "AGPL-3.0-or-later"` and `"repository"` fields
  - [ ] Commit `bun.lock` after first `bun install`
- [ ] Add WXT as the extension framework
  - [ ] `bun add -d wxt` and the Solid integration `bun add -d @wxt-dev/module-solid`
  - [ ] Create `wxt.config.ts` with `modules: ['@wxt-dev/module-solid']`, `manifest` block with `name: "DocRewind"`, `permissions: ['storage', 'activeTab']`, no `host_permissions` yet
  - [ ] Configure `outDir: '.output'`, two build targets: default Chromium and `--browser firefox`
  - [ ] Add `browser_specific_settings.gecko.id` placeholder `docrewind@docrewind.dev`
- [ ] Configure TypeScript per the playbook
  - [ ] Create `tsconfig.json` with `jsx: "preserve"`, `jsxImportSource: "solid-js"`, `strict: true`, `module: "preserve"`, `moduleResolution: "bundler"`, `verbatimModuleSyntax: true`, `isolatedModules: true`, `noEmit: true`, `lib: ["es2025", "dom"]`, `types: []`
  - [ ] Create `tsconfig.bun.json` extending the base for `scripts/**` with `types: ["bun"]`
  - [ ] Add `typecheck` script: `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.bun.json --noEmit`
- [ ] Configure UnoCSS
  - [ ] `bun add -d unocss @unocss/preset-wind4`
  - [ ] Create `uno.config.ts` exporting `defineConfig({ presets: [presetWind4({ preflights: { reset: true } })] })`
  - [ ] Add an empty `shortcuts` block with one example (`btn`) to anchor the convention
  - [ ] Wire UnoCSS into WXT via its Vite plugin in `wxt.config.ts`
- [ ] Solid dependency
  - [ ] `bun add solid-js`
  - [ ] Verify the Solid version is on 1.x stable (not 2.x preview)
- [ ] Repository hygiene
  - [ ] Add `.gitignore` entries for `.output/`, `.wxt/`, `node_modules/`, `*.log`, `fixtures/raw/` (private capture area)
  - [ ] Create top-level directories: `entrypoints/`, `components/`, `composables/`, `lib/`, `lib/domain/`, `lib/messaging/`, `lib/storage/`, `lib/retrieval/`, `lib/decoder/`, `lib/reconstruction/`, `lib/timeline/`, `tests/`, `tests/fixtures/`, `scripts/`
  - [ ] Add a one-line `README.md` placeholder pointing at PRD and this plan
- [ ] Verification of scaffolding
  - [ ] `bun install --frozen-lockfile` succeeds
  - [ ] `bun run typecheck` succeeds on an empty project
  - [ ] `bunx wxt build` produces a Chromium zip
  - [ ] `bunx wxt build --browser firefox` produces a Firefox zip
  - [ ] Load both unpacked in their browsers; no console errors, no permissions yet

### 3.2 Revision retrieval probe (behind a debug entrypoint)

- [ ] Create a debug-only content script `entrypoints/probe.content.ts` matching `https://docs.google.com/document/d/*`
  - [ ] Guard with `if (import.meta.env.WXT_DEV)` so it never ships in a release build
  - [ ] Extract the document ID from the URL using `lib/docs/parse-doc-url.ts` (also added as a pure function with a unit test)
- [ ] Identify the revision endpoint shape
  - [ ] In `docs/phase-0-findings.md`, document the request URL pattern, required headers, response framing (XSSI prefix if present), and chunking parameters
  - [ ] Never paste real document content into this file; sanitize all examples
- [ ] Implement a one-shot fetch to retrieve one revision chunk for an authenticated user
  - [ ] Use the page-session credentials (cookie jar implicit in `fetch` from the content script context where applicable, or from background with the correct origin)
  - [ ] Stream the response to console (dev-only) and into the capture script (next task)
- [ ] Implement the fixture capture script `scripts/capture-fixture.ts` (Bun-runnable)
  - [ ] Accept a path to a JSON dump produced by the probe
  - [ ] Run a redaction pass that strips author email addresses, replaces inserted text with a length-preserving Latin filler, and zeroes any `userId`-style fields
  - [ ] Emit `tests/fixtures/<slug>.fixture.json` with a `metadata` block declaring redaction policy version
  - [ ] Add a unit test that asserts the redacted fixture contains no email-like substrings and no non-ASCII characters
- [ ] Capture three fixtures
  - [ ] Single-author short document (~10 revisions)
  - [ ] Single-author medium document (~100 revisions)
  - [ ] Two-author short document (~30 revisions, mixed authors)

### 3.3 Minimal parser & reconstruction proof

- [ ] Define skeletal domain types in `lib/domain/types.ts`
  - [ ] `DocumentId`, `RevisionRange`, `RawPayload`, `DecodedRevision`, `DocumentOperation`, `DocumentState` (text-only for now)
  - [ ] Mark these as Phase-0 narrow versions; full definitions land in §4.1
- [ ] Implement `lib/decoder/decode-revision.ts`
  - [ ] Handle text-insert and text-delete operation types
  - [ ] Skip-and-log unknown operation types (do not throw)
  - [ ] Export a `DecodeResult` discriminated union with `ok | unsupported | malformed`
- [ ] Implement `lib/reconstruction/apply.ts`
  - [ ] Pure function: `(state, op) => state` operating on a `DocumentState` containing a single text buffer
  - [ ] No browser API dependencies (verify by checking nothing imports `chrome`, `browser`, or DOM types)
- [ ] Write fixture-driven tests in `tests/decoder.test.ts` and `tests/reconstruction.test.ts`
  - [ ] For each fixture, decoding produces a non-empty operation stream
  - [ ] For each fixture, reconstruction produces a final text state that matches the fixture's recorded final-text snapshot
  - [ ] Reconstruction is deterministic across two runs

### 3.4 Phase 0 deliverables

- [ ] Write `docs/phase-0-findings.md` covering:
  - [ ] Confirmed retrieval mechanism and any auth/header requirements
  - [ ] Response framing details (sanitized)
  - [ ] Operation types observed and which are supported, partially supported, or unsupported
  - [ ] Risks for Phase 1 (chunking limits, rate limits, multi-author edge cases)
  - [ ] Estimated storage size per revision for cache planning
- [ ] Delete or hide the probe entrypoint behind a build flag before Phase 1
- [ ] Tag `phase-0-complete` in git

### 3.5 Phase 0 verification

- [ ] `bun test` green
- [ ] `bun run typecheck` green
- [ ] `bunx wxt build` green for both targets
- [ ] Fixture redaction test passes
- [ ] No real document content committed (manual grep + `git log -p` review)
- [ ] `docs/phase-0-findings.md` peer-reviewed (or self-reviewed against PRD §22 risks)

## 4. Phase 1 — Local Replay MVP

**Goal:** Ship a usable Chromium build that lets a user open a Google Doc, activate the extension, watch a replay of the document being written, and manage the local cache. Firefox build is produced but real-browser validation is deferred to Phase 2.

**Entry criteria:** Phase 0 complete; at least three fixtures available; parser handles text-insert and text-delete.

**Exit criteria:** A loadable Chromium build that performs the end-to-end flow on documents matching the fixture profile, with persisted cache, keyboard-navigable replay UI, and a working clear-cache surface.

### 4.1 Domain model (`lib/domain/`)

- [ ] Define the full typed domain in `lib/domain/types.ts` per PRD §10.5
  - [ ] `Document` — `{ id, title?, observedAt }`
  - [ ] `RevisionRange` — `{ requestedStart, requestedEnd, receivedStart, receivedEnd }`
  - [ ] `RawPayload` — `{ range, bytes, retrievedAt, schemaVersion }`
  - [ ] `DecodedRevision` — `{ sourceRange, operations: DocumentOperation[], approxTime, authorId? }`
  - [ ] `DocumentOperation` — discriminated union: `insert | delete | structural | unsupported`, with `affectedRange` and optional `insertedContent`
  - [ ] `DocumentState` — text buffer + structural metadata placeholder
  - [ ] `TimelineEvent` — `{ kind, startedAt, endedAt, confidence, provenance }`
  - [ ] `PlaybackSession` — `{ documentId, cursor, speed, status }`
  - [ ] `CacheRecord` — `{ documentId, createdAt, lastAccessedAt, parserVersion, sizeBytes, status }`
  - [ ] `DiagnosticReport` — environment block + opt-in payload block
- [ ] Define error categories in `lib/domain/errors.ts` per PRD §10.7
  - [ ] One discriminated union `DomainError` covering all categories
  - [ ] Each variant carries `userMessage`, `category`, `recoverable: boolean`, `suggestedAction`
  - [ ] Helper `toUserError(error: unknown): DomainError` that NEVER includes raw response bodies
- [ ] Export a `PARSER_VERSION` constant from `lib/domain/version.ts`

### 4.2 Messaging contracts (`lib/messaging/`)

- [ ] Define `lib/messaging/contract.ts` with `Request`, `Response`, and `Event` discriminated unions
  - [ ] Request types: `ACTIVATE_DOCUMENT`, `GET_REPLAY_STATE`, `START_REPLAY`, `CONTROL_REPLAY`, `LIST_CACHE`, `CLEAR_CACHE_FOR_DOC`, `CLEAR_ALL_CACHE`, `GET_SETTINGS`, `SET_SETTINGS`
  - [ ] Event types (background → content/panel): `RETRIEVAL_PROGRESS`, `RECONSTRUCTION_PROGRESS`, `REPLAY_READY`, `DOMAIN_ERROR`
  - [ ] Enforce JSON-safety (no functions, no class instances, no `Date` — use ISO strings)
- [ ] Implement a single typed dispatcher per context
  - [ ] `lib/messaging/background-dispatcher.ts` registers one `runtime.onMessage` listener, switches on `message.type`, returns `true` for async
  - [ ] `lib/messaging/panel-dispatcher.ts` posts requests and awaits typed responses; rejects on shape mismatch
  - [ ] Helper `assertRequest(message): asserts message is Request` to validate inbound shape
- [ ] Add a messaging test
  - [ ] `tests/messaging.test.ts` verifies the dispatcher handles every Request variant exhaustively (compile-time check via `never` exhaustiveness)

### 4.3 Persistence layer (`lib/storage/`)

- [ ] Design IndexedDB schema in `lib/storage/schema.ts`
  - [ ] Database name: `docrewind`, version: `1`
  - [ ] Object stores: `documents` (keyPath `id`), `rawChunks` (keyPath `[documentId, rangeStart]`), `decodedChunks` (keyPath `[documentId, rangeStart]`), `snapshots` (keyPath `[documentId, opIndex]`), `timelineIndex` (keyPath `documentId`), `cacheMeta` (keyPath `documentId`)
  - [ ] Indexes for `lastAccessedAt` on `cacheMeta` to support LRU pruning
- [ ] Implement `lib/storage/db.ts` as a thin promise-wrapper over `indexedDB`
  - [ ] `openDb(): Promise<IDBDatabase>` with `onupgradeneeded` running migrations
  - [ ] All reads/writes are typed against the schema; no untyped object stores in app code
  - [ ] Provide an `InMemoryStorage` implementation behind the same interface for tests (per PRD §10.2)
- [ ] Implement `lib/storage/migrations.ts`
  - [ ] Migration v0 → v1 creates initial stores
  - [ ] Scaffolding for v1 → v2 (left as `TODO` with a one-line example for Phase 2)
- [ ] Implement `lib/storage/cache-meta.ts`
  - [ ] `putCacheMeta`, `getCacheMeta`, `listCacheMeta`, `deleteForDocument`, `deleteAll`
  - [ ] `estimateUsage(): Promise<{ bytes: number, documents: number }>` using `navigator.storage.estimate()` plus per-record size sums
- [ ] Settings storage in `lib/storage/settings.ts`
  - [ ] Uses `chrome.storage.local` (per playbook), NEVER `localStorage`
  - [ ] Typed get/set with defaults; covered by a unit test using a mocked storage shim
- [ ] Storage tests
  - [ ] `tests/storage.test.ts` covering put/get round-trips, migration v0→v1, LRU pruning, in-memory implementation parity
  - [ ] Property test: writing a chunk and reading it back is byte-identical
  - [ ] No document content leaks into thrown error messages (assert via regex)

### 4.4 Revision retrieval (`lib/retrieval/`)

- [ ] Implement document-context discovery in `lib/retrieval/discover.ts`
  - [ ] Parse the document ID from the URL (reuse Phase 0 helper)
  - [ ] Detect Docs editor vs preview vs unsupported Workspace page
  - [ ] Return a `DocumentContext` or a typed `unsupported` error
- [ ] Implement chunked retrieval in `lib/retrieval/fetch-ranges.ts`
  - [ ] AbortSignal-driven cancellation
  - [ ] Retry with exponential backoff for transient network errors; no retry for permission errors
  - [ ] Emit `RETRIEVAL_PROGRESS` events with `(receivedRanges, estimatedTotal)`
  - [ ] Persist each chunk to `rawChunks` as it arrives so progress survives interruptions
- [ ] Implement the orchestrator in `lib/retrieval/orchestrator.ts`
  - [ ] Coordinates discovery → range planning → fetch → persistence
  - [ ] Exposes a single async generator `retrieveAll(documentId, signal): AsyncGenerator<Progress>`
  - [ ] Reads existing cache and resumes from the last received range
- [ ] Retrieval tests
  - [ ] `tests/retrieval.test.ts` with `fetch` mocked: chunked happy path, mid-stream cancel, retry on 5xx, no-retry on 401
  - [ ] No `chrome.*` or `browser.*` imports in retrieval modules; this layer is browser-agnostic except for `fetch` and `AbortController` (per PRD §10.2)
  - [ ] No raw response body appears in any thrown error

### 4.5 Decoder (`lib/decoder/`)

- [ ] Expand Phase 0 decoder to handle the MVP operation set
  - [ ] text-insert, text-delete, paragraph-break, line-style markers if observed in fixtures
  - [ ] Unknown operation types become `DocumentOperation` of kind `unsupported` with the raw type recorded but no payload
- [ ] Add `lib/decoder/normalize.ts`
  - [ ] Strips XSSI prefix if Phase 0 found one
  - [ ] Validates payload shape before passing into the per-op decoder
- [ ] Decoder tests
  - [ ] Each fixture decodes to a deterministic operation stream
  - [ ] Snapshot tests for the operation stream of each fixture (committed to `tests/__snapshots__/`)
  - [ ] Unknown-op tolerance: a synthetic fixture with an injected unknown op continues parsing the surrounding ops

### 4.6 Reconstruction (`lib/reconstruction/`)

- [ ] Implement the reconstruction engine in `lib/reconstruction/engine.ts`
  - [ ] Pure functional core: `(state, op) => state`
  - [ ] No DOM, no `chrome.*`, no `browser.*` imports (enforced by a test that greps imports)
  - [ ] Internal text buffer: start with a simple string; flag a TODO for a piece-table or rope upgrade in Phase 2 if profiling demands it
- [ ] Implement snapshotting in `lib/reconstruction/snapshots.ts`
  - [ ] Take a snapshot every N operations (configurable, default 200)
  - [ ] Store as `snapshots` in IndexedDB keyed by `[documentId, opIndex]`
  - [ ] `restoreNearest(opIndex): Promise<{ state, fromOpIndex }>` for fast scrubbing
- [ ] Implement the streaming reconstructor in `lib/reconstruction/stream.ts`
  - [ ] Consumes a decoded-op stream, emits `RECONSTRUCTION_PROGRESS` events
  - [ ] Yields control to the event loop every K operations to avoid freezing (PRD §18)
- [ ] Reconstruction tests
  - [ ] Determinism: applying the same op stream twice yields identical states
  - [ ] Snapshot correctness: jumping to op N via snapshot equals replaying from 0 to N
  - [ ] In-memory storage works as a drop-in (per PRD §10.2)

### 4.7 Timeline generation (`lib/timeline/`)

- [ ] Implement basic timeline derivation in `lib/timeline/derive.ts`
  - [ ] Group adjacent ops by time gap into "activity bursts"
  - [ ] Emit `TimelineEvent` of kind `activity_burst | pause | replay_marker` (insight kinds land in §6)
  - [ ] Carry `confidence: 'observed' | 'inferred'` per PRD §10.5
- [ ] Persist timeline index to `timelineIndex` store
- [ ] Timeline tests
  - [ ] Fixture-driven: each fixture produces a stable timeline
  - [ ] Pause threshold tuning is a parameter, not a magic number; test covers both values

### 4.8 Extension shell & entrypoints

- [ ] Background entrypoint `entrypoints/background.ts`
  - [ ] Register the message dispatcher
  - [ ] Coordinate task lifecycle for an active document (one task at a time in Phase 1)
  - [ ] Restore in-flight state from `storage.local` on wake (Chromium SW termination, Firefox event page non-persistent)
  - [ ] Use `chrome.alarms` if any deferred work is scheduled, NOT `setTimeout` for cross-suspend work
- [ ] Content entrypoint `entrypoints/docs.content.ts`
  - [ ] `matches: ['https://docs.google.com/document/d/*']`
  - [ ] `runAt: 'document_idle'`
  - [ ] Detect the document via discovery helper; do nothing until activated
  - [ ] Insert the activation button (small, unobtrusive — PRD §8.2) into the page in a way that survives Google Docs DOM reflows (re-mount on `MutationObserver` if removed, throttle the observer)
  - [ ] Activation button is keyboard-focusable, has an accessible name, and is reachable via `Tab`
- [ ] Options entrypoint `entrypoints/options.html` + `entrypoints/options/main.tsx`
  - [ ] Mount a Solid app at `#root` with `render(() => <Options />, root)` (note: function, not element)
  - [ ] Render the privacy summary (PRD §8.1, §9.9), cache list, per-doc and clear-all controls, storage estimate
  - [ ] Render the first-run welcome surface when `settings.firstRunSeen === false`
- [ ] Manifest fields in `wxt.config.ts`
  - [ ] `manifest_version: 3`
  - [ ] `action.default_title: "DocRewind"` (no popup in Phase 1; activation is in-page)
  - [ ] `permissions: ['storage', 'activeTab']`
  - [ ] `host_permissions: ['https://docs.google.com/*']` (required for retrieval from background)
  - [ ] `browser_specific_settings.gecko.id`
  - [ ] Dual background declaration (WXT handles this when both `background.type: 'module'` and the Firefox target are configured)
  - [ ] `web_accessible_resources` only for assets the panel actually needs in the page world

### 4.9 Injected replay panel (`components/`, the Shadow DOM surface)

- [ ] Implement the panel host in `lib/panel/host.ts`
  - [ ] Use WXT's `createShadowRootUi` (or equivalent) to attach a Shadow root on demand
  - [ ] Mount the Solid app inside the Shadow root using `render(() => <Panel />, shadowMount)`
  - [ ] Generate Uno CSS into the Shadow root via WXT's Vite-time injection
  - [ ] Reset styles inside the Shadow root using `presetWind4({ preflights: { reset: true } })`
  - [ ] Tear down cleanly on document navigation (SPA-style URL changes in Docs) via `popstate` + URL pattern observer
- [ ] Implement the panel container component `components/Panel.tsx`
  - [ ] `createSignal` for open/closed; `createStore` for replay session state
  - [ ] `<Show>` for loading / error / ready states
  - [ ] Never destructure props; use `splitProps` where needed
- [ ] Implement replay controls `components/ReplayControls.tsx`
  - [ ] Play, pause, restart, speed selector (0.5x / 1x / 2x / 4x), scrubber, progress display per PRD §9.6
  - [ ] All controls reachable by keyboard with visible focus
  - [ ] Scrubber is an `<input type="range">` with accessible `aria-valuetext`
  - [ ] Speed selector is a button group with `aria-pressed`
  - [ ] Respect `prefers-reduced-motion: reduce` by defaulting to step-through mode instead of animated replay
- [ ] Implement document viewport `components/Viewport.tsx`
  - [ ] Renders the reconstructed text buffer with readable typography (NOT pixel-imitating Google Docs — PRD §9.6)
  - [ ] Virtualized rendering deferred; Phase 1 ships full render with a hard cap on visible text length, falling back to a notice if exceeded
  - [ ] Banner-text disclosure that the view is a reconstruction (PRD §9.6)
- [ ] Implement timeline view `components/TimelineView.tsx`
  - [ ] Render activity bursts and pauses as `<For each={events}>` with static Uno classes
  - [ ] Clicking an event scrubs replay to that timestamp
  - [ ] No color-only state encoding (PRD §9.11)
- [ ] Cache management surface inside the options page `components/CachePanel.tsx`
  - [ ] List documents with title (if cached), size, last accessed
  - [ ] Per-doc "Clear" button + global "Clear all" button (PRD §8.5)
  - [ ] Show `storage.estimate()` quota usage
- [ ] Privacy summary surface `components/PrivacySummary.tsx`
  - [ ] Rendered on first-run and on the options page (PRD §8.1)
  - [ ] No accounts, no telemetry, no remote backend, local cache only
- [ ] UnoCSS extraction sanity check
  - [ ] All panel TSX files included in extraction by default; verify by inspecting built CSS
  - [ ] No `bg-${x}-500`-style template-built class names anywhere; use static maps (`buttonTone` pattern from the playbook)

### 4.10 Activation flow & state management (`composables/`)

- [ ] `composables/useReplaySession.ts` exposing `createStore` for the active session
  - [ ] Status: `idle | retrieving | decoding | reconstructing | ready | error`
  - [ ] Wires `RETRIEVAL_PROGRESS`, `RECONSTRUCTION_PROGRESS`, `REPLAY_READY`, `DOMAIN_ERROR` events into the store via a dispatcher subscription
- [ ] `composables/useReplayPlayback.ts`
  - [ ] `createSignal` for current op index and speed
  - [ ] `createMemo` for elapsed-time / progress fraction
  - [ ] `createEffect` schedules the next tick using `requestAnimationFrame` for smooth playback; cancels on pause via `onCleanup`
- [ ] `composables/useCacheList.ts`
  - [ ] `createResource` reading `LIST_CACHE` from background; refetch after clear actions

### 4.11 Documentation surfaces (Phase 1 skeletons, finalized in §7)

- [ ] Create `docs/permissions.md` listing every requested permission with rationale
- [ ] Create `docs/privacy-policy.md` (skeleton)
- [ ] Create `docs/threat-model.md` (skeleton) per PRD §14
- [ ] Create `SECURITY.md` at repo root with disclosure address
- [ ] Update `README.md`
  - [ ] One-paragraph product description
  - [ ] Build instructions: `bun install --frozen-lockfile`, `bun run build`, `bun run build:firefox`
  - [ ] Manual install instructions for both browsers
  - [ ] Link to PRD, implementation plan, privacy docs, threat model

### 4.12 Phase 1 verification

- [ ] `bun run typecheck` green
- [ ] `bun test` green; coverage report inspected
- [ ] `bun run build` succeeds; `bun run build:firefox` succeeds
- [ ] Manual smoke test in Chromium
  - [ ] Load unpacked from `.output/chrome-mv3`
  - [ ] Open a Google Doc you own with at least 30 revisions
  - [ ] Verify activation button appears, no automatic retrieval
  - [ ] Click activation, observe progress states
  - [ ] Replay plays, pauses, scrubs, and speeds correctly
  - [ ] Keyboard-only flow works end-to-end
  - [ ] Reduced-motion preference is honored
  - [ ] Close DevTools, reload, verify the cached replay loads without re-fetching
  - [ ] Re-test with DevTools closed to confirm background lifecycle is correct
- [ ] Manual smoke test in Firefox
  - [ ] Load temporary add-on from `.output/firefox-mv3`
  - [ ] Repeat the same flow; record any divergences in `docs/phase-2-firefox-notes.md`
- [ ] Network audit
  - [ ] Inspect DevTools network panel during a full replay
  - [ ] Verify zero requests to any non-`docs.google.com` host
- [ ] Permission audit
  - [ ] Diff the built manifest against `docs/permissions.md`; any drift fails the check
- [ ] Tag `phase-1-mvp` in git

## 5. Phase 2 — Robustness & Firefox Parity

**Goal:** Bring parser coverage up to handle a wider range of real documents, validate Firefox in real-browser tests, expose diagnostics with strict redaction, harden storage migrations, and prove the replay engine on large documents.

**Entry criteria:** Phase 1 MVP loads in Chromium and Firefox; basic replay works for fixtures.

**Exit criteria:** Cross-browser E2E suite green; expanded parser handles collaborative documents, formatting changes, comments, and suggested edits to the extent the format allows; opt-in diagnostics export with verified redaction.

### 5.1 Parser coverage expansion

- [ ] Capture five additional fixtures
  - [ ] Document with paragraph styles and headings
  - [ ] Document with bullet and numbered lists
  - [ ] Document with comments and resolved comments
  - [ ] Document with suggested edits (accepted and rejected)
  - [ ] Document with mixed-language content including an RTL script
- [ ] Extend `DocumentOperation` union for new operation kinds
- [ ] Update `lib/decoder/decode-revision.ts` and add per-op decoder modules under `lib/decoder/ops/`
- [ ] Per-op unit tests for every new operation kind
- [ ] Snapshot tests updated for the new fixtures
- [ ] Audit `unsupported` op rate per fixture; document any remaining gaps in `docs/parser-coverage.md`

### 5.2 Firefox real-browser validation

- [ ] Add Playwright with the Firefox channel
  - [ ] `bun add -d playwright @playwright/test`
  - [ ] `bunx playwright install firefox chromium`
  - [ ] Create `playwright.config.ts` with two projects: `chromium-mv3` and `firefox-mv3`
- [ ] Write the cross-browser smoke spec `tests/e2e/smoke.spec.ts`
  - [ ] Launches each browser with the built extension loaded
  - [ ] Drives the activation flow on a deterministic local mock of `docs.google.com` using Playwright's request interception so no real Google account is required
  - [ ] Asserts replay reaches a known final state for a fixture-backed mock document
- [ ] Document any Chromium-vs-Firefox divergences in `docs/cross-browser-notes.md`
- [ ] Verify dual-background declaration works on both targets after any manifest changes

### 5.3 Storage migration & resilience

- [ ] Implement a real v1 → v2 migration
  - [ ] Choose a concrete schema change (e.g. add `documentTitleHash` index for cache list ordering)
  - [ ] Migration test that loads a v1 fixture and asserts the v2 shape
- [ ] Quota and pressure handling
  - [ ] LRU pruning enforced when `storage.estimate()` exceeds a configurable threshold
  - [ ] User-visible warning surface when pruning was triggered
  - [ ] Test that pruning preserves the active session's data
- [ ] Stale-parser invalidation
  - [ ] When `PARSER_VERSION` increases, mark all `decodedChunks` and `snapshots` stale but keep `rawChunks`
  - [ ] Re-decode on next activation; verify with a migration-style test
- [ ] Opt-in "discard raw after decode" mode
  - [ ] Setting persisted in `chrome.storage.local`
  - [ ] When enabled, the retrieval orchestrator deletes `rawChunks` after successful decode
  - [ ] Options page explains the trade-off: smaller cache, but parser upgrades require re-fetch

### 5.4 Diagnostics export (opt-in, redacted)

- [ ] Implement `lib/diagnostics/build-report.ts`
  - [ ] Environment block: browser family, extension version, parser version, manifest target, OS family (coarse)
  - [ ] High-level error category and anonymized operation statistics ONLY by default
  - [ ] An explicit `includeRawPayload: boolean` flag, default `false`, with a separate UI confirmation step
- [ ] Implement `lib/diagnostics/redact.ts`
  - [ ] Reuse the fixture redactor's rules
  - [ ] Unit-tested: emails, names, raw text never appear unless `includeRawPayload`
- [ ] Add an options-page surface for "Export diagnostics"
  - [ ] Two buttons: "Export environment report" (default-safe) and "Export full report including content" (with a warning modal and explicit checkbox)
  - [ ] Both produce a downloadable JSON file via `URL.createObjectURL`
- [ ] Add a guidance doc `docs/reporting-bugs.md` per PRD §10.8

### 5.5 Large-document performance

- [ ] Benchmark harness in `scripts/bench-reconstruction.ts`
  - [ ] Synthesizes a 10k-op fixture
  - [ ] Measures decode + reconstruct wall clock and peak memory
  - [ ] Output committed to `docs/perf-baseline.md`
- [ ] If benchmark fails the budget (TBD in `docs/perf-baseline.md`), upgrade the text buffer to a piece-table or rope under `lib/reconstruction/buffer/`
- [ ] Make reconstruction yield control more aggressively in the streaming path
- [ ] Add a `cancel` UI button that wires through to the orchestrator's `AbortController`

### 5.6 Phase 2 verification

- [ ] `bun test` green including new fixture coverage
- [ ] `bunx playwright test` green for both browser projects
- [ ] Manual exploratory pass per PRD §11.5: small, long, collaborative, copy-pasted, comments, suggestions, images-or-tables (best-effort), mixed-language
- [ ] Diagnostic export verified by reading the produced file and confirming no document content unless explicitly opted in
- [ ] Permission audit unchanged from Phase 1
- [ ] Tag `phase-2-robust` in git

## 6. Phase 3 — Process Insights

**Goal:** Surface higher-level writing-process signals on the timeline without making judgments about intent, authorship, or AI generation (PRD §6, §9.7, §20).

**Entry criteria:** Phase 2 timeline and parser are stable.

**Exit criteria:** Insight overlays in the timeline UI, all framed as descriptive signals with explicit uncertainty.

### 6.1 Writing-session detection

- [ ] Implement `lib/timeline/sessions.ts`
  - [ ] Group activity bursts into sessions using a configurable pause threshold
  - [ ] Emit `TimelineEvent` of kind `writing_session` with `startedAt`, `endedAt`, `opCount`, `inferredFrom: 'pause-threshold'`
- [ ] Session UI overlay in `components/TimelineView.tsx`
  - [ ] Show sessions as ranges with a subtle, non-color-only marker
  - [ ] Hover/focus reveals "Session: 14 min, 312 changes (inferred from inactivity gaps)"
- [ ] Unit + fixture tests for session boundaries

### 6.2 Large-paste indicators

- [ ] Implement `lib/timeline/large-paste.ts`
  - [ ] Detect single insert operations whose length exceeds a configurable threshold
  - [ ] Emit `TimelineEvent` of kind `large_insertion` with `byteLength` and `inferredFrom: 'single-op-size'`
- [ ] UI marker on the timeline; tooltip reads "Large insertion of N characters in one operation. This is a signal, not a conclusion."
- [ ] Documentation in `docs/insight-signals.md` explaining what this does and does not mean
- [ ] Tests including a false-positive case (large insert that is legitimately typed at high speed if such a fixture exists; otherwise documented as a known limitation)

### 6.3 Deletion summaries

- [ ] Implement `lib/timeline/deletions.ts`
  - [ ] Detect deletions exceeding a threshold OR clusters of deletions within a short window
  - [ ] Emit `large_deletion` events
- [ ] Timeline UI integration with calm language ("Large deletion: N characters")
- [ ] Tests

### 6.4 Pause visualization

- [ ] Render inferred pauses as gaps with a labeled duration
- [ ] Respect `prefers-reduced-motion` (no pulsing or animated indicators)
- [ ] Tooltip: "Pause of N minutes inferred from gap between recorded operations"

### 6.5 Timeline clustering

- [ ] Implement coarser groupings for very long timelines
  - [ ] At low zoom, collapse adjacent sessions into "hour blocks" with aggregate stats
  - [ ] At high zoom, show individual ops
- [ ] Zoom control in `components/TimelineView.tsx` with keyboard support (`+` / `-` / `[` / `]`)

### 6.6 Language guardrails (review pass)

- [ ] Grep the UI for any string that implies authorship judgment, intent, AI, plagiarism, or misconduct
- [ ] Replace with descriptive language per PRD §7, §20
- [ ] Add `docs/insight-signals.md` to the options page as a linked "What do these mean?" surface
- [ ] Commit `tests/lint-strings.test.ts` as a one-shot CI check that fails on any banned phrase

### 6.7 Phase 3 verification

- [ ] `bun test` + Playwright suite green
- [ ] Manual review: every insight has a tooltip that explains its inference basis
- [ ] No insight is conveyed by color alone
- [ ] No insight uses judgmental phrasing (`tests/lint-strings.test.ts` enforces this)
- [ ] Tag `phase-3-insights` in git

## 7. Phase 4 — Distribution Readiness

**Goal:** Ship to the Chrome Web Store and AMO with reproducible builds, complete user-facing documentation, and a contributor-ready repository.

**Entry criteria:** Phases 1–3 complete; cross-browser parity verified.

**Exit criteria:** Submitted to both stores; tagged release with verifiable build artifacts.

### 7.1 Final product naming

- [ ] Resolve PRD §24 Q7 (working name "DocRewind")
  - [ ] Trademark search against "Draftback" and any Google product names
  - [ ] If renaming, run a repo-wide rename + manifest update + docs update in one dedicated commit

### 7.2 Privacy, security, and threat-model docs

- [ ] Finalize `docs/privacy-policy.md`
  - [ ] No data leaves the browser
  - [ ] No accounts, no telemetry, no third-party services
  - [ ] Local cache disclosure with deletion instructions
- [ ] Finalize `docs/threat-model.md` per PRD §14
- [ ] Finalize `SECURITY.md`
  - [ ] Disclosure address
  - [ ] Scope and out-of-scope
  - [ ] Response SLA target
- [ ] Add `docs/permissions.md` final pass with plain-language rationale per PRD §12

### 7.3 Contributor documentation

- [ ] Finalize `README.md`
  - [ ] Project description and link to PRD
  - [ ] Build, run, test instructions
  - [ ] Privacy stance and links to policy
- [ ] Create `CONTRIBUTING.md`
  - [ ] Where to start, code style (playbook reference), commit conventions, test expectations
  - [ ] Fixture redaction rules (NEVER commit real document content)
  - [ ] How to add a parser for a new op type
- [ ] Create `CODE_OF_CONDUCT.md`
- [ ] Create `docs/ARCHITECTURE.md` summarizing subsystem boundaries from PRD §10

### 7.4 Reproducible release artifacts

- [ ] Add `scripts/release.ts` (Bun-runnable)
  - [ ] Validates working tree clean
  - [ ] Runs `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, `bunx playwright test`
  - [ ] Builds Chromium and Firefox zips with deterministic file ordering and timestamps
  - [ ] Emits SHA-256 hashes alongside each artifact
  - [ ] Writes a `RELEASE_NOTES.md` template
- [ ] Document the reproducible build steps in `docs/reproducible-builds.md`
- [ ] Verify two consecutive `bun run release` invocations produce byte-identical zips

### 7.5 Chrome Web Store submission

- [ ] Create CWS developer assets
  - [ ] Icon set (16, 32, 48, 128) — checked into `assets/icons/`
  - [ ] Promotional images at required dimensions
  - [ ] Store listing copy that avoids "catch cheaters" / "AI detection" framing
  - [ ] Privacy practices form answered honestly: no data collected, no remote code
- [ ] Run the CWS pre-submission checklist
  - [ ] Single purpose stated
  - [ ] Permission justifications documented
  - [ ] No remotely hosted code
- [ ] Submit Chromium zip

### 7.6 AMO (addons.mozilla.org) submission

- [ ] Confirm `browser_specific_settings.gecko.id` is finalized and matches `web-ext` config if used
- [ ] Run `web-ext lint` against the Firefox zip (via `bunx web-ext lint`)
- [ ] Prepare AMO listing copy
- [ ] Submit Firefox zip for review
- [ ] Provide reviewer notes: pointer to `docs/reproducible-builds.md`, source-of-truth fixture explanation

### 7.7 Release tagging and post-release

- [ ] Tag `v1.0.0` in git
- [ ] Publish a GitHub release with artifacts and `RELEASE_NOTES.md`
- [ ] Open post-release tracking issues for known gaps (e.g. images, tables, advanced collaborative attribution)

### 7.8 Phase 4 verification

- [ ] Reproducible build check passes (two zips byte-identical)
- [ ] Both store listings published or in-review
- [ ] All docs cross-link correctly
- [ ] Tag `v1.0.0` exists and is signed if a signing key is available

## 8. Cross-Cutting Concerns

These constraints apply across phases. Each item lists the phase task ID where it first must be enforced, and recurs in every subsequent phase.

### 8.1 Accessibility (introduced §4)

- [ ] All interactive controls keyboard-reachable in tab order (panel, options page, first-run)
- [ ] Visible focus styles on every focusable element; never `outline: none` without an equivalent replacement
- [ ] Playback controls operable without a mouse (space = play/pause, left/right = scrub by op, comma/period = previous/next event)
- [ ] No information conveyed by color alone; pair color with an icon, label, or shape
- [ ] `prefers-reduced-motion` honored across replay and insights (Phase 1 default; §6 re-verified)
- [ ] Timeline events expose accessible names and state via `aria-label` and `aria-valuetext`
- [ ] Verify with keyboard-only walk-through at every phase verification

### 8.2 Internationalization readiness (introduced §4)

- [ ] All user-facing strings live in a single module (`lib/i18n/strings.ts`) so future locale extraction is mechanical
- [ ] Reconstruction engine does not assume Latin-1 or English
- [ ] UI handles RTL text in the document viewport using `dir="auto"` on rendered content blocks
- [ ] No hardcoded date or number formatting; use `Intl.DateTimeFormat` and `Intl.NumberFormat`

### 8.3 Telemetry-free verification (recurring)

- [ ] Every phase verification includes a network audit: inspect DevTools network panel during a full replay
- [ ] Only `docs.google.com` requests permitted; any other host fails the audit
- [ ] No third-party scripts, no CDN imports, no analytics SDKs, no error-reporting SaaS
- [ ] CI guard: a build-time check rejects any imported package whose name matches a curated list of analytics/error reporters

### 8.4 Permission audit (recurring)

- [ ] Every change to `wxt.config.ts` manifest block updates `docs/permissions.md` in the same commit
- [ ] CI guard parses the built manifest and diffs against `docs/permissions.md`
- [ ] Reject any new `host_permissions` outside `https://docs.google.com/*` without an explicit ADR

### 8.5 Shadow DOM isolation invariants (Phase 1 onward)

- [ ] No CSS rule from the panel leaks into the host page
- [ ] No CSS rule from `docs.google.com` affects the panel (verified by injecting hostile styles in a test)
- [ ] Panel mounts and unmounts cleanly on SPA navigation
- [ ] Panel does not read from page-world JavaScript directly; data flows only through messages

### 8.6 Performance budgets (Phase 2 onward)

- [ ] First replay frame within 1.5 seconds of click on a 100-op document (cached)
- [ ] Replay maintains at least 30 FPS on the scrubber during navigation on a 5k-op document
- [ ] Reconstruction yields to the event loop at least every 50ms
- [ ] Budgets recorded in `docs/perf-baseline.md` and re-measured each phase

### 8.7 Logging discipline (Phase 1 onward)

- [ ] Logger module enforces redaction: document content never written to `console.log`, `console.error`, or any error message
- [ ] All `Error` throws use `DomainError.toUserError()` before reaching the UI
- [ ] In production builds, debug logs are stripped via build-time replace

## 9. Open Questions

Mirrors PRD §24. Each question maps to one or more tasks above and is checked off when the decision is recorded inline (with date and rationale).

- [ ] Q1 — Primary extension surface (popup, side panel, separate tab, injected panel)
  - **Decision (2026-05-13): injected panel on the Google Docs page, Shadow DOM isolated.** Revisit if Phase 1 verification reveals serious instability against Google Docs UI changes.
- [ ] Q2 — How much raw revision payload to cache vs discard
  - **Decision (2026-05-13): cache both raw and decoded in Phase 1.** §5.3 adds an opt-in "discard raw after decode" mode for users who prefer smaller cache.
- [ ] Q3 — Minimum acceptable reconstruction fidelity for MVP
  - **Decision (2026-05-13): text-only with paragraph breaks; comments, suggestions, lists deferred to Phase 2.**
- [ ] Q4 — Collaborative author display
  - **Open.** Phase 2 fixture work informs the answer.
- [ ] Q5 — Diagnostic redaction tooling
  - **Decision (2026-05-13): yes, mandatory.** §5.4 covers this.
- [ ] Q6 — Handling of suggested edits, comments, images, tables, footnotes
  - **§5.1 captures fixtures; §5.6 documents remaining gaps. Images and tables likely deferred past v1.0.**
- [ ] Q7 — Final project name
  - **Working name "DocRewind"; resolve in §7.1.**

## 10. Changelog

- 2026-05-13 — Initial plan drafted from PRD v1.
