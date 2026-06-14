// SPDX-License-Identifier: AGPL-3.0-or-later
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, test as base, chromium, type Route } from "@playwright/test";
import { CAPTURED_SIMPLE_DOC } from "../lib/fixtures/captured";

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));

// Extension E2E is Chromium-only and requires a persistent context — extensions
// attach to the browser process at launch, not per-tab.
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures must destructure the (here unused) deps object.
  context: async ({}, use) => {
    const pathToExtension = path.join(fixturesDir, "../.output/chrome-mv3");
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    const id = sw.url().split("/")[2];
    if (!id) throw new Error("Unable to resolve extension id from the service worker URL.");
    await use(id);
  },
});

export const expect = test.expect;

// ── Deterministic, network-free replay fixture (Phase 6 WI-4/WI-5) ──────────
//
// The built replay page always fires `startRetrieval` on mount, and the only
// network calls the extension makes are `fetch(...)` INSIDE the MV3 service
// worker (background.ts). So a play/scrub smoke must mock the `docs.google.com`
// service-worker traffic from sanitized fixtures rather than seed idb. We reuse
// the real §24 capture (`CAPTURED_SIMPLE_DOC`): four revisions (ids 1–4) whose
// reconstruction equals the known final text — decode is already proven by
// lib/decoder/captured-live.test.ts.

/** A valid `[A-Za-z0-9_-]+` doc id (asDocId) used by the smoke fixtures. */
export const E2E_SMOKE_DOC = "docE2ESmoke";

/** Reconstructed end-of-timeline text the viewport must show at the last index. */
export const E2E_EXPECTED_FINAL_TEXT = CAPTURED_SIMPLE_DOC.expectedFinalText;

/**
 * Discovery upper bound. MUST equal the chunk fixture's revision-span end so the
 * orchestrator fetches exactly span [1, N] in ONE revisions-load request
 * (DEFAULT_CHUNK_SIZE = 100 ≫ 4). CAPTURED_SIMPLE_DOC's max revisionId is 4.
 */
export const E2E_UPPER_BOUND = 4;

// Minimal edit-page (discovery) HTML. The live adapter reads the published
// revision count via /"revision":(\d+)/ — see background.ts createLiveDiscovery.
const DISCOVERY_HTML = `<!doctype html><html><head><title>doc</title></head><body><script>{"revision":${E2E_UPPER_BOUND}}</script></body></html>`;

// Revisions-load body. The live fetcher does `response.text()` and the pipeline
// treats a string body as `)]}'`-framed wire text (stripGuard passes unframed
// text through). MUST be the re-serialized envelope STRING — fulfilling with the
// parsed `{ changelog }` object would bypass the real decode (the lib/fixtures
// entry is post-deframe). content-type is application/json.
const CHUNK_BODY = JSON.stringify(CAPTURED_SIMPLE_DOC.envelope);

/** Observed-request accounting for the fulfiller + isolation audit. */
export interface GoogleFulfiller {
  /** Count of fulfilled discovery (edit-page) requests. */
  discoveryCount(): number;
  /** Count of fulfilled revisions-load (chunk) requests. */
  chunkCount(): number;
}

/**
 * Install a reusable, SW-aware fulfiller for `https://docs.google.com/**`. The
 * route fires for service-worker-originated requests (all of the extension's
 * retrieval fetches live in the MV3 SW), branching on the request URL:
 *   • `…/d/{id}/edit`           → discovery HTML carrying `"revision":N`
 *   • `…/d/{id}/revisions/load` → the framed changelog string body
 * Any other docs.google.com sub-resource is fulfilled empty so processing runs
 * fully offline. Page-realm and SW-realm requests are fulfilled identically, so
 * the handler branches on the URL alone — no `serviceWorker()` distinction needed.
 *
 * MUST be awaited BEFORE the replay page is navigated so the on-mount
 * `startRetrieval` discovery fetch cannot race an un-installed handler.
 */
export async function installGoogleFulfiller(context: BrowserContext): Promise<GoogleFulfiller> {
  let discovery = 0;
  let chunk = 0;

  await context.route("https://docs.google.com/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/edit")) {
      discovery += 1;
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: DISCOVERY_HTML,
      });
      return;
    }
    if (url.pathname.includes("/revisions/load")) {
      chunk += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: CHUNK_BODY,
      });
      return;
    }
    // Unmodeled first-party sub-resource: keep it offline + deterministic.
    await route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });

  return {
    discoveryCount: () => discovery,
    chunkCount: () => chunk,
  };
}
