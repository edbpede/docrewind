// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay page mount (plan Phase 5 Step 7). Imports the UnoCSS virtual stylesheet
// ONCE and renders the Svelte <App/> into #app. No React, no bare `uno.css`.

import { mount } from "svelte";
import "virtual:uno.css";
import App from "./App.svelte";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app mount point in replay/index.html.");
}

mount(App, { target: root });
