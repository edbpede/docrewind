// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Google Classroom content script (Classroom support). Mounts the same
// "Replay revisions" affordance an educator sees in the Docs titlebar, but inside
// the two Classroom surfaces where a student's submitted Doc is reviewed — so the
// control is "easy and intuitive to spot" in both, exactly as on Docs itself.
//
// It runs ONLY in the classroom.google.com top frame (no `allFrames`): the student
// doc is embedded as a cross-origin `docs.google.com/document/d/{id}/grading`
// iframe, and we never reach into it — we read the iframe element's `src` ATTRIBUTE
// (a same-origin read on our own page) to recover the `DocId`, then hand off to the
// background via the existing typed `activateReplay` message. The background owns
// the fetch; this script owns no network and no history load (PRD §9.2, §10.9).
//
// Two surfaces, two behaviours (see lib/docs-url/classroom.ts for the URL grammar):
//   • Grading view — the embedded doc resolves a `DocId`, so the button replays
//     directly. It is shown ONLY when a `DocId` can be read, mirroring Classroom's
//     own "educator can see this" gate (Google exposes the doc only to the authorized
//     viewer; if we can't read it, neither should the button pretend to).
//   • Submission-status view — Classroom exposes NO `DocId` here, only a link to the
//     grading view. The button records a short-lived one-shot intent and deep-links
//     into the grading view; once its embedded doc resolves there, this script
//     completes the replay the educator already asked for — one click end to end.
//
// All `browser.*`/DOM access stays inside `main(ctx)`; the only imported logic is the
// PURE URL parsing from lib (no DOM/fetch there).

import { render } from "solid-js/web";
import "virtual:uno.css";
import ReplayAffordance from "@/components/ReplayAffordance";
import { decideReconcile } from "@/lib/classroom/reconcile";
import { parseDocsUrl } from "@/lib/docs-url";
import { buildGradingPath, parseClassroomLocation } from "@/lib/docs-url/classroom";
import type { DocId } from "@/lib/domain/ids";
import type { DocumentKind } from "@/lib/domain/kind";
import { sendMessage } from "@/lib/messaging";

interface GradingDoc {
  readonly docId: DocId;
  readonly userIndex: number | null;
  readonly kind: DocumentKind;
}

// Find the embedded student doc in the grading view and recover its id + account
// slot from the iframe `src` (preferred) or the sibling `data-url` attribute Classroom
// also carries. Reads an attribute on our own page — never the cross-origin frame's DOM.
// Returns null until the iframe exists (the educator lacks access, or it hasn't loaded).
function detectGradingDoc(): GradingDoc | null {
  const iframe = document.querySelector<HTMLIFrameElement>(
    'iframe[src*="/document/d/"], iframe[src*="/document/u/"][src*="/d/"], iframe[src*="/spreadsheets/d/"], iframe[src*="/spreadsheets/u/"][src*="/d/"]',
  );
  const dataEl = document.querySelector<HTMLElement>(
    '[data-url*="/document/d/"], [data-url*="/document/u/"][data-url*="/d/"], [data-url*="/spreadsheets/d/"], [data-url*="/spreadsheets/u/"][data-url*="/d/"]',
  );
  const src = iframe?.src || dataEl?.getAttribute("data-url") || "";
  if (src === "") return null;
  const info = parseDocsUrl(src);
  if (info === null) return null;
  return { docId: info.docId, userIndex: info.userIndex, kind: info.kind };
}

// The grading view's action group (the flex row holding the native "Return" button).
// We match Material action buttons structurally by `jsname` + position — NEVER by
// their localized text — and prepend INTO this group, so our control sits inline in
// the open space to the left of "Return" on the same row. Returns null until that
// row exists.
function findGradingActionGroup(): Element | null {
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>('[jsname="LgbsSe"][role="button"]'),
  );
  let best: HTMLElement | null = null;
  let bestRight = Number.NEGATIVE_INFINITY;
  for (const button of buttons) {
    const rect = button.getBoundingClientRect();
    // Top action row only (the doc toolbar lives below ~y=120), and on-screen.
    if (rect.width === 0 || rect.top > 160) continue;
    if (rect.right > bestRight) {
      best = button;
      bestRight = rect.right;
    }
  }
  return best?.parentElement ?? null;
}

