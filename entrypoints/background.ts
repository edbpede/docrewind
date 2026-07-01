// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Background service worker (plan §1.5 / PRD §10.9). Owns retrieval wiring: it
// registers the typed messaging listeners and instantiates the resumable
// orchestrator with the idb checkpoint store. Per the WXT background contract,
// ALL browser.*/fetch usage stays inside `defineBackground` — never at module
// top level (top-level runs in WXT's Node build context and throws).
//
// ─────────────────────────────────────────────────────────────────────────────
// LIVE retrieval activation site. The §24 transport capture landed 2026-06-12
// and NO stop-condition fired (no protobuf, no `batchexecute` wrapper, no
// page-derived read token, no endpoint restriction).
// The two pure gated stubs have been replaced HERE with the live `ChunkFetcher`
// (`fetch(url, { credentials: "include" })` + `buildRevisionsLoadUrl`) and the
// confirmed revision-count discovery. The orchestrator and all of lib/core/retrieval
// are UNCHANGED — the swap is localized to this one file, exactly as the seam
// intended (the purity guard forbids `fetch(` inside lib/core/retrieval by design).
//
// Confirmed transport facts (also encoded as typed constants in
// lib/core/protocol/types.ts / discovery.ts):
//   • Framing: `)]}'`-guarded JSON; top-level object `{ chunkedSnapshot, changelog }`.
//   • Read needs ONLY the first-party session cookie — no custom header, no token.
//   • Out-of-range `end` ⇒ HTTP 400 (was 500 in 2014); in-range ⇒ 200.
//   • The current revision count is published in the editor bootstrap as `"revision":N`.
// ─────────────────────────────────────────────────────────────────────────────

import { asRevisionId } from "@/lib/core/domain/ids";
import type { DocumentKind } from "@/lib/core/domain/kind";
import type { DocId, RawPayload, RevisionId } from "@/lib/core/domain/model";
import {
  attachCollaboratorEmails,
  mergeIdentities,
  parseDriveShareAcl,
  parseTilesHovercardIds,
  parseTilesParams,
  parseUserMap,
  type TilesParams,
} from "@/lib/core/identity/resolve";
import type { RevisionRangeDiscovery } from "@/lib/core/protocol/discovery";
import {
  buildDocBootstrapUrl,
  buildRevisionsLoadUrl,
  buildRevisionsTilesUrl,
  IDENTITY_BOOTSTRAP_SURFACES,
} from "@/lib/core/protocol/endpoints";
import { parseFramed } from "@/lib/core/protocol/framing";
import {
  fail,
  ok,
  type Result,
  type RetrievalError,
  retrievalError,
} from "@/lib/core/retrieval/errors";
import { type CancellationToken, runRetrieval } from "@/lib/core/retrieval/orchestrator";
import type { ChunkFetcher, ChunkRequest } from "@/lib/core/retrieval/transport";
import { createIdbStore } from "@/lib/platform/db";
import { onMessage } from "@/lib/platform/messaging";
import {
  advanceDurableIntentsDrainedSeq,
  beginStorageLease,
  endStorageLease,
  getDurableIntentsEnqueueSeq,
  getPendingDestructiveStorageClears,
  getPendingStorageMaintenance,
  hasActiveStorageLease,
  markLegacyIdentityKeyCleared,
  readBackgroundStartupState,
  realIdentities,
  refreshStorageLease,
  removePendingDestructiveStorageClear,
  removePendingStorageMaintenance,
  removePendingStorageMaintenanceForScope,
  resolvedIdentities,
  runIfCurrentPendingDestructiveStorageClear,
  runIfCurrentPendingStorageMaintenance,
  STORAGE_LEASE_REFRESH_MS,
} from "@/lib/platform/settings";
import {
  createStorageMaintenanceCoordinator,
  refreshCacheMeta,
  type StorageMaintenanceRequest,
} from "@/lib/platform/storage-maintenance";

