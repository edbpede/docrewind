// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Google Docs content script (plan §1.6 / PRD §9.2, §10.9, §11.2). Detects a
// document context, extracts its id, and mounts an unobtrusive activation
// affordance in a STYLE-ISOLATED shadow root. It does NOT auto-load history and
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
      anchor: "body",
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
    ui.mount();
  },
});
