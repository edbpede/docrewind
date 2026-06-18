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
import { parseOwnGaia, resolveSelfIdentity } from "@/lib/identity/resolve";
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
    if (content?.includes("ogi")) {
      text += content;
    }
  }
  return text;
}

// Opt-in, zero-network identity harvest (PRD §9.7). ONLY runs when the user has
// enabled `realIdentities`: it reads the account label + the page's own Gaia id
// (both already present in the loaded page) and caches the resolved self identity
// for the replay surface. No-op — and nothing stored — when the toggle is off or
// the page exposes neither datum, so the default path stays content-free.
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
  if (current[identity.userId]?.name === identity.name) {
    return; // already cached — avoid a redundant write
  }
  await resolvedIdentities.setValue({ ...current, [identity.userId]: identity });
}

export default defineContentScript({
  matches: ["*://docs.google.com/document/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    const info = parseDocsUrl(location.href);
    if (info === null) {
      // Not a `/document/d/{id}/` page we can handle — show no affordance.
      return;
    }

    const ui = await createShadowRootUi(ctx, {
      name: "docrewind-affordance",
      position: "inline",
      // Mount inside the Docs titlebar button group (near Share) so the control
      // reads as native. The toolbar is built asynchronously, so `autoMount`
      // (below) observes the DOM and mounts once a host matches. autoMount drives
      // a MutationObserver off this selector and REJECTS an `Element`/`() => Element`
      // anchor, so it must be a string. The exact class can vary, so we list a
      // fallback: `:has(> #…share…)` is the CSS equivalent of the share button's
      // parent. `append: "first"` places us at the start of the row, left of the
      // version-history/comment icons.
      anchor: ".docs-titlebar-buttons, :has(> #docs-titlebar-share-client-button)",
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
                }).catch(() => {
                  // Best-effort: the background SW may be restarting or the page
                  // navigating away (MV3 idle termination). Swallow the rejection
                  // so it doesn't surface as an unhandled promise rejection; the
                  // user can simply re-activate.
                });
                // Opt-in identity resolution rides on the same explicit action:
                // harvest the self identity off this page (only when enabled) so
                // the replay surface can label the author by name. Best-effort and
                // independent of the activation message above.
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
