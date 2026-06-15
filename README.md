<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# DocRewind

**Replay the revision history of your Google Docs — entirely on your own machine.**

DocRewind is a local-first browser extension that reconstructs and plays back how
a Google Doc was written. It activates on a document you already have open,
retrieves the fine-grained revision changelog using **your own authenticated
session**, rebuilds the text-focused edit history locally, and presents an
interactive replay timeline you can scrub, play, and pause.

There is **no backend, no account, no telemetry, and zero non-Google network
requests**. Everything happens in your browser; the revision data never leaves
your machine.

> [!IMPORTANT]
> **DocRewind shows a *reconstruction*, not a recording.** It is built from
> Google Docs' internal, undocumented revision data and **may be incomplete or
> affected by Google Docs behavior**. It is descriptive — "show what changed" —
> and must **not** be used as the sole basis for disciplinary, academic-integrity,
> or other high-stakes decisions (PRD §21). DocRewind is **not affiliated with
> Google or Draftback**.

---

## What it does

- **Manual, per-document activation** — DocRewind never loads or stores revision
  history until you explicitly activate it on a supported document.
- **Local reconstruction** — decoding, reconstruction, and timeline derivation run
  on your machine (heavy work in a Web Worker); results are cached in IndexedDB.
- **Interactive replay** — play, pause, restart, change speed, and scrub through
  the document's edit timeline.
- **Activity timeline** — writing sessions, large insertions, deletions, and
  pauses, with uncertainty shown where grouping is inferred.
- **Local cache controls** — clear the current document or all cached data from
  the options page.

Plain-text insertions/deletions, their ordering and timestamps, and paragraph
structure are reconstructed faithfully (the MVP fidelity bar, PRD §15.3).
Images, tables, footnotes, equations, drawings, list formatting, and comments are
shown as labeled placeholders or timeline annotations and never abort playback.

## Supported browsers

| Browser | Support | Notes |
|---------|---------|-------|
| Chromium (Chrome, Edge, Brave, …) | First-class (MV3 service worker) | Automated E2E coverage (Playwright). |
| Firefox | First-class (MV3 event page) | Validated manually + `web-ext` — Playwright cannot load a Firefox extension (see [`docs/firefox-validation.md`](docs/firefox-validation.md)). |

Both extensions are built from **one codebase** by [WXT](https://wxt.dev); the
manifests are generated per browser and never hand-written.

## Privacy

DocRewind's privacy guarantees are canonical in [`PRIVACY.md`](PRIVACY.md)
(mirroring PRD §13). In short:

- No remote backend; the only network requests are to Google Docs origins, using
  your existing session, for the current document.
- No analytics, crash reporting, third-party tracking, or remote feature flags.
- No account creation; browser-local persistence only.
- Host permissions limited to `*://docs.google.com/*` — never `<all_urls>`.

See also [`SECURITY.md`](SECURITY.md) for the threat model and how to report a
vulnerability.

## Install

> DocRewind is pre-1.0 and not yet listed on the Chrome Web Store or AMO. Install
> from a verified release archive.

### Install from a release (verify the checksum first)

1. Download the artifacts for the release from the
   [Releases page](https://github.com/edbpede/docrewind/releases):
   - `docrewind-<version>-chrome.zip` (Chromium) or
     `docrewind-<version>-firefox.zip` (Firefox)
   - `SHA256SUMS`
2. **Verify the download** against the published checksums before unzipping:

   ```sh
   # macOS
   shasum -a 256 --ignore-missing -c SHA256SUMS
   # Linux
   sha256sum --ignore-missing -c SHA256SUMS
   ```

   `SHA256SUMS` covers every release archive, so `--ignore-missing` skips the
   ones you did not download. Each remaining line must report `OK`. If
   verification fails, **do not install** the
   archive. (Each release also records its build provenance — Bun version,
   `bun.lock` file hash, git commit, and build date; see
   [`docs/RELEASE.md`](docs/RELEASE.md).)
3. Load the unzipped extension:
   - **Chromium:** open `chrome://extensions`, enable **Developer mode**, click
     **Load unpacked**, and select the unzipped `chrome-mv3` folder.
   - **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load
     Temporary Add-on…**, and select the `manifest.json` inside the unzipped
     Firefox build.

### Build from source

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for a from-clean-machine guide.
The short version:

```sh
bun install --frozen-lockfile
bun run postinstall      # wxt prepare — generates .wxt/ types
bun run build            # → .output/chrome-mv3
bun run build:firefox    # → .output/firefox-mv3
```

## Usage

1. Open a Google Doc you can already access.
2. Activate DocRewind via its in-page affordance (it never auto-loads history).
3. DocRewind retrieves and reconstructs the revision history locally, then opens
   the replay tab.
4. Play, pause, change speed, or scrub the timeline. Clear cached data anytime
   from the options page.

## How it works

DocRewind keeps all Google Docs protocol assumptions behind a single isolated
module (`lib/protocol/*`) and keeps the decoder/reconstruction/timeline core
**pure** (no browser APIs) so it is unit-testable and resilient to Google Docs
changes. The pipeline is: retrieve revision chunks → strip the response guard and
decode the operation grammar → reconstruct a flat character model → derive a
session timeline → replay. See [`docs/docrewind-prd.md`](docs/docrewind-prd.md)
for the full architecture and [`docs/protocol-capture.md`](docs/protocol-capture.md)
for the confirmed protocol facts.

## Contributing

Contributions are welcome. DocRewind is **Bun-only** (`bun install`, `bun run …`),
uses [`prek`](https://prek.j178.dev) git hooks, [Conventional
Commits](https://www.conventionalcommits.org/), and a **DCO `Signed-off-by`**
sign-off (no CLA). See [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## License

DocRewind is licensed under the **GNU Affero General Public License v3.0 or
later** ([`LICENSE`](LICENSE), `SPDX-License-Identifier: AGPL-3.0-or-later`).
Forks distributed to users must carry the same license and offer corresponding
source.

Some of the operation-grammar decoding is ported from the MIT-licensed
[`harvard-vpal/gdocrevisions`](https://github.com/harvard-vpal/gdocrevisions);
those files retain their MIT attribution alongside the AGPL header. See
[`docs/PRIOR-ART.md`](docs/PRIOR-ART.md) for full provenance.
