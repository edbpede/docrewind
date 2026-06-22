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
  formatCompactCount,
  formatDayLabel,
  formatHourLabel,
  formatSummaryStamp,
  opaqueLabel,
  percentLabel,
  revisionOf,
  speedLabel,
  strings,
  summaryAxisPercent,
  summaryCharCount,
  summaryEditPosition,
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

  it("adds summary axis context labels", () => {
    expect(strings.summary.axisDocStart).toBe("Start of doc");
    expect(strings.summary.axisDocEnd).toBe("End of doc");
  });

  it("formats a compact character count and clamps to zero", () => {
    expect(summaryCharCount(0)).toBe("0 chars");
    expect(summaryCharCount(-12)).toBe("0 chars");
    expect(summaryCharCount(5240)).toContain("chars");
    expect(summaryCharCount(5240).replace(/\D/g, "")).toBe("5240");
  });

  it("formats a relative edit position, clamped to [0, 100]%", () => {
    expect(summaryEditPosition(0)).toBe("At 0% of document");
    expect(summaryEditPosition(0.45)).toBe("At 45% of document");
    expect(summaryEditPosition(1)).toBe("At 100% of document");
    expect(summaryEditPosition(1.5)).toBe("At 100% of document");
    expect(summaryEditPosition(-0.2)).toBe("At 0% of document");
  });

  it("formats a compact axis count and clamps to zero", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(-5)).toBe("0");
    expect(formatCompactCount(850)).toBe("850");
    expect(formatCompactCount(1000)).toBe("1k");
    expect(formatCompactCount(1200)).toBe("1.2k");
    expect(formatCompactCount(12_000)).toBe("12k");
    expect(formatCompactCount(1_400_000)).toBe("1.4M");
  });

  it("formats a bare axis percentage, clamped to [0, 100]%", () => {
    expect(summaryAxisPercent(0)).toBe("0%");
    expect(summaryAxisPercent(0.25)).toBe("25%");
    expect(summaryAxisPercent(0.5)).toBe("50%");
    expect(summaryAxisPercent(1)).toBe("100%");
    expect(summaryAxisPercent(1.5)).toBe("100%");
    expect(summaryAxisPercent(-0.2)).toBe("0%");
  });

  it("formats an hour-axis label, prefixing the day only when asked", () => {
    const t = Date.UTC(2026, 5, 21, 9, 0, 0);
    const dayLabel = formatDayLabel(t);
    const timeOnly = formatHourLabel(t, false);
    const withDate = formatHourLabel(t, true);
    expect(timeOnly.length).toBeGreaterThan(0);
    expect(timeOnly).not.toContain(dayLabel);
    expect(withDate).toBe(`${dayLabel}, ${timeOnly}`);
    // Out-of-range stamps are rendered empty (Intl would otherwise throw).
    expect(formatHourLabel(9e15)).toBe("");
  });

  it("formats a granular hover stamp and guards out-of-range input", () => {
    const t = Date.UTC(2026, 5, 21, 14, 45, 0);
    expect(formatSummaryStamp(t).length).toBeGreaterThan(0);
    expect(formatSummaryStamp(9e15)).toBe("");
  });
});
