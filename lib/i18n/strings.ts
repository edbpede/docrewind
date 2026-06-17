// SPDX-License-Identifier: AGPL-3.0-or-later
//
// User-visible string catalog (plan Phase 5 Step 3 / PRD §9.12). A PURE, typed,
// browser-free catalog centralizing every string the UI shows: control labels,
// ARIA names + value-text, opaque-structure labels, PrivacyBanner copy, options
// copy, diagnostic mode names. The reconstruction core (render.ts) imports the
// opaque labels from here so it never hard-codes English. No i18n runtime ships
// in the MVP — the structure (one catalog + typed accessors) is what later
// enables a `_locales` backend. Bun-importable (no `#imports`/DOM).

import type { OpaqueStructure } from "../decoder/types";
import type { RetrievalErrorCategory } from "../retrieval/errors";

/**
 * One human label per non-text structure. `satisfies Record<OpaqueStructure, …>`
 * makes adding an `OpaqueStructure` without a label a compile error, so the
 * viewport can never fall back to a raw structure token.
 */
const opaqueLabels = {
  image: "Image",
  table: "Table",
  footnote: "Footnote",
  equation: "Equation",
  drawing: "Drawing",
  "list-format": "List formatting",
  "comment-ref": "Comment",
} as const satisfies Record<OpaqueStructure, string>;

/**
 * A short title per retrieval-error category. Components render this (and the
 * category's own `userMessage`/`suggestedAction` from retrievalError) — never
 * `String(caughtError)` (§13.7).
 */
const errorTitles = {
  "unsupported-page": "Not a document",
  "missing-doc-id": "Couldn't read the document id",
  "insufficient-permission": "No access to history",
  "endpoint-unavailable": "Retrieval unavailable",
  "unsupported-format": "Unrecognized format",
  "network-failure": "Network problem",
  "quota-failure": "Storage full",
  "reconstruction-failure": "Couldn't reconstruct",
  cancellation: "Retrieval cancelled",
} as const satisfies Record<RetrievalErrorCategory, string>;

/** The full English catalog. Static strings only — parameterized text uses the accessors below. */
export const strings = {
  app: {
    title: "DocRewind — revision replay",
    brandName: "DocRewind",
    mastheadEyebrow: "Revision replay",
    mastheadTitle: "The document, rebuilt from its own revision history.",
    optionsLink: "Settings & privacy",
    loadFailed: "Couldn't load this replay",
    loadFailedHint: "Reload the document tab and activate DocRewind again.",
    emptyReplayTitle: "No replay data",
    emptyReplayHint: "DocRewind did not find any revision chunks to reconstruct.",
  },
  privacy: {
    bannerTitle: "This is a reconstruction, not the live document.",
    bannerBody:
      "DocRewind rebuilds the document from its revision history on your device. " +
      "Nothing is sent anywhere, and formatting is approximate.",
    approximationNote:
      "Insert and delete timing is exact; suggestion visibility at earlier frames is approximate.",
  },
  controls: {
    play: "Play",
    pause: "Pause",
    restart: "Restart",
    speedGroup: "Playback speed",
  },
  timeline: {
    label: "Revision timeline",
    legendLabel: "Marks",
    markerSession: "Editing session",
    markerLargeInsertion: "Large insertion",
    markerLargeDeletion: "Large deletion",
    markerPause: "Pause",
    inspectHint: "Click to inspect",
    closeDetails: "Close details",
    jumpTo: "Jump to",
  },
  viewport: {
    suggestedInsert: "Suggested insertion",
    markedForDeletion: "Marked for deletion",
    empty: "Nothing has been written yet at this point.",
  },
  progress: {
    discovering: "Discovering revisions…",
    fetching: "Fetching revisions",
    retry: "Try again",
    cancel: "Cancel",
  },
  insights: {
    heading: "Insights",
    sessions: "Editing sessions",
    largeEdits: "Large edits",
    pauses: "Pauses",
    span: "Revisions spanned",
    duration: "Replay duration",
    durationUnknown: "—",
    attributionCaveat: "Attribution may be incomplete.",
  },
  options: {
    title: "DocRewind settings",
    privacyHeading: "Privacy",
    privacyBody:
      "DocRewind is local-first. It reads a document's revision history only when you " +
      "ask it to, stores everything on this device, and never sends data to any server " +
      "or includes any analytics or telemetry.",
    cacheHeading: "Cached data",
    clearCurrent: "Clear this document",
    clearAll: "Clear all documents",
    clearConfirm: "This permanently deletes the cached history. Continue?",
    maintenancePending: "Storage cleanup is pending and will retry automatically.",
    maintenanceFailed: "Storage cleanup could not be confirmed and will retry automatically.",
    usageUnknown: "Storage usage is unavailable.",
    diagnosticsHeading: "Diagnostics",
    diagnosticsBody: "Choose how much structural detail DocRewind records while decoding.",
    settingsHeading: "Preferences",
    themeLabel: "Theme",
    themeSystem: "Match system",
    themeLight: "Light",
    themeDark: "Dark",
    keepRawLabel: "Keep raw data for re-decoding",
    keepRawHint: "When disabled, raw data is discarded once no replay or decode is using it.",
    realIdentitiesLabel: "Show real account identities",
    perDocumentCapLabel: "Per-document cap (MB)",
    globalCapLabel: "Global cap (MB)",
    diagnosticsDefault: "Default",
    diagnosticsStructural: "Structural",
  },
  popup: {
    tagline: "Replay a Google Doc's revision history — locally.",
    description:
      "DocRewind reconstructs a document from its own edit history and plays it back, " +
      "entirely on this device. Open a Google Doc, then activate DocRewind from the page " +
      "to begin.",
    privacyNote: "Local-first · no account · no telemetry",
    optionsButton: "Options",
    aboutButton: "About",
    backButton: "Back",
    backHint: "Back to overview",
    aboutHeading: "About DocRewind",
    versionLabel: "Version",
    authorLabel: "Author",
    licenseLabel: "License",
    sourceLabel: "Source",
    licenseValue: "AGPL-3.0-or-later",
    authorHandle: "edbpede",
    authorUrl: "https://github.com/edbpede",
    sourceText: "github.com/edbpede/docrewind",
    sourceUrl: "https://github.com/edbpede/docrewind",
  },
} as const;

