// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "./fixtures";

test("settings page exposes storage-maintenance controls without raw content", async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html?doc=docE2E`);

  await expect(page.getByRole("heading", { name: "Cached data" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear this document" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear all documents" })).toBeVisible();
  await expect(page.getByLabel("Keep raw data for re-decoding")).toBeVisible();
  await expect(page.getByText("raw-body")).toHaveCount(0);
});
