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
    bannerSummary: "What am I looking at?",
    bannerTitle: "This is a reconstruction, not the live document.",
    bannerBody:
      "DocRewind rebuilds the document from its revision history on your device. " +
      "Nothing is sent anywhere, and formatting is approximate.",
    approximationNote:
      "The order and timing of edits is exact. A few details — like exactly when a " +
      "suggestion first appeared — are approximate.",
  },
  controls: {
    play: "Play",
    pause: "Pause",
    restart: "Restart",
    speedGroup: "Playback speed",
    // The "follow edits" transport toggle: when on, the viewport auto-scrolls to keep
    // the writing caret in view during non-linear playback (jumping between sections).
    followCaret: "Follow edits",
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
    // Authorship attribution: the off-screen description linked (via aria-describedby)
    // to every segment highlighted while a contributor is foregrounded. Combined with
    // the author's display name by `contributedBy` so assistive tech announces who
    // wrote the highlighted run. Content-free: a name only, never document text.
    contributedBy: "Contributed by",
    // The off-screen affordance shown when "follow edits" is off and the active edit
    // has scrolled out of view — clicking it re-engages follow and snaps to the caret.
    jumpToEdit: "Jump to edit",
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
    // Author detail card (hover/click on a contributor chip). Content-free: a name,
    // the viewer's own email when known, and counts/timing only — never document text.
    // The email row renders only when an address is known: the viewer themselves, or a
    // collaborator whose email was resolved from the sharing ACL. Otherwise it's omitted.
    authorDetailsHint: "Show contributor details",
    authorEmail: "Email",
    authorEdits: "Revisions",
    authorActive: "Active",
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
    keepRawLabel: "Keep the original history on this device",
    keepRawHint:
      "Lets DocRewind rebuild this replay later without downloading it again. " +
      "When off, the original history is cleared once it's no longer needed, to save space.",
    realIdentitiesLabel: "Show real author names",
    realIdentitiesHint:
      "On by default. Shows each contributor's real name, read from Google's version " +
      "history for this document. Names stay only in this browser session — never saved " +
      "to your device and never sent anywhere else. Turn this off to label contributors as " +
      '"Author 1", "Author 2" instead.',
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

/** Opaque, stable author label — the fallback when a real name is unresolved or
 * when identity display is turned off. */
export function authorLabel(index: number): string {
  return `Author ${index + 1}`;
}

/** Off-screen attribution label for a highlighted run, e.g. "Contributed by Author 1". */
export function contributedBy(authorLabelText: string): string {
  return `${strings.viewport.contributedBy} ${authorLabelText}`;
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

// ── Author detail card range (content-free contributor timing) ────────────────

/** One epoch-ms stamp as a localized "medium date + short time" (e.g. "Jun 16, 2026, 10:02 AM"). */
function formatStamp(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * A contributor's active window from first→last edit, e.g.
 * "Jun 16, 2026, 10:02 AM – 11:40 AM" (same day collapses the trailing date) or the
 * single stamp when first === last. Timestamps only — no document text — so it stays
 * within the content-free insights model.
 */
export function authorActiveRange(firstMs: number, lastMs: number): string {
  // The decoder admits any finite number, but values beyond the Date epoch bound
  // (±8.64e15 ms) render as "Invalid Date". Out-of-range stamps degrade to blank.
  if (Math.abs(firstMs) > 8.64e15 || Math.abs(lastMs) > 8.64e15) {
    return "";
  }
  const first = formatStamp(firstMs);
  if (firstMs === lastMs) {
    return first;
  }
  const sameDay = new Date(firstMs).toDateString() === new Date(lastMs).toDateString();
  const last = sameDay
    ? new Date(lastMs).toLocaleString(undefined, { timeStyle: "short" })
    : formatStamp(lastMs);
  return `${first} – ${last}`; // U+2013 EN DASH
}
