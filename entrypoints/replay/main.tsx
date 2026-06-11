// SPDX-License-Identifier: AGPL-3.0-or-later
// Phase 5 replaces this entrypoint wholesale per the `frontend-design` skill — do not extend.
// It exists in Phase 2 only to validate the JSX → Solid → UnoCSS → virtual:uno.css
// build pipeline end-to-end at gate time.
import { render } from "solid-js/web";
import "virtual:uno.css";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app mount point in replay/index.html.");

render(() => <div class="btn">ok</div>, root);
