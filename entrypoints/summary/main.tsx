// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Document-summary page mount. Imports the UnoCSS virtual stylesheet ONCE and
// renders the Solid <App/> into #app. No React, no bare `uno.css`.

import { render } from "solid-js/web";
import "virtual:uno.css";
import App from "./App";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app mount point in summary/index.html.");
}

render(() => <App />, root);