export default defineBackground(() => {
  const store = createIdbStore();
  const maintenance = createStorageMaintenanceCoordinator(store, {
    canRunScope: async (docId) => !(await hasActiveStorageLease(docId)),
  });

  // The identity cache lives in `storage.session` (in-memory, never on disk). By
  // default session storage is readable only by trusted contexts; raise the access
  // level so the Docs CONTENT SCRIPT can contribute the viewer's own name. This is
  // strictly an enrichment path — if the API is unavailable the content-script write
  // simply no-ops and the background tiles harvest (a trusted context) still fills
  // the cache, so the call is best-effort and never gates anything.
  void (
    browser.storage.session as unknown as {
      setAccessLevel?: (opts: { accessLevel: string }) => Promise<void>;
    }
  )
    .setAccessLevel?.({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
    .catch(() => {});

  // Cold-start work, gated behind ONE cheap marker read (MV3 re-runs this whole
  // body on every wake, so the steady-state wake must not pay a storage write +
  // two queue reads to service a trivial message — see backgroundStartupMarker):
  //
  //  • One-time cleanup: an earlier release cached resolved identities under
  //    `local:resolvedIdentities` (on disk). The cache is now session-scoped, so
  //    the legacy on-disk key is orphaned — drop it once so resolved names don't
  //    outlive the session for users upgrading from that build. Best-effort and
  //    idempotent (a lost marker write merely re-runs the harmless remove). WXT
  //    strips the area prefix, so the on-disk key is the bare `resolvedIdentities`.
  //  • Durable-intent drain: only when the generation counters disagree
  //    (enqueueSeq !== drainedSeq). enqueueSeq is bumped after each queue write
  //    and drainedSeq advances only on a full drain, so a skipped drain is always
  //    safe (see durableIntentsEnqueueSeq).
  void (async () => {
    const { legacyIdentityKeyCleared, enqueueSeq, drainedSeq } = await readBackgroundStartupState();
    if (!legacyIdentityKeyCleared) {
      await browser.storage.local.remove("resolvedIdentities").catch(() => {});
      await markLegacyIdentityKeyCleared();
    }
    if (enqueueSeq !== drainedSeq) {
      await drainPersistedRequests();
    }
  })().catch(() => {});

  // Per-document cancellation flags for in-flight retrievals.
  const cancelledDocs = new Set<string>();
  // Docs whose identity userMap has already been harvested in THIS service-worker
  // lifetime. Resolution is one same-origin GET per doc per session — re-opening a
  // replay for the same doc must not refetch (rate-limit + efficiency). The session
  // cache persists names across replays anyway; an MV3 restart resets this set and
  // costs at most one extra harvest, which is acceptable.
  const identitiesHarvested = new Set<string>();
  // Per-document run epoch. A fresh `startRetrieval` bumps the epoch, so any
  // still-pending earlier run for the same docId sees `isCancelled() === true`
  // and stops — preventing two concurrent runs from racing the IDB store when
  // MV3 dispatches overlapping messages (handlers are not serialized).
  const runEpochByDoc = new Map<string, number>();

  const cancelDocumentRun = (docId: DocId): void => {
    cancelledDocs.add(docId);
    runEpochByDoc.set(docId, (runEpochByDoc.get(docId) ?? 0) + 1);
  };

  const cancelAllDocumentRuns = (): void => {
    for (const docId of runEpochByDoc.keys()) {
      cancelDocumentRun(docId as DocId);
    }
  };

  async function requestDestructiveClear(
    request:
      | {
          readonly kind: "document";
          readonly docId: DocId;
          readonly id?: string;
          readonly queuedAt?: number;
        }
      | { readonly kind: "all"; readonly id?: string; readonly queuedAt?: number },
  ) {
    const cleanupScope = async (ack: { readonly status: "completed" | "deferred" | "failed" }) => {
      if (ack.status === "completed") {
        await removePendingStorageMaintenanceForScope(
          request.kind === "all" ? null : request.docId,
        );
      }
    };

    async function execute() {
      const blockedScope = request.kind === "all" ? null : request.docId;
      if (request.kind === "all") {
        cancelAllDocumentRuns();
      } else {
        cancelDocumentRun(request.docId);
      }
      const hasDurableLease = await hasActiveStorageLease(blockedScope);
      if (
        request.id !== undefined &&
        (hasDurableLease || maintenance.hasActiveLease(blockedScope))
      ) {
        return { status: "deferred" as const, reclaimedBytes: 0 };
      }
      if (request.kind === "all") {
        return maintenance.requestDestructiveClear({ kind: "all" });
      }
      return maintenance.requestDestructiveClear({ kind: "document", docId: request.docId });
    }

    const requestId = request.id;
    if (requestId === undefined) {
      const ack = await execute();
      await cleanupScope(ack);
      return ack;
    }
    if (request.queuedAt === undefined) {
      return { status: "completed" as const, reclaimedBytes: 0 };
    }
    const identity =
      request.kind === "all"
        ? { id: requestId, kind: "all" as const, queuedAt: request.queuedAt }
        : {
            id: requestId,
            kind: "document" as const,
            docId: request.docId,
            queuedAt: request.queuedAt,
          };
    const outcome = await runIfCurrentPendingDestructiveStorageClear(identity, execute);
    if (!outcome.current) {
      return { status: "completed" as const, reclaimedBytes: 0 };
    }
    await cleanupScope(outcome.value);
    return outcome.value;
  }

  async function requestStorageMaintenance(
    request: StorageMaintenanceRequest & { readonly id?: string; readonly queuedAt?: number },
  ) {
    // Persisted maintenance requests are durable policy intents, not permission
    // to mutate raw bytes immediately. They must still be the latest persisted
    // intent for their scope, and startup replay after MV3 restart must still
    // wait until both the durable lease marker and the live in-memory coordinator
    // say the scope is clear.
    async function execute() {
      const hasDurableLease = await hasActiveStorageLease(request.docId);
      if (
        request.id !== undefined &&
        (hasDurableLease || maintenance.hasActiveLease(request.docId))
      ) {
        return { status: "deferred" as const, reclaimedBytes: 0 };
      }
      return maintenance.request(request);
    }

    const requestId = request.id;
    if (requestId === undefined) {
      return execute();
    }
    if (request.queuedAt === undefined) {
      return { status: "completed" as const, reclaimedBytes: 0 };
    }
    const outcome = await runIfCurrentPendingStorageMaintenance(
      {
        docId: request.docId,
        id: requestId,
        queuedAt: request.queuedAt,
      },
      execute,
    );
    return outcome.current ? outcome.value : { status: "completed" as const, reclaimedBytes: 0 };
  }

  async function drainPersistedRequests(): Promise<void> {
    // Capture the enqueue generation BEFORE touching the queues. A concurrent
    // enqueue during processing bumps it past this snapshot, so advancing
    // drainedSeq to the snapshot at the end leaves the two unequal and the next
    // wake re-drains. This is MV3-crash-survivable: the only durable "drained"
    // write is the single terminal advance below, so a kill anywhere before it
    // leaves drainedSeq stale (< enqueueSeq) and the hint stays pending (see
    // durableIntentsEnqueueSeq).
    const seqAtStart = await getDurableIntentsEnqueueSeq();
    let leftovers = false;

    for (const request of await getPendingDestructiveStorageClears()) {
      const ack = await requestDestructiveClear(request);
      if (ack.status === "completed") {
        await removePendingDestructiveStorageClear(request);
      } else {
        leftovers = true;
      }
    }

    for (const request of await getPendingStorageMaintenance()) {
      const ack = await requestStorageMaintenance(request);
      if (ack.status === "completed") {
        await removePendingStorageMaintenance(request.id, request.queuedAt);
      } else {
        leftovers = true;
      }
    }

    // Deferred entries (blocked behind a lease) remain — leave drainedSeq stale
    // so the hint stays pending and the next lease-release drain still runs.
    if (leftovers) {
      return;
    }

    // Full drain: commit the observed start generation as drained. Any enqueue
    // that raced this drain bumped enqueueSeq past seqAtStart, so it stays
    // pending; a false "nothing pending" is impossible because we commit the
    // PRE-processing snapshot, never a re-read a concurrent enqueue could clobber.
    await advanceDurableIntentsDrainedSeq(seqAtStart);
  }

  /** Drain only when the generation counters disagree (the common case is "no"). */
  async function drainPersistedRequestsIfHinted(): Promise<void> {
    const { enqueueSeq, drainedSeq } = await readBackgroundStartupState();
    if (enqueueSeq !== drainedSeq) {
      await drainPersistedRequests();
    }
  }

  // ── LIVE §24 transport adapters ──────────────────────────────────────────
  const DOCS_ORIGIN = "https://docs.google.com";
  // Cap any single credentialed GET so a hung response can't pin a retrieval
  // run open indefinitely. `AbortSignal.timeout` is available in MV3 service
  // workers; the SW lifecycle is a backstop, but an explicit bound is cheaper.
  const FETCH_TIMEOUT_MS = 30_000;
  const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  // The sharing-ACL document URL (A.5 multi-account aware). A same-origin, credentialed
  // GET that returns the full ACL — including collaborator `emailAddress` — but ONLY when
  // the viewer can manage sharing; readers get a reduced/empty ACL, so the email join
  // degrades silently. `authuser` selects the signed-in account (mirrors `buildEditUrl`'s
  // `/u/{N}/` slot); the remaining params match Docs' own Share-dialog init request.
  const buildDriveShareUrl = (docId: DocId, userIndex: number | null): string => {
    const query = new URLSearchParams({
      id: docId,
      command: "init_share",
      foreignService: "kix",
      gaiaService: "writely",
      shareService: "kix",
      subapp: "10",
      hl: "en-GB",
      origin: DOCS_ORIGIN,
      authuser: String(userIndex ?? 0),
    });
    return `${DOCS_ORIGIN}/drivesharing/driveshare?${query.toString()}`;
  };

  // Build the replay-page query string. OMITS `u` entirely when userIndex is null
  // (so the page's strict parse reads `null`, never a wrong `/u/0/` account slot);
  // appends `&u=<n>` only for a real integer.
  const buildReplayQuery = (docId: DocId, userIndex: number | null, kind: DocumentKind): string => {
    const params = new URLSearchParams({ doc: docId });
    if (userIndex !== null && Number.isInteger(userIndex)) {
      params.set("u", String(userIndex));
    }
    // Tag the replay page with the kind so it drives the right pipeline/viewport
    // before any publication exists; "doc" is the default and is omitted.
    if (kind === "sheet") {
      params.set("kind", "sheet");
    } else if (kind === "slides") {
      params.set("kind", "slides");
    }
    return `?${params.toString()}`;
  };

  // Collaborator identity harvest (PRD §9.7). Runs by default; skipped only when the
  // user opted OUT via `realIdentities`. The self-path (content script) resolves just
  // the viewer; other collaborators' Gaia ids never appear in the page bootstrap, so
  // their names come from the `revisions/tiles` `userMap` — the same feed Docs' native
  // version history uses. We read the short-lived `token`+`ouid` from the edit-page
  // bootstrap, fetch tiles same-origin (existing `docs.google.com` host permission — no
  // new endpoint host, no new scope), and merge the names into the SESSION cache. Their
  // EMAIL is then joined in from the same-origin sharing ACL (`drivesharing/driveshare`),
  // but only surfaces where the viewer can manage sharing — exactly the addresses Google
  // already shows this viewer in its Share dialog. Entirely best-effort: any miss leaves
  // the opaque "Author N" labels (or just the name) untouched, and nothing is fetched or
  // stored when the toggle is off.
  const harvestCollaboratorIdentities = async (
    docId: DocId,
    userIndex: number | null,
    kind: DocumentKind,
  ): Promise<void> => {
    if (identitiesHarvested.has(docId) || !(await realIdentities.getValue())) {
      return;
    }
    try {
      // The tiles credentials (`token`+`ouid`) ride in the `info_params` bootstrap of any doc
      // page surface. `/edit` is the common case (one fetch, unchanged), but it can be access-
      // blocked for a turned-in Classroom submission the educator was granted only via the
      // grading context — so fall back to `/grading`, then `/view`, until one resolves. A surface
      // that 4xx's or carries no token is skipped; only a normal doc's first `/edit` is fetched.
      let params: TilesParams | null = null;
      for (const surface of IDENTITY_BOOTSTRAP_SURFACES) {
        let response: Response;
        try {
          response = await fetch(buildDocBootstrapUrl(docId, userIndex, surface, kind), {
            credentials: "include",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
        } catch {
          continue; // transport error on this surface — try the next.
        }
        if (!response.ok) {
          continue;
        }
        params = parseTilesParams(await response.text());
        if (params !== null) {
          break;
        }
      }
      if (params === null) {
        return;
      }
      const tilesResponse = await fetch(
        buildRevisionsTilesUrl({ docId, userIndex, token: params.token, ouid: params.ouid, kind }),
        { credentials: "include", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!tilesResponse.ok) {
        return;
      }
      // Deframe once: names/colours come from the userMap, and the hovercard ids are
      // the join key to the sharing-ACL emails below.
      const framed = parseFramed(await tilesResponse.text());
      const incoming = parseUserMap(framed);
      if (Object.keys(incoming).length === 0) {
        return;
      }
      const hovercardByToken = parseTilesHovercardIds(framed);
      // Best-effort: collaborator emails come from the sharing ACL, surfaced only when the
      // viewer can manage sharing. Any failure (no rights / drift / non-ok) leaves names
      // intact and simply yields no emails — `emailByGaia` stays `{}`.
      let emailByGaia: Readonly<Record<string, string>> = {};
      try {
        const aclResponse = await fetch(buildDriveShareUrl(docId, userIndex), {
          credentials: "include",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (aclResponse.ok) {
          emailByGaia = parseDriveShareAcl(await aclResponse.text());
        }
      } catch {
        // No manage-share rights / endpoint drift — names stay; emails just don't resolve.
      }
      const enriched = attachCollaboratorEmails(incoming, hovercardByToken, emailByGaia);
      const current = await resolvedIdentities.getValue();
      // `mergeIdentities` preserves an existing email, so the self-path address is never
      // clobbered by this name+email harvest.
      await resolvedIdentities.setValue(mergeIdentities(current, enriched));
      // Mark resolved only on success, so a transient failure can retry next replay.
      identitiesHarvested.add(docId);
    } catch {
      // Best-effort cosmetic enrichment — never surface or retry; opaque labels remain.
    }
  };

  // Map an HTTP status to the typed error taxonomy. Recoverable categories let
  // the orchestrator back off + shrink the chunk before retrying — so a soft
  // rate limit (429) or a too-large-range 400 self-heals (A.9), while an auth
  // failure surfaces immediately.
  const classifyStatus = (status: number): RetrievalError => {
    if (status === 401 || status === 403) return retrievalError("insufficient-permission");
    if (status === 429 || status === 400 || status >= 500) return retrievalError("network-failure");
    return retrievalError("endpoint-unavailable");
  };

  // Live chunk fetcher: one credentialed `revisions/load` GET per span. Cookies
  // attach via `credentials: "include"` given the `*://docs.google.com/*` host
  // permission; no custom header / read token is required (§24 Q3/Q4). The raw
  // `)]}'`-framed text is stored opaque as `body` for the worker to parse/decode
  // — this adapter commits NO wire-format assumption beyond the URL shape.
  const createLiveFetcher = (kind: DocumentKind): ChunkFetcher => ({
    async fetchChunk(request: ChunkRequest): Promise<Result<RawPayload, RetrievalError>> {
      const url = buildRevisionsLoadUrl({
        docId: request.docId,
        start: request.span.start,
        end: request.span.end,
        userIndex: request.userIndex,
        kind,
      });
      let response: Response;
      try {
        response = await fetch(url, {
          credentials: "include",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
      } catch {
        return fail(retrievalError("network-failure"));
      }
      if (!response.ok) {
        return fail(classifyStatus(response.status));
      }
      let body: string;
      try {
        body = await response.text();
      } catch {
        return fail(retrievalError("network-failure"));
      }
      // The endpoint returns exactly the requested inclusive span, so
      // received === requested; the orchestrator re-validates this against the
      // upper bound and advances its resume cursor from `received.end`.
      return ok({
        docId: request.docId,
        range: { requested: request.span, received: request.span },
        receivedAt: Date.now(),
        body,
      });
    },
  });

  // Probe whether revision `end` is in range: 200 ⇒ in-range, any 4xx (the 2026
  // out-of-range signal is HTTP 400, §24 Q5) ⇒ over. Throws on a transport error
  // so discovery can surface it rather than mis-bound the range.
  const probeInRange = async (
    docId: DocId,
    userIndex: number | null,
    end: number,
    kind: DocumentKind,
  ): Promise<"in" | "over"> => {
    const url = buildRevisionsLoadUrl({
      docId,
      start: asRevisionId(1),
      end: asRevisionId(end),
      userIndex,
      kind,
    });
    const response = await fetch(url, {
      credentials: "include",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.ok) return "in";
    // Auth failures must surface as such — they are NOT an out-of-range signal.
    // The 2026 out-of-range marker is specifically HTTP 400 (§24 Q5), so a
    // 401/403 here is a permission problem and must propagate to discovery as a
    // distinct error rather than being read as "over".
    if (response.status === 401 || response.status === 403) {
      throw retrievalError("insufficient-permission");
    }
    if (response.status >= 400 && response.status < 500) return "over";
    throw new Error(`revisions/load probe failed (${response.status})`);
  };

  // Revision-range discovery (§24 Q5). Primary: read the published `"revision":N`
  // count from the editor bootstrap — a single request, the gentlest path (A.9).
  // Fallback: exponential-bracket + binary-search the in-range(200)/over(400)
  // boundary if the bootstrap shape ever changes. Both are encapsulated here so
  // the orchestrator stays strategy-agnostic (it consumes `discoverUpperBound`
  // only). `userIndex` is captured per request for the multi-account path.
  const createLiveDiscovery = (
    userIndex: number | null,
    kind: DocumentKind,
  ): RevisionRangeDiscovery => ({
    strategy: "revision-count-metadata",
    async discoverUpperBound(docId: DocId): Promise<RevisionId> {
      // Primary: bootstrap metadata.
      try {
        const response = await fetch(buildDocBootstrapUrl(docId, userIndex, "edit", kind), {
          credentials: "include",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (response.ok) {
          const html = await response.text();
          const match = html.match(/"revision":(\d+)/);
          const count = match ? Number(match[1]) : Number.NaN;
          if (Number.isInteger(count) && count >= 1) {
            return asRevisionId(count);
          }
        }
      } catch {
        // fall through to the binary-search fallback
      }

      // Fallback: confirm revision 1 is in range, then bracket + binary-search.
      if ((await probeInRange(docId, userIndex, 1, kind)) === "over") {
        throw new Error("no revisions in range");
      }
      let lo = 1; // always in range
      let hi = 2;
      for (let guard = 0; guard < 40; guard += 1) {
        await pause(200); // gentle spacing — undocumented soft limits (A.9)
        if ((await probeInRange(docId, userIndex, hi, kind)) === "over") break;
        lo = hi;
        hi *= 2;
      }
      while (lo + 1 < hi) {
        const mid = Math.floor((lo + hi) / 2);
        await pause(200);
        if ((await probeInRange(docId, userIndex, mid, kind)) === "in") lo = mid;
        else hi = mid;
      }
      return asRevisionId(lo);
    },
  });
  // ─────────────────────────────────────────────────────────────────────────

  onMessage("activateReplay", ({ data }) => {
    // Seam A1: the content-script click activates the SURFACE, not the fetch. We
    // open our OWN extension page; creating a tab to an own-extension URL needs
    // NO `tabs` permission (tabs.create is gated only for cross-origin URL/tab
    // metadata access, not own-page creation), so permissions stay ["storage"]
    // and the privacy invariant holds. The replay page then validates the id,
    // drives the worker, and starts retrieval itself.
    void browser.tabs.create({
      url: browser.runtime.getURL(
        `/replay.html${buildReplayQuery(data.docId, data.userIndex, data.kind ?? "doc")}`,
      ),
    });
  });

  onMessage("cancelRetrieval", ({ data }) => {
    // Bump the epoch too: a later `startRetrieval` clears `cancelledDocs`, but
    // the in-flight run is pinned to its own epoch and still observes the bump.
    cancelDocumentRun(data.docId);
  });

  onMessage("beginDecodeLease", async ({ data }) => {
    maintenance.beginDecodeLease(data.docId);
    try {
      await beginStorageLease(data.docId);
    } catch (error) {
      await maintenance.endDecodeLease(data.docId);
      throw error;
    }
  });

  onMessage("refreshDecodeLease", async ({ data }) => {
    await refreshStorageLease(data.docId);
  });

  onMessage("endDecodeLease", async ({ data }) => {
    await endStorageLease(data.docId);
    const ack = await maintenance.endDecodeLease(data.docId);
    await drainPersistedRequestsIfHinted();
    return ack;
  });

  onMessage("requestStorageMaintenance", async ({ data }) => {
    const ack = await requestStorageMaintenance(data);
    if (ack.status === "completed" && data.id !== undefined && data.queuedAt !== undefined) {
      await removePendingStorageMaintenance(data.id, data.queuedAt);
    }
    return ack;
  });

  onMessage("clearDocumentCache", async ({ data }) => {
    const ack = await requestDestructiveClear({ ...data, kind: "document" });
    if (ack.status === "completed" && data.id !== undefined && data.queuedAt !== undefined) {
      await removePendingDestructiveStorageClear({
        id: data.id,
        kind: "document",
        docId: data.docId,
        queuedAt: data.queuedAt,
      });
    }
    return ack;
  });

  onMessage("clearAllCaches", async ({ data }) => {
    const ack = await requestDestructiveClear({ ...data, kind: "all" });
    if (ack.status === "completed" && data.id !== undefined && data.queuedAt !== undefined) {
      await removePendingDestructiveStorageClear({
        id: data.id,
        kind: "all",
        queuedAt: data.queuedAt,
      });
    }
    return ack;
  });

  onMessage("startRetrieval", async ({ data }) => {
    // Best-effort in-memory raw lease. MV3 may restart this service worker and
    // lose it, so all maintenance requests are idempotent and replay terminal
    // paths retry cleanup; while this worker is alive, raw pruning waits until
    // retrieval and page decode have both released their leases.
    maintenance.beginDecodeLease(data.docId);
    try {
      await beginStorageLease(data.docId);
    } catch (error) {
      await maintenance.endDecodeLease(data.docId);
      throw error;
    }
    const leaseRefresh = setInterval(() => {
      void refreshStorageLease(data.docId).catch(() => {});
    }, STORAGE_LEASE_REFRESH_MS);
    cancelledDocs.delete(data.docId);
    // Identity enrichment (default-on; opt-out via `realIdentities`), decoupled from
    // the retrieval critical path: it gates internally and never throws, so a
    // fire-and-forget launch can't delay or fail the changelog fetch. Names land
    // asynchronously in `resolvedIdentities`, which the replay surface watches.
    const kind: DocumentKind = data.kind ?? "doc";
    void harvestCollaboratorIdentities(data.docId, data.userIndex, kind);
    // Claim a fresh epoch; any earlier run for this docId is now stale and will
    // self-cancel on its next `isCancelled()` check.
    const epoch = (runEpochByDoc.get(data.docId) ?? 0) + 1;
    runEpochByDoc.set(data.docId, epoch);
    const cancellation: CancellationToken = {
      isCancelled: () => cancelledDocs.has(data.docId) || runEpochByDoc.get(data.docId) !== epoch,
    };
    try {
      const result = await runRetrieval(
        {
          fetcher: createLiveFetcher(kind),
          discovery: createLiveDiscovery(data.userIndex, kind),
          store,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
        },
        { docId: data.docId, userIndex: data.userIndex, cancellation },
      );
      // Drop our epoch entry if still current (a newer start would have replaced
      // it), and clear any cancel flag this run consumed — keeps both maps bounded.
      if (runEpochByDoc.get(data.docId) === epoch) {
        runEpochByDoc.delete(data.docId);
        cancelledDocs.delete(data.docId);
      }
      if (result.ok) {
        await refreshCacheMeta(store, data.docId, {
          now: Date.now(),
          reconstructionStatus: "partial",
        });
      }
      // The error is content-free by construction — never log raw bodies (§13.7).
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    } finally {
      clearInterval(leaseRefresh);
      await endStorageLease(data.docId);
      await maintenance.endDecodeLease(data.docId);
      await drainPersistedRequestsIfHinted();
    }
  });

  onMessage("getCheckpoint", ({ data }) => store.readCheckpoint(data.docId));
});
