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
    markerSession: "Editing session",
    markerLargeInsertion: "Large insertion",
    markerLargeDeletion: "Large deletion",
    markerPause: "Pause",
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
    realIdentitiesLabel: "Show real account identities",
    perDocumentCapLabel: "Per-document cap (MB)",
    globalCapLabel: "Global cap (MB)",
    diagnosticsDefault: "Default",
    diagnosticsStructural: "Structural",
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

/** Speed multiplier label, e.g. "2×". */
export function speedLabel(multiplier: number): string {
  return `${multiplier}×`;
}

/** Determinate progress label, e.g. "Fetching revisions — 42%". */
export function fetchingPercent(pct: number): string {
  return `${strings.progress.fetching} — ${pct}%`;
}

/** Opaque, stable author label (real identities are never surfaced by default). */
export function authorLabel(index: number): string {
  return `Author ${index + 1}`;
}
