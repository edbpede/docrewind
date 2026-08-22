// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Document-summary page mount. Imports the UnoCSS virtual stylesheet ONCE and
// renders the Svelte <App/> into #app. No React, no bare `uno.css`.

import { mount } from "svelte";
import "virtual:uno.css";
import App from "./App.svelte";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app mount point in summary/index.html.");
}

mount(App, { target: root });
