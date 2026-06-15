<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# DocRewind

Local-first browser extension that reconstructs and replays the revision history
of a Google Doc — entirely on your own machine, with no backend, account, or
telemetry.

## Build from source

DocRewind is **Bun-only**. Both the Chromium and Firefox MV3 extensions are built
from one codebase by [WXT](https://wxt.dev).

```sh
bun install --frozen-lockfile
bun run postinstall      # wxt prepare — generates .wxt/ types
bun run build            # → .output/chrome-mv3
bun run build:firefox    # → .output/firefox-mv3
```

Load the unpacked build:

- **Chromium:** open `chrome://extensions`, enable **Developer mode**, click
  **Load unpacked**, and select `.output/chrome-mv3`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load
  Temporary Add-on…**, and select the `manifest.json` inside `.output/firefox-mv3`.

## Usage

1. Open a Google Doc you can already access.
2. Activate DocRewind via its in-page affordance (it never auto-loads history).
3. DocRewind retrieves and reconstructs the revision history locally, then opens
   the replay tab.
4. Play, pause, change speed, or scrub the timeline. Clear cached data anytime
   from the options page.
