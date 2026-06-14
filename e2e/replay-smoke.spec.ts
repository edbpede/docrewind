// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 6 WI-4 — play/scrub smoke (Decision D3, Option C). The built replay page
// can't be injected with `useWorker={false}`/`store` and always re-runs
// `startRetrieval` on mount, so seeding idb cannot bypass retrieval. Instead we
// fulfill the real `docs.google.com` service-worker traffic from sanitized
// fixtures; the real retrieval → worker → decode → reconstruction → timeline
// pipeline then runs end to end and renders the replay surface, which we drive.

import {
  E2E_EXPECTED_FINAL_TEXT,
  E2E_SMOKE_DOC,
  E2E_UPPER_BOUND,
  expect,
  installGoogleFulfiller,
  test,
} from "./fixtures";

// Retrieval + worker decode is fast with mocked fetch, but allow generous headroom
// for the persistent-context SW spin-up + checkpoint poll cadence.
test.setTimeout(60_000);

test("replays a fixture document: renders, scrubs, and plays", async ({ context, extensionId }) => {
  // Install the SW-aware fulfiller BEFORE navigation so the on-mount discovery
  // fetch cannot race an un-installed handler.
  const fulfiller = await installGoogleFulfiller(context);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/replay.html?doc=${E2E_SMOKE_DOC}`);

  // The PLAYBACK CONTROLS only render after retrieval acks ok AND the worker
  // publishes derived data — proof the fulfilled bodies reached real decode. The
  // Play button is a padded control (robust visibility signal); the timeline
  // track is an 8px stratum, so we assert it via attachment + ARIA, not pixels.
  const playButton = page.getByRole("button", { name: "Play" });
  await expect(playButton).toBeVisible({ timeout: 45_000 });

  // The fulfilled flow actually ran (positive request counts).
  expect(fulfiller.discoveryCount(), "discovery (edit-page) fetched").toBeGreaterThan(0);
  expect(fulfiller.chunkCount(), "revisions-load chunk fetched").toBeGreaterThan(0);

  // Four revisions decoded → applied-count axis [0, 4].
  const slider = page.getByRole("slider", { name: "Revision timeline" });
  await expect(slider).toBeAttached();
  await expect(slider).toHaveAttribute("aria-valuemax", String(E2E_UPPER_BOUND));

  // ── Scrub (deterministic, keyboard) ──────────────────────────────────────
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");

  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuenow", String(E2E_UPPER_BOUND));

  // At the last index the reconstructed document equals the source's final text.
  await expect(page.locator("article.doc-column")).toContainText(E2E_EXPECTED_FINAL_TEXT);

  // ── Play / Pause ──────────────────────────────────────────────────────────
  // Parked at the end, Play restarts from 0 and advances; confirm it toggles and
  // the applied-count moves forward, then Pause toggles back.
  await playButton.click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  await expect
    .poll(async () => Number(await slider.getAttribute("aria-valuenow")), {
      message: "playback advances the applied-count past 0",
      timeout: 10_000,
    })
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
});
