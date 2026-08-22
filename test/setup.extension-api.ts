// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Keeps the faked extension API present as a GLOBAL for every Vitest test.
//
// WXT's own setup file installs it once, at setup time, with
// `vi.stubGlobal("chrome" | "browser", fakeBrowser)`. Several suites here stub
// `fetch` per test and tear that down with `vi.unstubAllGlobals()`, which is
// indiscriminate — it drops WXT's `chrome`/`browser` stubs along with the
// `fetch` one, and nothing reinstalls them.
//
// That was invisible while @webext-core/messaging imported `wxt/browser` (a
// module alias, unaffected by global stubbing). v4 dropped webextension-polyfill
// and reads `chrome.runtime` off the global instead, so the first such teardown
// left every later test in the file with `ReferenceError: chrome is not defined`.
//
// Re-asserting the two globals before each test makes the suite independent of
// teardown order. It is additive: a test that stubs its own `fetch` still gets a
// clean slate from its own `vi.unstubAllGlobals()`.

import { beforeEach, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

beforeEach(() => {
  vi.stubGlobal("chrome", fakeBrowser);
  vi.stubGlobal("browser", fakeBrowser);
});
