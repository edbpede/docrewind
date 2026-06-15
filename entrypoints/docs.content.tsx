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
import { sendMessage } from "@/lib/messaging";

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
      // reads as native. The toolbar is built asynchronously and the exact class
      // can vary, so resolve the anchor lazily with fallbacks; `autoMount` (below)
      // re-evaluates this until a host appears. `append: "first"` places us at the
      // start of the row, left of the version-history/comment icons.
      anchor: () =>
        document.querySelector(".docs-titlebar-buttons") ??
        document.querySelector("#docs-titlebar-share-client-button")?.parentElement ??
        document.querySelector("#docs-menubar"),
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