// Whether an element is actually laid out (rendered), not merely present-but-hidden.
// `getClientRects()` is empty for a node inside a `display:none` subtree (at any depth)
// and for a zero-box node — exactly the off-screen grading links Classroom keeps in the
// DOM. (`HTMLElement.offsetParent` would also catch `display:none` but is additionally
// null for `position:fixed` nodes; the client-rect test is the "is it on screen" property
// we actually want here, and it mirrors the rect guard in `findGradingActionGroup`.)
function isRendered(el: Element): boolean {
  return el.getClientRects().length > 0;
}

// The submission-status detail card linking to the selected student's grading view.
// Matched by the studentId in the URL so we anchor to the right card when several
// students are listed. Classroom preloads a SECOND, `display:none` copy of this grading
// link in the grouped student list it renders during SPA navigation, and that hidden
// copy sorts BEFORE the visible card in DOM order — so a plain `querySelector` would
// anchor the button inside the hidden node and it would never appear (the visible card
// only "wins" on a cold full reload, where the grouped list isn't preloaded). Return the
// first RENDERED match so the button always mounts beside the on-screen card. A transient
// null while it (re)renders is held by `decideReconcile`, never torn down.
function findSubmissionCard(studentId: string): Element | null {
  const matches = document.querySelectorAll<HTMLElement>(
    `a[href*="/g/tg/"][href*="u=${studentId}"]`,
  );
  for (const match of matches) {
    if (isRendered(match)) return match;
  }
  return null;
}

// ── One-shot deep-link intent (submission view → grading view → replay) ─────────
// Recorded in the page's sessionStorage so it survives the navigation between the two
// Classroom surfaces, then consumed exactly once when the grading view's doc resolves.
// Short TTL + an assignment/student match keep a stale intent from firing on an
// unrelated later visit.
const INTENT_KEY = "docrewind:autoReplay";
const INTENT_TTL_MS = 60_000;

interface ReplayIntent {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly ts: number;
}

function setIntent(intent: ReplayIntent): void {
  try {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
  } catch {
    // Storage disabled/full — the button still works, the educator just clicks
    // Replay again on the grading view. No correctness impact.
  }
}

function readIntent(): ReplayIntent | null {
  try {
    const raw = sessionStorage.getItem(INTENT_KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.assignmentId !== "string" ||
      typeof record.studentId !== "string" ||
      typeof record.ts !== "number"
    ) {
      return null;
    }
    return { assignmentId: record.assignmentId, studentId: record.studentId, ts: record.ts };
  } catch {
    return null;
  }
}

function clearIntent(): void {
  try {
    sessionStorage.removeItem(INTENT_KEY);
  } catch {
    // ignore
  }
}

