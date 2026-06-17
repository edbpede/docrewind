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

### Extension icon

The brand icon lives at `public/icon/docrewind.svg`. The sized PNGs WXT wires into
the manifest (`public/icon/{16,32,48,96,128}.png`) are **committed** so the build
stays deterministic and free of a build-time rasterizer. Re-render them only when
the art changes:

```sh
./scripts/generate-icons.sh   # needs librsvg (rsvg-convert) or ImageMagick
```

## Usage

1. Open a Google Doc you can already access.
2. Activate DocRewind via its in-page affordance (it never auto-loads history).
3. DocRewind retrieves and reconstructs the revision history locally, then opens
   the replay tab.
4. Play, pause, change speed, or scrub the timeline. Clear cached data anytime
   from the options page.

Clicking the toolbar icon opens a small popup with a one-line description and
quick access to **Options** and an **About** panel (version, author, license,
source). It opens no document data and requests no extra permissions.
