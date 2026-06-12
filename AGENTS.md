# AGENTS.md — DocRewind reviewer guidelines

These guidelines are optional context for the automated PR reviewer. If anything here
is unclear or absent, fall back to best judgment for the project.

## What this project is

DocRewind is a Manifest V3 cross-browser extension (Chrome + Firefox) built with
**WXT** (file-based framework over Vite), **SolidJS** (fine-grained reactivity, no
virtual DOM), **UnoCSS**, and **Bun** tooling. Code is organized as WXT
`entrypoints/` (background service worker, popup, options, content scripts), shared
`components/`, and `lib/` (storage, messaging, decoding/reconstruction core).

## Security (always flag)

- Never log, echo, or surface secrets or tokens. In particular, `NANOGPT_API_KEY`
  and any `GITHUB_TOKEN` must never appear in code, comments, logs, or review output.
- Treat document/revision data fetched from external endpoints as untrusted: validate
  shapes before use and avoid leaking it across extension boundaries.

## Project conventions worth a high-confidence comment

- **SolidJS reactivity**: destructuring `props` freezes values and breaks reactivity
  (use `props.x`, `splitProps`, `mergeProps`); deriving state with `createEffect`
  instead of `createMemo`; using React APIs (`useState`/`useEffect`) or `className`
  instead of `class`. These are genuine bugs in this stack, not style nits.
- **WXT browser API**: top-level `browser.*` calls in an entrypoint run at build time
  and throw — they must live inside the entrypoint callback. Use the promise-based
  `browser` global, not `chrome.*` callbacks or a manual `webextension-polyfill`.
- **Storage boundaries**: `browser.storage.local` is for small settings only; bulk or
  structured data belongs in IndexedDB (`idb`). `localStorage` is unavailable in the
  service worker.
- **Messaging boundaries**: respect the typed messaging protocol; a WXT 0.20
  `onMessage` listener cannot return a promise to reply (use `sendResponse` +
  `return true`).

## Out of scope for review

Formatting, import ordering, and lint/format concerns are handled by Biome — do not
comment on them.
