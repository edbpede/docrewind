// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { decideReconcile, isEngaged, type ReconcileState } from "./reconcile";

// A correctly-mounted, stable affordance — the steady state. Spread + override per case.
const STABLE: ReconcileState = {
  applicable: true,
  mounted: true,
  hostConnected: true,
  anchorPresent: true,
  anchorChanged: false,
};

describe("decideReconcile — view applicability gate", () => {
  test("removes a mounted button when the view no longer applies", () => {
    expect(decideReconcile({ ...STABLE, applicable: false })).toBe("remove");
  });

  test("does nothing when the view does not apply and nothing is mounted", () => {
    expect(decideReconcile({ ...STABLE, applicable: false, mounted: false })).toBe("none");
  });
});

describe("decideReconcile — first mount", () => {
  test("mounts when applicable, anchor present, and not yet mounted", () => {
    expect(decideReconcile({ ...STABLE, mounted: false, hostConnected: false })).toBe("mount");
  });
});

describe("decideReconcile — the flicker fix (external host prune)", () => {
  test("remounts when WXT still reports mounted but our host was pruned out", () => {
    // This is the regression: anchor still present, ui.mounted truthy, yet the host
    // was removed by Classroom's renderer. The old guard returned "none" here.
    expect(decideReconcile({ ...STABLE, hostConnected: false })).toBe("mount");
  });
});

describe("decideReconcile — transient anchor loss must NOT tear down", () => {
  test("holds the mount when the anchor blinks out but the view still applies", () => {
    expect(decideReconcile({ ...STABLE, anchorPresent: false })).toBe("none");
  });

  test("holds even if the host also went with the briefly-detached anchor", () => {
    expect(decideReconcile({ ...STABLE, anchorPresent: false, hostConnected: false })).toBe("none");
  });
});

describe("decideReconcile — re-anchor on student switch", () => {
  test("remounts when the resolved anchor changed identity", () => {
    expect(decideReconcile({ ...STABLE, anchorChanged: true })).toBe("mount");
  });
});

describe("decideReconcile — steady state", () => {
  test("does nothing when mounted, connected, anchored, and unchanged", () => {
    expect(decideReconcile(STABLE)).toBe("none");
  });
});

describe("isEngaged — the idle gate", () => {
  test("engaged on an applicable route even before anything mounted (anchor may resolve late)", () => {
    expect(isEngaged({ routeApplicable: true, uiUp: false })).toBe(true);
  });

  test("engaged while the UI is still up after the route stopped applying (teardown owed)", () => {
    expect(isEngaged({ routeApplicable: false, uiUp: true })).toBe(true);
  });

  test("engaged on an applicable route with the UI up (steady grading state)", () => {
    expect(isEngaged({ routeApplicable: true, uiUp: true })).toBe(true);
  });

  test("disengaged on non-applicable views with nothing mounted — zero reconcile work allowed", () => {
    expect(isEngaged({ routeApplicable: false, uiUp: false })).toBe(false);
  });
});
