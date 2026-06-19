// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay page mount (plan Phase 5 Step 7). Imports the UnoCSS virtual stylesheet
// ONCE and renders the Solid <App/> into #app. No React, no bare `uno.css`.

import { render } from "solid-js/web";
import "virtual:uno.css";
import "@/assets/fonts.css";
import App from "./App";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app mount point in replay/index.html.");
}

render(() => <App />, root);
