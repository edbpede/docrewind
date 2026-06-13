// SPDX-License-Identifier: AGPL-3.0-or-later
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, test as base, chromium } from "@playwright/test";

const fixturesDir = path.dirname(fileURLToPath(import.meta.url));

// Extension E2E is Chromium-only and requires a persistent context — extensions
// attach to the browser process at launch, not per-tab. No specs are authored in
// Phase 2; this fixture + config land now so Phase 6 specs have a home.
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
