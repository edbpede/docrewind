// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Popup mount. WXT auto-detects this entrypoint and adds `action.default_popup`
// to the generated manifest (no permission needed — `action` is permission-free,
// so the privacy invariant holds). Imports the UnoCSS virtual stylesheet ONCE
// (which also carries the preflight reset that zeroes the popup body margin) and
// renders the Solid <PopupApp/> into #app.

import { render } from "solid-js/web";
import "virtual:uno.css";
import PopupApp from "@/components/PopupApp";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app mount point in popup/index.html.");
}

render(() => <PopupApp />, root);
