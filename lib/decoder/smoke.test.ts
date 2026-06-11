// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";

// Phase 3 T0 placeholder so `bun test:logic` never errors on an empty directory.
// Replaced by real decoder tests (decode.test.ts) in T3.
test("decoder scaffold placeholder", () => {
  expect(true).toBe(true);
});
