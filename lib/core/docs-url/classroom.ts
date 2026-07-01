// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Google Classroom URL parsing (Classroom support). PURE: extracts the class /
// assignment / student ids and the multi-account slot from the two Classroom
// surfaces an educator uses to view a student's submitted Doc, and builds the
// path-relative deep link from one to the other. No browser / fetch / DOM here —
// the DOM scraping that finds the embedded doc's `DocId` lives in the content
// script (entrypoints/classroom.content.tsx); this module only parses strings.
//
// The two surfaces (LIVE-CONFIRMED against an educator account, 2026-06-19):
//   • Submission-status view — the assignment's per-student list/detail:
//       /c/{classId}/a/{assignmentId}/submissions/by-status/.../student/{studentId}
//     The DocId is NOT present here (the attachment card is just an <a> to the
//     grading view; its thumbnail is an opaque Drive token), so this view can only
//     deep-link into the grading view, where the DocId resolves.
//   • Grading/target view — the embedded-doc grading tool:
//       /g/tg/{classId}/{assignmentId}?authuser={N}#u={studentId}
//     (Classroom drops `?authuser` to `#…&t=f` after its own redirect.) Here the
//     student doc is embedded as a `docs.google.com/document/d/{DocId}/grading`
//     iframe, so the DocId is recoverable from the DOM.
//
// The reused docs origin in `new URL(…, base)` below is a guard-compliance detail,
// not semantics: `scripts/check-no-foreign-hosts.sh` forbids any non-docs.google.com
// absolute URL literal in production code, and the base host is irrelevant here —
// only the pathname / search / hash of the (normally absolute) input are read.

import { detectUserIndex } from "@/lib/core/protocol/endpoints";

/** Which Classroom surface a URL points at. */
export type ClassroomView = "grading" | "submission";

/** A parsed Classroom location: the ids needed to identify the submission + deep-link. */
export interface ClassroomLocation {
  readonly view: ClassroomView;
  readonly classId: string;
  readonly assignmentId: string;
  /** The selected student. Present for `submission`; `grading` reads it from `#u=` (may be null). */
  readonly studentId: string | null;
  /** Multi-account slot from `authuser` (or `/u/{N}/`), or null for the default account. */
  readonly userIndex: number | null;
}

// Classroom ids are URL-safe base64-ish tokens (e.g. `MjM0MzU5OTY5MTJa`).
const ID = "[A-Za-z0-9_-]+";
// Multi-account prefix: `classroom.google.com/u/{N}/…` selects the signed-in account
// slot (the same multi-login mechanism Gmail uses as `/mail/u/{N}/`). It precedes the
// `/c/` and `/g/tg/` grammar on every surface a secondary account sees, so both path
// patterns must tolerate it — without it the regexes never match for `/u/1/…` and the
// affordance silently never mounts. Non-capturing here; the slot is read separately.
const USER_PREFIX = "(?:/u/\\d+)?";
const GRADING_PATH = new RegExp(`^${USER_PREFIX}/g/tg/(${ID})/(${ID})`);
const SUBMISSION_PATH = new RegExp(
  `^${USER_PREFIX}/c/(${ID})/a/(${ID})/submissions/[^?#]*?/student/(${ID})`,
);
// The account slot carried by that `/u/{N}/` path prefix (multi-login). Preferred over
// `?authuser` when present, since it is the account the educator is actively browsing as.
const CLASSROOM_USER_PREFIX = /^\/u\/(\d+)\//;
// The selected student rides the fragment as `#u={studentId}` (optionally `&t=f`).
const HASH_STUDENT = new RegExp(`[#&]u=(${ID})`);

// Reused only as a parsing base for path-only inputs — see the file header note.
const PARSE_BASE = "https://docs.google.com";

/**
 * Parse a Google Classroom URL into its {@link ClassroomLocation}, or `null` when it
 * is neither the grading view nor the submission-status view.
 */
export function parseClassroomLocation(url: string): ClassroomLocation | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    try {
      parsed = new URL(url, PARSE_BASE);
    } catch {
      return null;
    }
  }
  // The `/u/{N}/` path prefix is the active account slot on multi-login sessions; prefer
  // it over `?authuser`/`/document/u/{N}/d/` (what `detectUserIndex` covers) when present.
  const prefixSlot = CLASSROOM_USER_PREFIX.exec(parsed.pathname)?.[1];
  const userIndex =
    prefixSlot !== undefined ? Number.parseInt(prefixSlot, 10) : detectUserIndex(url);

  const grading = GRADING_PATH.exec(parsed.pathname);
  if (grading) {
    const classId = grading[1];
    const assignmentId = grading[2];
    if (classId === undefined || assignmentId === undefined) return null;
    const studentId = HASH_STUDENT.exec(parsed.hash)?.[1] ?? null;
    return { view: "grading", classId, assignmentId, studentId, userIndex };
  }

  const submission = SUBMISSION_PATH.exec(parsed.pathname);
  if (submission) {
    const classId = submission[1];
    const assignmentId = submission[2];
    const studentId = submission[3];
    if (classId === undefined || assignmentId === undefined || studentId === undefined) {
      return null;
    }
    return { view: "submission", classId, assignmentId, studentId, userIndex };
  }

  return null;
}

/** The fields needed to address one student's grading view. */
export interface GradingTarget {
  readonly classId: string;
  readonly assignmentId: string;
  readonly studentId: string;
  readonly userIndex: number | null;
}

/**
 * Build the PATH-RELATIVE grading-view deep link (`/g/tg/{classId}/{assignmentId}…`)
 * for a student. Path-relative by design: it resolves against the current
 * `classroom.google.com` origin at navigation time, so no foreign-host literal is
 * baked into production code (the no-foreign-hosts guard). `authuser` is appended
 * only for a real account slot; the studentId rides the fragment, matching how
 * Classroom itself addresses the view.
 */
export function buildGradingPath(target: GradingTarget): string {
  const auth =
    target.userIndex !== null && Number.isInteger(target.userIndex) && target.userIndex >= 0
      ? `?authuser=${target.userIndex}`
      : "";
  return `/g/tg/${target.classId}/${target.assignmentId}${auth}#u=${target.studentId}`;
}
