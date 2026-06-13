// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Options page mount (plan Phase 5 Step 8). WXT auto-detects this entrypoint and
// adds `options_ui` to the generated manifest (no permission needed). Imports the
// UnoCSS virtual stylesheet ONCE and renders the Solid <OptionsApp/> into #app.

import { render } from "solid-js/web";
import "virtual:uno.css";
import OptionsApp from "@/components/OptionsApp";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app mount point in options/index.html.");
}

render(() => <OptionsApp />, root);
