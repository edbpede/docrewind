// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 6 WI-5 — network-isolation audit (Decision D2 / PRD §17). Privacy is a
// test invariant, not a doc claim: the "zero non-Google requests" guarantee is
// asserted by an executable check. The extension's only network calls are
// `fetch(...)` inside the MV3 service worker, so `context.on("request")` (which
// fires for SW-originated requests) is the correct observer — plain
// `context.route("**/*")` does NOT see SW fetches and would be false-green.
//
// We run the SAME fulfilled replay flow as the smoke test (so processing really
// executes) and assert the COMPLEMENT: no request targets a public, non-Google
// host. Asserting the complement (rather than a strict allowlist subset) keeps
// first-party `chrome-extension://` / `chrome://` / `about:` / `data:`
// housekeeping from causing false reds.

import { E2E_SMOKE_DOC, expect, installGoogleFulfiller, test } from "./fixtures";

test.setTimeout(60_000);

// Hosts allowed to receive a public network request: only Google Docs.
const ALLOWED_PUBLIC_HOSTS = new Set(["docs.google.com"]);

// Schemes that are first-party / local and never leave the machine.
const FIRST_PARTY_SCHEMES = new Set(["chrome-extension:", "chrome:", "about:", "data:", "blob:"]);

test("makes zero non-Google network requests during processing", async ({
  context,
  extensionId,
}) => {
  const foreignRequests: string[] = [];

  // Register the recorder BEFORE navigation so the on-mount retrieval is observed.
  context.on("request", (request) => {
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return; // unparseable (opaque) — not a public host
    }
    if (FIRST_PARTY_SCHEMES.has(url.protocol)) {
      return;
    }
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !ALLOWED_PUBLIC_HOSTS.has(url.hostname)
    ) {
      foreignRequests.push(request.url());
    }
  });

  const fulfiller = await installGoogleFulfiller(context);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/replay.html?doc=${E2E_SMOKE_DOC}`);

  // Run the full fulfilled flow so the audit covers real processing, not an idle page.
  // The Play button only appears after retrieval acks + the worker publishes decoded
  // data — i.e. the SW actually fetched and processed the fulfilled bodies.
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 45_000 });
  expect(fulfiller.chunkCount(), "the real retrieval flow ran").toBeGreaterThan(0);

  // The invariant: nothing left for a public non-Google host.
  expect(foreignRequests, `unexpected non-Google requests:\n${foreignRequests.join("\n")}`).toEqual(
    [],
  );
});