// ── Parameterized accessors ──────────────────────────────────────────────────

/** Human label for a non-text structure (e.g. "Table"). */
export function opaqueLabel(structure: OpaqueStructure): string {
  return opaqueLabels[structure];
}

/** Short title for a classified retrieval error. */
export function errorTitle(category: RetrievalErrorCategory): string {
  return errorTitles[category];
}

/** Slider value-text, e.g. "Revision 12 of 340". */
export function revisionOf(current: number, total: number): string {
  return `Revision ${current} of ${total}`;
}

/**
 * Range value-text for a stacked cluster of marks, e.g. "Revisions 140–148 of
 * 148". Collapses to the single-frame form when the burst spans one revision.
 */
export function revisionRangeOf(start: number, end: number, total: number): string {
  return start === end ? revisionOf(start, total) : `Revisions ${start}–${end} of ${total}`;
}

/** Stacked-seal title for a collision cluster, e.g. "5 marks" (n is always ≥ 2). */
export function clusterCountLabel(n: number): string {
  return `${n} marks`;
}

/** Speed multiplier label, e.g. "2×". */
export function speedLabel(multiplier: number): string {
  return `${multiplier}×`;
}

/** Determinate progress figure, e.g. "42%". Rendered as a tabular-nums readout
 *  beside the "Fetching revisions" label, so the label and the number are
 *  separate typographic roles rather than one run of text. */
export function percentLabel(pct: number): string {
  return `${pct}%`;
}

/** Opaque, stable author label (real identities are never surfaced by default). */
export function authorLabel(index: number): string {
  return `Author ${index + 1}`;
}

/**
 * Human, compact duration from milliseconds (e.g. "45s", "12m", "1h 5m"). Pure
 * and metadata-only — shared by the insights colophon and the timeline tooltips.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

// ── Timeline-marker detail lines (content-free hover/focus data) ──────────────
// These describe a marker's revision activity using counts and timing only —
// never any document text — so the hover tooltip stays within the privacy model.

/** Editing-session detail, e.g. "1,240 inserted · 320 deleted". */
export function sessionDetail(charsInserted: number, charsDeleted: number): string {
  return `${charsInserted.toLocaleString()} inserted · ${charsDeleted.toLocaleString()} deleted`;
}

/** Large-edit detail from a signed char delta, e.g. "+1,240 characters". */
export function largeEditDetail(charDelta: number): string {
  const sign = charDelta < 0 ? "−" : "+"; // U+2212 MINUS SIGN for deletions
  return `${sign}${Math.abs(charDelta).toLocaleString()} characters`;
}

/** Pause detail from a gap duration, e.g. "12m without edits". */
export function pauseDetail(durationMs: number): string {
  return `${formatDuration(durationMs)} without edits`;
}
