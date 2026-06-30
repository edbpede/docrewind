// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Google Docs content script (plan §1.6 / PRD §9.2, §10.9, §11.2). Detects a
// document context, extracts its id, and mounts an unobtrusive activation
// affordance in a STYLE-ISOLATED shadow root inside the Docs titlebar button
// row, so it reads as a native part of the toolbar. It does NOT auto-load
// history and
// does NOT own the fetch — clicking asks the background to start retrieval via
// typed messaging. All `browser.*`/DOM access stays inside `main(ctx)`.

import { render } from "solid-js/web";
import "virtual:uno.css";
import ReplayAffordance from "@/components/ReplayAffordance";
import { parseDocsUrl } from "@/lib/docs-url";
import { parseOwnGaia, resolveSelfIdentity, withSelfIdentity } from "@/lib/identity/resolve";
import { sendMessage } from "@/lib/messaging";
import { realIdentities, resolvedIdentities } from "@/lib/settings";

// Read the signed-in account label from the OneGoogle bar already on the page —
// e.g. `"Google Account: Ada Lovelace\n(ada@example.com)"`. Prefer the account
// switcher anchor (it links to the accounts host), so a collaborator avatar in a
// shared doc is never mistaken for the viewer. Fall back to a structural scan
// only if that anchor is absent. Returns null when no such control is present.
function readAccountLabel(): string | null {
  const accountAnchor = document.querySelector<HTMLElement>(
    'a[href*="accounts.google.com"][aria-label]',
  );
  const preferred = accountAnchor?.getAttribute("aria-label") ?? "";
  if (preferred.includes("@")) {
    return preferred;
  }
  const controls = document.querySelectorAll<HTMLElement>(
    "a[aria-label],[role='button'][aria-label],img[alt]",
  );
  for (const el of controls) {
    const label = el.getAttribute("aria-label") ?? el.getAttribute("alt") ?? "";
    if (label.includes("@") && /account/i.test(label)) {
      return label;
    }
  }
  return null;
}

// The viewer's own Gaia id (`ogi`/`oui`) is published in the Docs bootstrap
// `<script>` flags. Scan only those script bodies — not the whole serialized DOM
// — so the read is cheap and can't pick up an id from unrelated page content.
function readBootstrapText(): string {
  let text = "";
  for (const script of document.scripts) {
    const content = script.textContent;
    if (content?.includes("ogi") || content?.includes("oui")) {
      text += content;
    }
  }
  return text;
}

// Zero-network self-identity harvest (PRD §9.7). A best-effort BONUS over the
// authoritative background tiles harvest: it reads the account label + the page's
// own Gaia id (both already on the loaded page) so the viewer's own name can show
// instantly — and even if the tiles fetch later fails. Skipped when `realIdentities`
// is off or when the page exposes neither datum.
//
// The fold itself (add an unresolved token; enrich an already-resolved one with the
// viewer's email — the one datum the tiles `userMap` can't supply — without renaming
// it) lives in the pure `withSelfIdentity`, so this stays a thin DOM/storage adapter.
// A null result means nothing changed, so we skip the redundant write.
async function harvestSelfIdentity(): Promise<void> {
  if (!(await realIdentities.getValue())) {
    return;
  }
  const ownGaia = parseOwnGaia(readBootstrapText());
  const identity = resolveSelfIdentity(ownGaia, readAccountLabel());
  if (identity === null) {
    return;
  }
  const current = await resolvedIdentities.getValue();
  const next = withSelfIdentity(current, identity);
  if (next !== null) {
    await resolvedIdentities.setValue(next);
  }
}

export default defineContentScript({
  matches: ["*://docs.google.com/document/*", "*://docs.google.com/spreadsheets/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    const info = parseDocsUrl(location.href);
    if (info === null) {
      // Not a `/document/d/{id}/` page we can handle — show no affordance.
      return;
    }

    // Mount inside the editor titlebar button group (near Share) so the control
    // reads as native. The toolbar is built asynchronously, so `autoMount` (below)
    // observes the DOM and mounts once a host matches. The exact class can vary, so
    // we list a fallback: `:has(> #…share…)` is the CSS equivalent of the share
    // button's parent.
    const titlebarAnchor = ".docs-titlebar-buttons, :has(> #docs-titlebar-share-client-button)";
    // Sheets is served by this same script, but its chrome is not guaranteed to
    // expose the Docs titlebar selectors above. autoMount would otherwise watch
    // forever and the affordance would never appear on such a surface — so on a
    // sheet, once a grace period lapses without the titlebar showing up, fall back
    // to a guaranteed host (`body`) so the control still reaches the user. Docs is
    // unaffected: the resolver below never returns anything but `titlebarAnchor`
    // for a doc, preserving the existing behavior exactly.
    const fallbackDeadline = Date.now() + 5_000;

    const ui = await createShadowRootUi(ctx, {
      name: "docrewind-affordance",
      position: "inline",
      // A function anchor, re-resolved by autoMount on each DOM change. autoMount
      // accepts `() => string`; it only rejects an `Element`/`() => Element`
      // anchor. `append: "first"` places us at the start of the row, left of the
      // version-history/comment icons.
      anchor: () => {
        if (document.querySelector(titlebarAnchor) !== null) return titlebarAnchor;
        if (info.kind === "sheet" && Date.now() >= fallbackDeadline) return "body";
        return titlebarAnchor;
      },
      append: "first",
      // Keep page shortcuts from leaking into our control and vice versa.
      isolateEvents: ["keydown", "keyup", "click", "wheel"],
      onMount: (container) =>
        render(
          () => (
            <ReplayAffordance
              onActivate={() => {
                // Explicit user action only (PRD §9.2). The content script does
                // not own the fetch or the surface (PRD §10.9, Seam A1) — it asks
                // the background to OPEN the replay tab, which then owns the full
                // load lifecycle (validates the id, drives the worker, starts
                // retrieval itself). Fire-and-forget over typed messaging.
                void sendMessage("activateReplay", {
                  docId: info.docId,
                  userIndex: info.userIndex,
                  kind: info.kind,
                }).catch(() => {
                  // Best-effort: the background SW may be restarting or the page
                  // navigating away (MV3 idle termination). Swallow the rejection
                  // so it doesn't surface as an unhandled promise rejection; the
                  // user can simply re-activate.
                });
                // Identity resolution rides on the same explicit action: harvest the
                // viewer's self identity off this page (unless the user opted out) so
                // the replay surface can label their own edits by name immediately.
                // Best-effort and independent of the activation message above.
                void harvestSelfIdentity().catch(() => {});
              }}
            />
          ),
          container,
        ),
      onRemove: (dispose) => {
        if (typeof dispose === "function") dispose();
      },
    });
    // Auto-mount: the Docs toolbar mounts after the content script runs, so
    // observe the DOM and mount once the anchor exists (and re-mount if Docs
    // re-renders the titlebar). Replaces the eager `ui.mount()`.
    ui.autoMount();
  },
});
