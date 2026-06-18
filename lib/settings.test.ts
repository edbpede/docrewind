// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Settings round-trip + migration (plan §1.1, Vitest tier). Uses WXT's
// fakeBrowser (in-memory storage.local), reset before each test so defaults are
// deterministic.

import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { asDocId } from "./domain/ids";
import {
  activeStorageLeases,
  beginStorageLease,
  createPendingDestructiveStorageClear,
  createPendingStorageMaintenanceRequest,
  DEFAULT_STORAGE_BUDGET,
  endStorageLease,
  getPendingDestructiveStorageClears,
  getPendingStorageMaintenance,
  hasActiveStorageLease,
  isCurrentPendingDestructiveStorageClear,
  isCurrentPendingStorageMaintenance,
  keepRawData,
  pendingDestructiveStorageClears,
  pendingStorageMaintenance,
  realIdentities,
  refreshStorageLease,
  removePendingDestructiveStorageClear,
  removePendingStorageMaintenance,
  removePendingStorageMaintenanceForScope,
  STORAGE_BUDGET_MIGRATIONS,
  storageBudget,
  theme,
  upsertPendingDestructiveStorageClear,
  upsertPendingStorageMaintenance,
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

    it("realIdentities defaults to true (PRD §9.7 — opt-out)", async () => {
      expect(await realIdentities.getValue()).toBe(true);
    });

    it("storageBudget defaults to ~50MB / ~500MB", async () => {
      expect(await storageBudget.getValue()).toEqual(DEFAULT_STORAGE_BUDGET);
    });

    it("pending storage maintenance defaults to empty", async () => {
      expect(await pendingStorageMaintenance.getValue()).toEqual([]);
    });

    it("pending destructive storage clears default to empty", async () => {
      expect(await pendingDestructiveStorageClears.getValue()).toEqual([]);
    });

    it("active storage leases default to empty", async () => {
      expect(await activeStorageLeases.getValue()).toEqual([]);
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

    it("keeps only the latest pending maintenance policy for one scope", async () => {
      const first = createPendingStorageMaintenanceRequest({
        docId: null,
        keepRawData: false,
        budget: DEFAULT_STORAGE_BUDGET,
        queuedAt: 1,
      });
      const second = createPendingStorageMaintenanceRequest({
        docId: null,
        keepRawData: true,
        budget: { perDocumentBytes: 1, globalCapBytes: 2 },
        queuedAt: 2,
      });

      await upsertPendingStorageMaintenance(first);
      await upsertPendingStorageMaintenance(second);

      expect(await getPendingStorageMaintenance()).toEqual([second]);

      await removePendingStorageMaintenance(first.id, first.queuedAt);
      expect(await getPendingStorageMaintenance()).toEqual([second]);

      await removePendingStorageMaintenance(second.id, second.queuedAt);
      expect(await getPendingStorageMaintenance()).toEqual([]);
    });

    it("coalesces document-scoped pending maintenance separately from global policy", async () => {
      const docId = asDocId("docPendingPolicy");
      const docFirst = createPendingStorageMaintenanceRequest({
        docId,
        keepRawData: false,
        budget: DEFAULT_STORAGE_BUDGET,
        queuedAt: 1,
      });
      const docSecond = createPendingStorageMaintenanceRequest({
        docId,
        keepRawData: true,
        budget: { perDocumentBytes: 1, globalCapBytes: 2 },
        queuedAt: 2,
      });
      const global = createPendingStorageMaintenanceRequest({
        docId: null,
        keepRawData: false,
        budget: DEFAULT_STORAGE_BUDGET,
        queuedAt: 3,
      });

      await upsertPendingStorageMaintenance(docFirst);
      await upsertPendingStorageMaintenance(global);
      await upsertPendingStorageMaintenance(docSecond);

      expect(await getPendingStorageMaintenance()).toEqual([global, docSecond]);
    });

    it("does not let an old completion remove a newer same-id maintenance request", async () => {
      const first = createPendingStorageMaintenanceRequest({
        docId: null,
        keepRawData: false,
        budget: DEFAULT_STORAGE_BUDGET,
        queuedAt: 1,
      });
      const second = createPendingStorageMaintenanceRequest({
        docId: null,
        keepRawData: false,
        budget: DEFAULT_STORAGE_BUDGET,
        queuedAt: 2,
      });

      await upsertPendingStorageMaintenance(first);
      await upsertPendingStorageMaintenance(second);
      await removePendingStorageMaintenance(first.id, first.queuedAt);

      expect(await getPendingStorageMaintenance()).toEqual([second]);

      await removePendingStorageMaintenance(second.id, second.queuedAt);
      expect(await getPendingStorageMaintenance()).toEqual([]);
    });

    it("detects current pending maintenance by scope id and queuedAt", async () => {
      const first = createPendingStorageMaintenanceRequest({
        docId: null,
        keepRawData: false,
        budget: DEFAULT_STORAGE_BUDGET,
        queuedAt: 1,
      });
      const second = createPendingStorageMaintenanceRequest({
        docId: null,
        keepRawData: true,
        budget: DEFAULT_STORAGE_BUDGET,
        queuedAt: 2,
      });

      await upsertPendingStorageMaintenance(first);
      await upsertPendingStorageMaintenance(second);

      expect(await isCurrentPendingStorageMaintenance(first)).toBe(false);
      expect(await isCurrentPendingStorageMaintenance(second)).toBe(true);
    });

    it("removes pending maintenance by destructive-clear scope", async () => {
      const docId = asDocId("docPendingPolicy");
      const docRequest = createPendingStorageMaintenanceRequest({
        docId,
        keepRawData: false,
        budget: DEFAULT_STORAGE_BUDGET,
        queuedAt: 1,
      });
      const globalRequest = createPendingStorageMaintenanceRequest({
        docId: null,
        keepRawData: false,
        budget: DEFAULT_STORAGE_BUDGET,
        queuedAt: 2,
      });

      await upsertPendingStorageMaintenance(docRequest);
      await upsertPendingStorageMaintenance(globalRequest);
      await removePendingStorageMaintenanceForScope(docId);

      expect(await getPendingStorageMaintenance()).toEqual([globalRequest]);

      await removePendingStorageMaintenanceForScope(null);
      expect(await getPendingStorageMaintenance()).toEqual([]);
    });

    it("coalesces duplicate pending destructive clears by scope", async () => {
      const first = createPendingDestructiveStorageClear({
        kind: "document",
        docId: asDocId("docClearSettings"),
        queuedAt: 1,
      });
      const second = createPendingDestructiveStorageClear({
        kind: "document",
        docId: asDocId("docClearSettings"),
        queuedAt: 2,
      });

      await upsertPendingDestructiveStorageClear(first);
      await upsertPendingDestructiveStorageClear(second);

      expect(await getPendingDestructiveStorageClears()).toEqual([second]);
      expect(await isCurrentPendingDestructiveStorageClear(first)).toBe(false);
      expect(await isCurrentPendingDestructiveStorageClear(second)).toBe(true);

      await removePendingDestructiveStorageClear(second);
      expect(await getPendingDestructiveStorageClears()).toEqual([]);
    });

    it("does not let an old completion remove a newer same-id destructive clear", async () => {
      const docId = asDocId("docClearSettings");
      const first = createPendingDestructiveStorageClear({
        kind: "document",
        docId,
        queuedAt: 1,
      });
      const second = createPendingDestructiveStorageClear({
        kind: "document",
        docId,
        queuedAt: 2,
      });

      await upsertPendingDestructiveStorageClear(first);
      await upsertPendingDestructiveStorageClear(second);
      await removePendingDestructiveStorageClear(first);

      expect(await getPendingDestructiveStorageClears()).toEqual([second]);

      await removePendingDestructiveStorageClear(second);
      expect(await getPendingDestructiveStorageClears()).toEqual([]);
    });

    it("tracks durable storage leases by document with count and expiry", async () => {
      const docId = asDocId("docLeaseSettings");

      await beginStorageLease(docId, 1_000);
      await beginStorageLease(docId, 2_000);
      await refreshStorageLease(docId, 3_000);

      expect(await hasActiveStorageLease(docId, 4_000)).toBe(true);
      expect(await hasActiveStorageLease(null, 4_000)).toBe(true);
      expect(await activeStorageLeases.getValue()).toEqual([
        {
          id: "storage-lease:docLeaseSettings",
          docId,
          count: 2,
          updatedAt: 3_000,
        },
      ]);

      await endStorageLease(docId, 3_000);
      expect(await hasActiveStorageLease(docId, 4_000)).toBe(true);

      await endStorageLease(docId, 4_000);
      expect(await hasActiveStorageLease(docId, 5_000)).toBe(false);
      expect(await activeStorageLeases.getValue()).toEqual([]);
    });

    it("serializes overlapping durable storage lease mutations", async () => {
      const docId = asDocId("docConcurrentLease");

      await Promise.all([
        beginStorageLease(docId, 1_000),
        beginStorageLease(docId, 1_001),
        beginStorageLease(docId, 1_002),
      ]);

      expect(await activeStorageLeases.getValue()).toEqual([
        {
          id: "storage-lease:docConcurrentLease",
          docId,
          count: 3,
          updatedAt: 1_002,
        },
      ]);

      await Promise.all([endStorageLease(docId, 2_000), endStorageLease(docId, 2_001)]);

      expect(await activeStorageLeases.getValue()).toEqual([
        {
          id: "storage-lease:docConcurrentLease",
          docId,
          count: 1,
          updatedAt: 2_001,
        },
      ]);
      expect(await hasActiveStorageLease(docId, 2_002)).toBe(true);
    });

    it("expires stale durable storage leases", async () => {
      const docId = asDocId("docOldLease");

      await beginStorageLease(docId, 1_000);

      expect(await hasActiveStorageLease(docId, 1_000 + 10 * 60 * 1000 + 1)).toBe(false);
      expect(await activeStorageLeases.getValue()).toEqual([]);
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
