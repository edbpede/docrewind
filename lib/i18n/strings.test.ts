// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bun key-presence/shape test for the string catalog (plan Phase 5 §3). Asserts
// every OpaqueStructure and every RetrievalErrorCategory has copy, and that the
// parameterized accessors interpolate as documented.

import { describe, expect, it } from "bun:test";
import type { OpaqueStructure } from "../decoder/types";
import type { RetrievalErrorCategory } from "../retrieval/errors";
import {
  authorActiveRange,
  authorLabel,
  errorTitle,
  opaqueLabel,
  percentLabel,
  revisionOf,
  speedLabel,
  strings,
} from "./strings";

const ALL_STRUCTURES: readonly OpaqueStructure[] = [
  "image",
  "table",
  "footnote",
  "equation",
  "drawing",
  "list-format",
  "comment-ref",
];

const ALL_ERROR_CATEGORIES: readonly RetrievalErrorCategory[] = [
  "unsupported-page",
  "missing-doc-id",
  "insufficient-permission",
  "endpoint-unavailable",
  "unsupported-format",
  "network-failure",
  "quota-failure",
  "reconstruction-failure",
  "cancellation",
];

describe("strings catalog", () => {
  it("has a non-empty label for every opaque structure", () => {
    for (const structure of ALL_STRUCTURES) {
      expect(opaqueLabel(structure).length).toBeGreaterThan(0);
    }
  });

  it("has a non-empty title for every retrieval-error category", () => {
    for (const category of ALL_ERROR_CATEGORIES) {
      expect(errorTitle(category).length).toBeGreaterThan(0);
    }
  });

  it("exposes the core chrome sections", () => {
    expect(strings.privacy.bannerTitle.length).toBeGreaterThan(0);
    expect(strings.privacy.approximationNote.length).toBeGreaterThan(0);
    expect(strings.controls.play.length).toBeGreaterThan(0);
    expect(strings.timeline.label).toBe("Revision timeline");
    expect(strings.insights.duration).toBe("Replay duration");
    expect(strings.insights.attributionCaveat.length).toBeGreaterThan(0);
    expect(strings.insights.authorEmail.length).toBeGreaterThan(0);
    expect(strings.insights.authorEdits.length).toBeGreaterThan(0);
    expect(strings.insights.authorActive.length).toBeGreaterThan(0);
    expect(strings.options.title.length).toBeGreaterThan(0);
    expect(strings.options.keepRawHint).toContain("once it's no longer needed");
    expect(strings.options.perDocumentCapLabel).toBe("Per-document cap (MB)");
    expect(strings.options.globalCapLabel).toBe("Global cap (MB)");
  });

  it("interpolates parameterized accessors", () => {
    expect(revisionOf(12, 340)).toBe("Revision 12 of 340");
    expect(speedLabel(2)).toBe("2×");
    expect(percentLabel(42)).toBe("42%");
    expect(authorLabel(0)).toBe("Author 1");
  });

  it("formats a contributor's active range", () => {
    const t0 = Date.UTC(2026, 5, 16, 9, 2, 0);
    // A single instant collapses to one stamp; a window renders a dashed range.
    expect(authorActiveRange(t0, t0)).not.toContain("–");
    const ranged = authorActiveRange(t0, t0 + 90 * 60 * 1000);
    expect(ranged).toContain("–");
  });
});