export default defineContentScript({
  matches: ["*://classroom.google.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    // Ask the background to open the replay surface for a resolved doc. The click is
    // the explicit user action (PRD §9.2); the content script owns neither the fetch
    // nor the surface (Seam A1) — fire-and-forget over typed messaging.
    const activate = (doc: GradingDoc): void => {
      void sendMessage("activateReplay", {
        docId: doc.docId,
        userIndex: doc.userIndex,
        kind: doc.kind,
      }).catch(() => {
        // SW restarting or page navigating away (MV3 idle termination) — swallow so
        // it isn't an unhandled rejection; the educator can simply re-activate.
      });
    };

    // The single click handler, re-reading the live context each time so a stale
    // closure can never replay the wrong (or a previous) student's doc.
    const onActivate = (): void => {
      const loc = parseClassroomLocation(location.href);
      if (loc === null) return;
      if (loc.view === "grading") {
        const doc = detectGradingDoc();
        if (doc !== null) activate(doc);
        return;
      }
      // Submission view: no DocId here. Record the intent and deep-link into the
      // grading view; `completePendingReplay` finishes the job once it loads.
      if (loc.studentId !== null) {
        setIntent({ assignmentId: loc.assignmentId, studentId: loc.studentId, ts: Date.now() });
        location.assign(
          buildGradingPath({
            classId: loc.classId,
            assignmentId: loc.assignmentId,
            studentId: loc.studentId,
            userIndex: loc.userIndex,
          }),
        );
      }
    };

    // After a deep-link from the submission view, fire the replay the educator already
    // asked for — once, for the matching student, only while the intent is fresh.
    const completePendingReplay = (): void => {
      const loc = parseClassroomLocation(location.href);
      if (loc === null || loc.view !== "grading") return;
      const intent = readIntent();
      if (intent === null) return;
      if (Date.now() - intent.ts > INTENT_TTL_MS) {
        clearIntent();
        return;
      }
      if (intent.assignmentId !== loc.assignmentId || intent.studentId !== loc.studentId) return;
      const doc = detectGradingDoc();
      if (doc === null) return; // iframe not ready yet — a later reconcile retries.
      clearIntent();
      activate(doc);
    };

    // The current mount anchor for whichever surface is showing — or null when there's
    // nothing to mount on (grading view shows the button ONLY once a DocId is readable).
    const currentAnchor = (): Element | null => {
      const loc = parseClassroomLocation(location.href);
      if (loc === null) return null;
      if (loc.view === "grading") {
        return detectGradingDoc() !== null ? findGradingActionGroup() : null;
      }
      return loc.studentId !== null ? findSubmissionCard(loc.studentId) : null;
    };

    const ui = await createShadowRootUi(ctx, {
      name: "docrewind-classroom-affordance",
      position: "inline",
      anchor: () => currentAnchor(),
      // Placement differs per surface. Grading: PREPEND into the action group so we
      // sit inline, in the open space left of "Return", on its single button row —
      // the group is a flex row, so a sibling-before would instead drop us onto a
      // SECOND row above it (its shared parent is a block), which a fixed-height
      // toolbar then clips. Submission: after the attachment card. Inline styles
      // only (no UnoCSS utility classes, which the shared-chunk dedup can drop) —
      // the button itself uses the safelisted `btn-secondary`/`btn-secondary-compact`
      // shortcuts, so it stays styled inside the shadow root.
      append: (anchor, el) => {
        const loc = parseClassroomLocation(location.href);
        if (loc?.view === "submission") anchor.after(el);
        else anchor.prepend(el);
      },
      // Keep page shortcuts from leaking into our control and vice versa.
      isolateEvents: ["keydown", "keyup", "click", "wheel"],
      onMount: (container) =>
        render(
          () => (
            <div style={{ display: "inline-flex", "align-items": "center", margin: "0 0.5rem" }}>
              <ReplayAffordance onActivate={onActivate} compact />
            </div>
          ),
          container,
        ),
      onRemove: (dispose) => {
        if (typeof dispose === "function") dispose();
      },
    });

    // Whether the current location calls for the affordance at all — kept separate
    // from whether its anchor is momentarily resolvable. Classroom re-renders the
    // grading/submission panels in place, so the anchor can blink out for a frame
    // without the view actually changing; we must not tear the button down for that.
    const affordanceApplies = (): boolean => {
      const loc = parseClassroomLocation(location.href);
      if (loc === null) return false;
      return loc.view === "grading" ? detectGradingDoc() !== null : loc.studentId !== null;
    };

    // Classroom is a heavy SPA: toolbars mount late, the doc iframe's `src` is set
    // after insertion, and switching students re-renders in place without a reload.
    // The submission card is rendered by Classroom's Wiz engine, which prunes our
    // injected sibling during post-load churn (the flicker) WITHOUT clearing WXT's
    // `ui.mounted` — so a stale "mounted" is how the button vanished permanently.
    // Reconcile keys off our own host's connectivity (`ui.shadowHost`), not just the
    // anchor's, and only removes when the view itself stops applying. Runs on DOM and
    // navigation changes, with a slow interval as a backstop for mutations we miss.
    let mountedAnchor: Element | null = null;
    const reconcile = (): void => {
      if (!ctx.isValid) return;
      const anchor = currentAnchor();
      const action = decideReconcile({
        applicable: affordanceApplies(),
        mounted: ui.mounted != null,
        hostConnected: document.contains(ui.shadowHost),
        anchorPresent: anchor !== null,
        anchorChanged: anchor !== null && anchor !== mountedAnchor,
      });
      if (action === "remove") {
        ui.remove();
        mountedAnchor = null;
      } else if (action === "mount") {
        if (ui.mounted != null) ui.remove(); // dispose the old root before re-rooting
        ui.mount();
        mountedAnchor = anchor;
      }
      completePendingReplay();
    };

    let scheduled = false;
    const schedule = (): void => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        reconcile();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "data-url", "href"],
    });
    ctx.addEventListener(window, "wxt:locationchange", schedule);
    ctx.addEventListener(window, "hashchange", schedule);
    ctx.setInterval(schedule, 2000);
    ctx.onInvalidated(() => observer.disconnect());

    schedule();
  },
});
