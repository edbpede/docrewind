// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Settings round-trip + migration (plan §1.1, Vitest tier). Uses WXT's
// fakeBrowser (in-memory storage.local), reset before each test so defaults are
// deterministic.

import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
  DEFAULT_STORAGE_BUDGET,
  keepRawData,
  realIdentities,
  STORAGE_BUDGET_MIGRATIONS,
  storageBudget,
  theme,
} from "./settings";

describe("settings", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  describe("defaults", () => {
    it("theme defaults to system", async () => {
      expect(await theme.getValue()).toBe("system");
    });

    it("keepRawData defaults to true (PRD §9.8)", async () => {
      expect(await keepRawData.getValue()).toBe(true);
    });

    it("realIdentities defaults to false (PRD §9.7)", async () => {
      expect(await realIdentities.getValue()).toBe(false);
    });

    it("storageBudget defaults to ~50MB / ~500MB", async () => {
      expect(await storageBudget.getValue()).toEqual(DEFAULT_STORAGE_BUDGET);
    });
  });

  describe("updates round-trip", () => {
    it("persists a theme change", async () => {
      await theme.setValue("dark");
      expect(await theme.getValue()).toBe("dark");
    });

    it("persists a keepRawData change", async () => {
      await keepRawData.setValue(false);
      expect(await keepRawData.getValue()).toBe(false);
    });

    it("persists a storageBudget change", async () => {
      const next = { perDocumentBytes: 1234, globalCapBytes: 5678 };
      await storageBudget.setValue(next);
      expect(await storageBudget.getValue()).toEqual(next);
    });
  });

  describe("storageBudget migration (v1 → v2)", () => {
    it("the migration fn adds the global cap to a v1 value", () => {
      const migrate = STORAGE_BUDGET_MIGRATIONS[2];
      expect(migrate).toBeTypeOf("function");
      const migrated = migrate?.({ perDocumentBytes: 999 });
      expect(migrated).toEqual({
        perDocumentBytes: 999,
        globalCapBytes: DEFAULT_STORAGE_BUDGET.globalCapBytes,
      });
    });

    it("the migration fn falls back to the default per-document cap on a junk value", () => {
      const migrate = STORAGE_BUDGET_MIGRATIONS[2];
      expect(migrate?.(null)).toEqual(DEFAULT_STORAGE_BUDGET);
      expect(migrate?.("not-an-object")).toEqual(DEFAULT_STORAGE_BUDGET);
    });

    it("the migration fn falls back to the default for numeric-but-invalid inputs", () => {
      const migrate = STORAGE_BUDGET_MIGRATIONS[2];
      expect(migrate?.({ perDocumentBytes: NaN })).toEqual(DEFAULT_STORAGE_BUDGET);
      expect(migrate?.({ perDocumentBytes: Infinity })).toEqual(DEFAULT_STORAGE_BUDGET);
      expect(migrate?.({ perDocumentBytes: -Infinity })).toEqual(DEFAULT_STORAGE_BUDGET);
      expect(migrate?.({ perDocumentBytes: -1 })).toEqual(DEFAULT_STORAGE_BUDGET);
      expect(migrate?.({ perDocumentBytes: 0 })).toEqual(DEFAULT_STORAGE_BUDGET);
      expect(migrate?.({ perDocumentBytes: 0.5 })).toEqual(DEFAULT_STORAGE_BUDGET);
    });

    // NOTE: the v1→v2 migration is wired into `storage.defineItem` via
    // `version: 2` + `migrations: STORAGE_BUDGET_MIGRATIONS`. We exercise the
    // migration logic by testing the exported function directly rather than
    // driving WXT's internal version-runner: the `defineItem` instance is a
    // module-level singleton whose version resolution is cached at import time,
    // so seeding raw `$`-meta after import is order-dependent and would test
    // WXT's runner (a framework concern) rather than our migration.
  });
});
