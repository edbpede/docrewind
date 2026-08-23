---
type: "agent_requested"
description: "Bun + WXT + Svelte 5 + TypeScript + UnoCSS + Biome MV3 cross-browser extension coding guidelines"
---
# Cross-Browser MV3 Extensions with WXT, Svelte 5 & Bun

This stack builds one codebase that ships to both Chrome (Manifest V3 service worker) and Firefox (Manifest V3 event page) from a single WXT project. WXT owns the build: it generates the manifest per-browser, wires Vite/Rollup, auto-imports its own utilities, and produces store-ready zips. Svelte 5 runes provide the reactivity — including reactive state that lives *outside* components in `.svelte.ts` modules, which is the natural home for cross-context extension state. Bun is the package manager and script runner; TypeScript runs in strict, bundler-resolution mode extending WXT's generated config; UnoCSS generates atomic CSS (including inside shadow-DOM content-script UIs); and Biome replaces ESLint+Prettier for the TS/JS layer.

The biggest ways an agent writes wrong-but-plausible code here: (1) importing from `wxt/storage` or `wxt/client` — the current paths are deep, e.g. `wxt/utils/storage` and `wxt/utils/content-script-ui/*`; (2) reaching for the `chrome.*` namespace or manually installing `webextension-polyfill` — WXT ships a typed `browser` global; (3) writing a Svelte `$state` proxy directly to `browser.storage` or `postMessage` (throws `DataCloneError` — you must `$state.snapshot` first); (4) treating the MV3 background as long-lived and keeping state in module globals (it gets killed); (5) using `on:click`/slots/`writable` stores (Svelte 4 idioms) instead of `onclick`/snippets/runes; and (6) reaching for Tailwind + `presetUno`/`presetWind3` instead of UnoCSS `presetWind4`.

## Project structure & entrypoints

WXT is convention-driven. Files in `entrypoints/` become extension entrypoints; `components/`, `composables/`, `hooks/`, and `utils/` are auto-imported everywhere; `public/` is copied verbatim; `assets/` is processed by Vite. Use `srcDir: 'src'` to keep source out of the repo root.

```
src/
  entrypoints/
    background.ts            # service worker (Chrome) / event page (Firefox)
    popup/                   # index.html + App.svelte -> action popup
      index.html
      App.svelte
      main.ts
    options/                 # index.html -> options_ui
    sidepanel/               # index.html -> chrome.sidePanel / sidebar_action
    content.ts               # single-file content script
    overlay.content/         # dir-style content script with a Svelte UI
      index.ts
      App.svelte
    injected.ts              # defineUnlistedScript, injected into MAIN world
  components/                # auto-imported .svelte components
  utils/                     # auto-imported .ts (storage items, messaging, stores)
  public/                    # icons, _locales, static files copied as-is
wxt.config.ts
uno.config.ts
biome.jsonc
tsconfig.json
package.json
bunfig.toml
```

Entrypoint filename → type mapping: `*.content.ts` / `*.content/index.ts` → content script; `background.ts` → background; `popup/`, `options/`, `sidepanel/`, `newtab/`, `devtools/` HTML pages → their manifest slots; `*.ts` returning `defineUnlistedScript` → a script bundled but not auto-registered (for main-world injection).

Run `wxt prepare` after install (wire it as the `postinstall` script). It generates `.wxt/` including `.wxt/tsconfig.json` and type declarations for auto-imports and the `browser` global.

## `wxt.config.ts`

```ts
// wxt.config.ts
import { defineConfig } from 'wxt';
import UnoCSS from 'unocss/vite';

export default defineConfig({
  srcDir: 'src',
  outDir: '.output',
  modules: ['@wxt-dev/module-svelte', '@wxt-dev/auto-icons'],

  // Static manifest fields. Use a function when values depend on the target.
  manifest: ({ browser, manifestVersion }) => ({
    name: 'My Extension',
    description: 'Does something useful.',
    permissions: ['storage', 'activeTab', 'scripting', 'alarms'],
    host_permissions: ['https://*/*'],
    // Firefox requires an add-on id + (as of Nov 3 2025) data-collection disclosure
    browser_specific_settings:
      browser === 'firefox'
        ? {
            gecko: {
              id: 'my-extension@example.com',
              strict_min_version: '140.0',
              // WXT's manifest types may not include this field yet; assert if needed
              data_collection_permissions: { required: ['none'] },
            } as any,
          }
        : undefined,
  }),

  // UnoCSS runs as a Vite plugin. `vite` MUST be a function.
  vite: () => ({
    plugins: [UnoCSS()],
  }),

  // Options for `wxt dev` (web-ext under the hood)
  webExt: {
    chromiumArgs: ['--user-data-dir=./.wxt/chrome-data'], // persist browser state
  },

  zip: {
    // Files to include when building the Firefox sources zip
    includeSources: [],
    artifactTemplate: '{{name}}-{{version}}-{{browser}}.zip',
    sourcesTemplate: '{{name}}-{{version}}-sources.zip',
  },
});
```

Key config keys: `srcDir`, `outDir`, `entrypointsDir`, `publicDir`, `modulesDir`, `modules`, `manifest`, `manifestVersion`, `browser`, `targetBrowsers`, `vite`, `webExt`, `zip`, `imports` (set `imports: false` to disable auto-imports), `alias` (adds paths to `.wxt/tsconfig.json`). The `manifest` function receives `{ browser, manifestVersion, mode, command }`.

**Critical:** the background/`defineBackground` file and `wxt.config.ts` are evaluated in Node during build. Never put runtime code at module top level in a background entrypoint — it must live inside `main()`.

## The `browser` global & cross-browser namespace

Import `browser` from `wxt/browser` (or rely on the auto-import). It's a typed, promise-based, cross-browser API backed by `@wxt-dev/browser` — **not** the callback-style `chrome.*` and **not** a hand-installed `webextension-polyfill`.

```ts
import { browser } from 'wxt/browser';

const tabs = await browser.tabs.query({ active: true, currentWindow: true });
await browser.storage.local.set({ key: 'value' });
const id = browser.runtime.id;
```

Use `browser`, not `chrome`. Both Chrome and Firefox return promises through this API. Never `import 'webextension-polyfill'` — WXT handles the polyfill and it's already typed.

## Background service worker lifetime

In Chrome MV3 the background is a service worker; in Firefox MV3 it's a non-persistent event page. WXT emits the correct shape for each from one definition.

```ts
// entrypoints/background.ts
export default defineBackground({
  type: 'module',       // emit an ES module service worker (Chrome)
  persistent: false,    // event page in Firefox; ignored by Chrome MV3
  main() {
    // Register listeners SYNCHRONOUSLY at the top of main() so they survive
    // service-worker restarts. Do not await before addListener.
    browser.runtime.onInstalled.addListener(({ reason }) => {
      if (reason === 'install') browser.tabs.create({ url: '/options.html' });
    });

    browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      handle(msg).then(sendResponse);
      return true; // keep the channel open for the async response
    });
  },
});
```

**Critical insight — the worker dies.** Per Chrome's "extension service worker lifecycle" docs, Chrome terminates a service worker after **30 seconds of inactivity**, when a single event/API call **takes longer than 5 minutes** to process, or when a `fetch()` response takes more than 30 seconds to arrive. Never keep application state in module-level variables expecting it to persist. Persist to `chrome.storage.session` (in-memory, cleared on browser close, not exposed to content scripts by default) or `storage.local`, and re-read on wake. Use `browser.alarms` instead of `setTimeout` for anything beyond the worker's lifetime — alarms can be set to a minimum period of 30s (`0.5`) to match the service-worker lifecycle. `main()` itself **cannot be async**, but you can call async functions from within it.

Chrome-only lifetime helpers: **offscreen documents** (`chrome.offscreen`) for DOM/audio/clipboard work a worker can't do; `chrome.sidePanel` for the side panel. Firefox uses `sidebar_action` instead — WXT maps a `sidepanel` entrypoint appropriately, but side-panel *APIs* differ, so branch on `import.meta.env.FIREFOX` when calling them.

## Storage: typed, versioned, watchable

Use `storage.defineItem` from `wxt/utils/storage`. Every key is prefixed with its area: `local:`, `session:`, `sync:`, or `managed:`. Define items once in `utils/` and import them.

```ts
// utils/storage.ts
import { storage } from 'wxt/utils/storage';

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  autoLock: boolean;
}

export const settings = storage.defineItem<Settings>('local:settings', {
  fallback: { theme: 'system', autoLock: false },
  version: 2,
  migrations: {
    // Run when a stored value's version is below the target. v1 -> v2:
    2: (old: { theme: Settings['theme'] }): Settings => ({
      ...old,
      autoLock: false, // new field added in v2
    }),
  },
});
```

Usage anywhere: `await settings.getValue()`, `await settings.setValue(next)`, `await settings.removeValue()`, and `const unwatch = settings.watch((next, prev) => { ... })`. Migrations run automatically on extension update; if no prior version metadata exists WXT assumes version 1, so a brand-new item starts at `version: 1`. Metadata is stored in a sibling `key$` entry.

Decision table — storage areas:

| Area | Scope | Use for |
| --- | --- | --- |
| `local:` | Per-device, persists | Default; settings, caches, large data |
| `session:` | In-memory, cleared on browser close | Ephemeral background state that must survive worker restart |
| `sync:` | Synced across a user's devices, small quota | Small user preferences you want roaming |
| `managed:` | Read-only, set by admin policy | Enterprise-provisioned config |

## The key pattern: a `.svelte.ts` store backed by `storage.watch`

This is *the* central pattern for this stack. A rune module holds reactive state, hydrates from `wxt/utils/storage`, writes back on change (snapshotting the proxy first), and stays in sync across every context (popup, options, content script, background) via `storage.watch`.

```ts
// utils/settings.svelte.ts
import { settings, type Settings } from './storage';

class SettingsStore {
  current = $state<Settings>({ theme: 'system', autoLock: false });

  constructor() {
    // Hydrate, then keep in sync with every other context.
    settings.getValue().then((v) => {
      this.current = v;
    });
    settings.watch((next) => {
      this.current = next; // cross-context updates land here
    });
  }

  async patch(partial: Partial<Settings>) {
    this.current = { ...this.current, ...partial };
    // CRITICAL: strip the Svelte proxy before it crosses the extension boundary.
    await settings.setValue($state.snapshot(this.current));
  }
}

export const settingsStore = new SettingsStore();
```

```svelte
<!-- components/ThemeToggle.svelte -->
<script lang="ts">
  import { settingsStore } from '@/utils/settings.svelte.ts';
</script>

<select
  value={settingsStore.current.theme}
  onchange={(e) => settingsStore.patch({ theme: e.currentTarget.value as any })}
>
  <option value="system">System</option>
  <option value="light">Light</option>
  <option value="dark">Dark</option>
</select>
```

**Critical insight — `$state.snapshot` before crossing any boundary.** Svelte 5's `$state` deeply proxies objects and arrays. A `Proxy` cannot be structured-cloned, so passing it to `browser.storage.*`, `postMessage`, `sendMessage`, or IndexedDB throws `DataCloneError: ... could not be cloned`. Always call `$state.snapshot(value)` first. Note that `$state.snapshot` clones via `structuredClone`, so class instances lose their prototype — snapshot plain data, not class objects.

## Reactivity: Svelte 5 runes

Use runes, not Svelte 4 idioms. `$state` for reactive state, `$derived` for computed values, `$effect` for side effects, `$props` for component inputs, `$bindable` for two-way props.

```svelte
<script lang="ts">
  interface Props {
    label: string;
    count?: number;
    onchange?: (n: number) => void;
  }
  let { label, count = 0, onchange }: Props = $props();

  let internal = $state(count);
  let doubled = $derived(internal * 2);
  let parity = $derived.by(() => (internal % 2 === 0 ? 'even' : 'odd'));

  $effect(() => {
    onchange?.(internal); // runs after DOM update, re-runs when internal changes
    return () => {/* cleanup on teardown / before re-run */};
  });
</script>

<button onclick={() => internal++}>{label}: {internal} (×2 = {doubled}, {parity})</button>
```

Rules that trip up agents:
- **Events are attributes:** `onclick`, not `on:click`. Directives like `use:` still exist, but `{@attach}` (available in Svelte 5.29 and newer) is the modern replacement for most actions — unlike actions, attachments are fully reactive: `{@attach foo(bar)}` re-runs on changes to `foo` or `bar`.
- **Snippets replace slots:** use `{#snippet}` / `{@render}` instead of `<slot>`.
- **`$derived` is reassignable (Svelte 5.25):** you can temporarily override a derived value (e.g. optimistic UI) and it recomputes on next dependency change.
- **Shared reactive state lives in `.svelte.ts`/`.svelte.js` modules** — this is what replaces stores. `svelte/store` (`writable`/`readable`) is legacy; only reach for `fromStore`/`toStore` when interoperating with a store-based library.
- **Reactive built-ins:** import `SvelteMap`, `SvelteSet`, `SvelteDate`, `SvelteURL` from `svelte/reactivity` when you need a reactive collection.
- **Mounting:** use `mount`/`unmount` from `svelte` (not `new Component()`), which matters for content-script UIs below.
- **`untrack`** to read reactive state inside an effect without subscribing; `getContext`/`setContext` for component-tree context.
- Async `await`-in-components / async SSR is experimental — do not use in production.

Type components with `Component`, `ComponentProps`, and `Snippet` from `svelte`.

## Content scripts: context, UI, and SPA navigation

`defineContentScript` gives you a `ctx` (`ContentScriptContext`) that tracks invalidation. Always use `ctx`-scoped timers and listeners so async work stops when the extension is updated/disabled (otherwise you get `Error: Extension context invalidated.`).

```ts
// entrypoints/overlay.content/index.ts
import './style.css';
import App from './App.svelte';
import { mount, unmount } from 'svelte';

export default defineContentScript({
  matches: ['*://*.example.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui', // required so createShadowRootUi gets the CSS
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'my-overlay',
      position: 'inline',
      anchor: 'body',
      onMount: (container) => mount(App, { target: container }),
      onRemove: (app) => app && unmount(app),
    });
    ui.mount();

    // ctx helpers auto-stop on invalidation:
    ctx.setInterval(() => {/* poll */}, 5000);
    ctx.addEventListener(window, 'scroll', () => {/* ... */});
    ctx.onInvalidated(() => {/* final cleanup */});
    if (ctx.isValid) {/* guard before touching extension APIs */}
  },
});
```

Content-script UI decision table:

| Helper | Style isolation | Events isolated | HMR | Page context |
| --- | --- | --- | --- | --- |
| `createIntegratedUi` | ❌ | ❌ | ❌ | ✅ |
| `createShadowRootUi` | ✅ | optional (`isolateEvents`) | ❌ | ✅ |
| `createIframeUi` | ✅ | ✅ | ✅ | ❌ |

All three import from `wxt/utils/content-script-ui/*` (auto-imported). Prefer `createShadowRootUi` for injected Svelte UIs — it isolates your CSS from the host page. Use `createIframeUi` when you want full isolation and HMR and don't need the page's DOM context.

**SPA navigation:** content scripts run only on full loads. For history-API sites (YouTube, etc.) listen for WXT's synthetic event:

```ts
const watch = new MatchPattern('*://*.youtube.com/watch*');
export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  main(ctx) {
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => {
      if (watch.includes(newUrl)) mountUi(ctx);
    });
  },
});
```

**Main world:** `world: 'MAIN'` is Chromium-only and has no extension-API access. For cross-browser main-world code, WXT recommends `injectScript` with a `defineUnlistedScript` entrypoint (added to `web_accessible_resources`) and a parent content script that bridges via events.

## UnoCSS

Use `presetWind4` — the current Tailwind-v4-compatible preset. Do **not** use `presetUno` or `presetWind3` (superseded), and do not reach for Tailwind itself; UnoCSS is the atomic engine here.

```ts
// uno.config.ts
import {
  defineConfig,
  presetWind4,
  presetIcons,
  presetTypography,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss';

export default defineConfig({
  presets: [
    presetWind4(),
    presetIcons({ scale: 1.2, warn: true }),
    presetTypography(),
  ],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  shortcuts: {
    btn: 'px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50',
  },
  content: {
    pipeline: { include: [/\.(svelte|ts|html)($|\?)/] },
  },
  safelist: ['i-mdi-cog'],
});
```

Wire it into WXT via the Vite plugin (`vite: () => ({ plugins: [UnoCSS()] })`) as shown earlier, or use the `@wxt-dev/unocss` module. Import the virtual stylesheet once per entrypoint (`import 'virtual:uno.css'` — or `import 'uno.css'`).

**Critical — UnoCSS inside a shadow-DOM content-script UI.** Set `cssInjectionMode: 'ui'` and import the UnoCSS virtual stylesheet at the top of the content script; WXT then injects the generated CSS into the shadow root instead of the page. Two known gotchas:
- **`rem` units are not fully isolated.** WXT resets inherited styles with `all: initial` but cannot reset the host page's `<html>` font-size, which scales `rem`. `presetWind4` emits `rem`-based spacing, so your UI can change size per site. Fix by converting to `px` via `presetWind4`'s `createRemToPxProcessor` (from `@unocss/preset-wind4/utils`) or setting an explicit font-size on your shadow host.
- **`presetWind4` emits theme values as CSS variables / `@property` on `:root`.** Inside a shadow root `:root` doesn't cascade the same way; if colors go missing, use the preset's `preflights.theme` options (and `safelist` for theme vars) so the variables are emitted where the shadow root can see them.

Use `@unocss/reset` (e.g. `import '@unocss/reset/tailwind.css'`) for a baseline reset in full pages (popup/options), but be cautious applying page-level resets inside injected UIs.

## TypeScript

Extend WXT's generated config and run strict. WXT resolves modules in bundler mode.

```jsonc
// tsconfig.json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "erasableSyntaxOnly": true,  // TS 5.8: forbids enums/namespaces/param-props
    "moduleResolution": "bundler",
    "types": ["svelte"]
  }
}
```

Use `import type` for type-only imports (`verbatimModuleSyntax` enforces this). `erasableSyntaxOnly` (TS 5.8) blocks TypeScript constructs that emit runtime code (enums, namespaces, constructor parameter properties) — prefer `const` objects and plain assignments. Type-check `.svelte` files with `svelte-check` (Biome and `tsc` do not type-check Svelte markup).

Type the messaging protocol and storage items explicitly. For `@webext-core/messaging`, the `ProtocolMap` interface *is* the source of truth — no `declare module` needed. `WxtStorageItem<TValue, TMetadata>` is the type returned by `defineItem` if you need to annotate.

## Typed messaging

WXT does not ship a messaging abstraction; the recommended package (same author as WXT) is `@webext-core/messaging`. Define one `ProtocolMap` and both sender and handler get full inference.

```ts
// utils/messaging.ts
import { defineExtensionMessaging } from '@webext-core/messaging';

interface ProtocolMap {
  getHistory(data: { size: number }): Promise<HistoryItem[]>;
  toggleSidebar(): void;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
```

```ts
// background.ts — register handlers
import { onMessage } from '@/utils/messaging';
onMessage('getHistory', ({ data }) => queryHistory(data.size));
```

```ts
// popup or content script — call them
import { sendMessage } from '@/utils/messaging';
const items = await sendMessage('getHistory', { size: 20 });
```

For content scripts, message the background with `browser.tabs.sendMessage`/`sendMessage`; for long-lived streams use `browser.runtime.connect` ports. When you want to "call a background function from anywhere," use `@webext-core/proxy-service` instead of hand-rolling request/response messages. For content-script ↔ page (main world) use `@webext-core/messaging/page` (`defineWindowMessaging`/`defineCustomEventMessaging`) with a `namespace`.

## Permissions

Declare required permissions in the manifest; request sensitive/host permissions at runtime from a user gesture. `permissions.request()` must be called inside a click/keypress handler.

```svelte
<!-- options/RequestHosts.svelte -->
<script lang="ts">
  import { browser } from 'wxt/browser';
  let granted = $state(false);
  async function grant() {
    granted = await browser.permissions.request({ origins: ['https://*.example.com/*'] });
  }
</script>
<button class="btn" onclick={grant}>Grant access</button>
{#if granted}<p>Granted ✔</p>{/if}
```

Firefox treats `host_permissions` as optional-by-default (the user grants them post-install), so never assume host access is present — check `browser.permissions.contains(...)` and request when missing.

## Manifest V3 cross-browser differences

| Concern | Chrome MV3 | Firefox MV3 |
| --- | --- | --- |
| Background | `service_worker`, `type: "module"` | `scripts` + `persistent: false` (event page) |
| Add-on id | not required | `browser_specific_settings.gecko.id` **required** |
| Data disclosure | n/a | `gecko.data_collection_permissions` (new extensions since Nov 3 2025) |
| Side UI | `chrome.sidePanel` | `sidebar_action` |
| Offscreen docs | `chrome.offscreen` | not available |
| Host perms | granted at install | optional, user-granted |
| `world: 'MAIN'` | supported | not supported (use `injectScript`) |

WXT generates the correct `background` shape per browser from `defineBackground`. Build per browser with `wxt build -b firefox` / `wxt -b firefox` (or `-b edge`, `-b safari`). Branch runtime code on `import.meta.env.FIREFOX` / `import.meta.env.CHROME` / `import.meta.env.BROWSER` / `import.meta.env.MANIFEST_VERSION`.

**Remote code is banned** in MV3 on both stores — everything must be bundled. WXT bundles by default; do not inject remote scripts or `eval`. Set a tight `content_security_policy.extension_pages` (e.g. `script-src 'self'; object-src 'self';`). `web_accessible_resources` uses the v3 object shape (`{ resources, matches, use_dynamic_url }`).

Firefox's built-in data-collection consent works on Firefox desktop 140 and later / Firefox for Android 142 and later. As of **November 3, 2025**, all new Firefox extensions must declare data-collection practices via `browser_specific_settings.gecko.data_collection_permissions`; extensions that collect no personal data must set `data_collection_permissions: { required: ['none'] }`. Set `strict_min_version` to `140.0` (and `gecko_android.strict_min_version` to `142.0`) when relying on the built-in consent experience.

## Bun

Bun is the package manager and script runner. Since Bun v1.2 the default lockfile is the text-based `bun.lock` — commit it. (To migrate an existing binary `bun.lockb`, run `bun install --save-text-lockfile --frozen-lockfile --lockfile-only` and delete `bun.lockb`.)

```toml
# bunfig.toml
[install]
# text lockfile (bun.lock) is the default since Bun 1.2
exact = false
```

```jsonc
// package.json (scripts)
{
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "lint": "biome check --write",
    "test": "vitest",
    "postinstall": "wxt prepare"
  }
}
```

Commands: `bun install`, `bun add -d <pkg>`, `bun run <script>`, `bunx <bin>`, `bun outdated`, `bun update --latest`, `bun pm ls`. Use `bun --filter '<pkg>' <script>` for workspaces.

**Critical — run WXT/Vite through Node, not Bun's runtime.** Use `bun run dev` (which executes the script's `wxt` binary via Node), **not** `bun --bun run dev`. Forcing Bun's runtime on Vite (`bunx --bun vite` / `--bun` flag) has known crashes with the Vite/esbuild toolchain WXT depends on. Bun-as-package-manager + Node-as-runtime is the reliable combination. Note `bun install` run *concurrently* while a Vite/Vitest dev server is live can corrupt `node_modules` and produce `esbuild: The service was stopped` — don't reinstall while the dev server runs.

**Testing runner:** WXT's testing integration is **Vitest-based** (`WxtVitest` plugin + `fakeBrowser`). Use Vitest for extension unit tests, not `bun test` — `bun:test` cannot load the WXT Vite plugin that polyfills `browser` and configures auto-imports. `bun test` is fine only for plain, framework-free utility modules with no extension APIs.

## Biome

Biome v2 replaces ESLint + Prettier for the TS/JS layer. Config uses `files.includes` (v2 replaced `include`/`ignore`), and organize-imports moved to `assist.actions.source.organizeImports`.

```jsonc
// biome.jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.5.0/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["src/**", "*.ts", "*.jsonc"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single" } },
  "assist": {
    "enabled": true,
    "actions": { "source": { "organizeImports": "on" } }
  }
}
```

Commands: `biome check --write` (lint + format + organize imports with fixes), `biome ci` (verify in CI, no writes), `biome migrate` (upgrade config). Biome v2 adds GritQL plugins, `domains` (group rules by framework), nested/monorepo config, and type-aware lint rules (e.g. `noFloatingPromises`) without needing `tsc`.

**Critical — Biome's Svelte support is experimental.** Since v2.3 Biome can format/lint the `<script>`/`<style>` blocks of `.svelte` files, and v2.4 added much better support for Svelte control-flow markup (`{#if}`/`{/if}`), gated behind `"html": { "experimentalFullSupportEnabled": true }`. For production reliability, keep Biome for `.ts`/`.js` and pair it with `svelte-check` for Svelte type/markup checking; use `prettier-plugin-svelte` if you want opinionated `.svelte` markup formatting. Do not rely on Biome as the sole formatter for `.svelte` markup yet.

## Testing

Unit tests use Vitest with the `WxtVitest` plugin, which polyfills `browser` with `@webext-core/fake-browser` (in-memory storage, tabs, etc.), loads your `wxt.config.ts`, sets up auto-imports and `import.meta.env.*`, and configures aliases.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

export default defineConfig({
  plugins: [WxtVitest()],
  test: { globals: true },
});
```

```ts
// utils/auth.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { storage } from 'wxt/utils/storage';

const account = storage.defineItem<{ username: string }>('local:account');

describe('account', () => {
  beforeEach(() => fakeBrowser.reset()); // CRITICAL: reset between tests
  it('round-trips through fake storage', async () => {
    await account.setValue({ username: 'alice' });
    expect(await account.getValue()).toEqual({ username: 'alice' });
  });
});
```

`fakeBrowser.reset()` in `beforeEach` is mandatory — state leaks between tests otherwise. You do not need to mock `browser.storage`; `@webext-core/fake-browser` implements it in-memory. For Svelte components use `@testing-library/svelte` (or `vitest-browser-svelte` for real-browser component tests).

**E2E** uses Playwright with a persistent context pointed at the built extension. WXT's E2E guide defers to Playwright's official Chrome-extension docs; point `--load-extension` at the WXT output dir `.output/chrome-mv3`, and read the MV3 extension id from the service worker.

```ts
// e2e/fixtures.ts
import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const ext = path.join(__dirname, '../.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // required to load extensions (incl. headless)
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    // MV3: read the id from the service worker (MV2 used backgroundPages())
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw.url().split('/')[2]); // chrome-extension://<id>/...
  },
});
export const expect = test.expect;
```

A persistent context is mandatory — `browser.newContext()` cannot load extensions.

## Publishing

Build store zips with WXT:

```sh
bun run zip           # Chrome (and Edge) zip
bun run zip:firefox   # Firefox extension zip + a sources zip
```

`wxt zip -b firefox` produces both the extension zip and a **sources zip** because AMO requires reviewable, rebuildable sources when a bundler is used. WXT auto-excludes config/hidden/test files; verify the sources zip manually and include a `README.md`/`SOURCE_CODE_REVIEW.md` documenting the build commands (`bun install` then `bun run zip:firefox`). Ensure the build output is byte-identical when rebuilt from the sources zip — note that `.env` files can change chunk hashes, so delete them before zipping or add them via `zip.includeSources`. `wxt submit` uploads to the Chrome Web Store, AMO, and Edge Add-ons via their official APIs (pass `--firefox-sources-zip`).

## i18n, icons & app config

Use `@wxt-dev/i18n` (typed messages generated from a messages file) for localization and `@wxt-dev/auto-icons` to generate all icon sizes from one source image (add both to `modules`). `@wxt-dev/analytics` is available if you need extension-safe analytics. Use `defineAppConfig` + `useAppConfig` (from `wxt/utils/define-app-config`) for typed build-time runtime config.

## Anti-patterns to avoid

- **Old import paths.** Use `wxt/utils/storage`, `wxt/utils/content-script-ui/*`, `wxt/browser`, `wxt/testing` — not `wxt/storage` or `wxt/client`.
- **Writing a `$state` proxy across a boundary.** `browser.storage.*`, `sendMessage`, `postMessage` all need `$state.snapshot(value)` first, or you get `DataCloneError`.
- **State in background module globals.** The MV3 worker is killed after 30s idle (or a 5-minute per-event cap); persist to `storage.session`/`storage.local` and re-hydrate.
- **`chrome.*` / manual `webextension-polyfill`.** Use the typed `browser` global.
- **Async top-level code in the background entrypoint.** It's imported in Node at build time; keep runtime code inside `main()`, and register listeners synchronously.
- **Svelte 4 idioms.** No `on:click`, `<slot>`, `export let`, or `writable` stores — use `onclick`, snippets, `$props()`, and `.svelte.ts` rune modules.
- **`presetUno`/`presetWind3` or Tailwind.** Use `presetWind4`.
- **`bun --bun run dev` / `bunx --bun vite`.** Run WXT through Node; use Bun only as the package manager/script runner.
- **`bun test` for extension code.** Use Vitest + `WxtVitest` + `fakeBrowser`.
- **Forgetting `fakeBrowser.reset()`** between tests.
- **Assuming host permissions in Firefox.** They're user-granted; request at runtime from a gesture.
- **Sole reliance on Biome for `.svelte` files.** Pair with `svelte-check`.

## Version & compatibility

- **WXT:** 0.21.x — deep import paths (`wxt/utils/*`), `@wxt-dev/module-svelte`, `wxt zip -b firefox` sources zip.
- **Svelte:** 5.x — `$derived` reassignable (5.25), `{@attach}` (5.29); async components experimental (do not use in prod).
- **Bun:** 1.2+ — text `bun.lock` is the default lockfile; use as package manager, not Vite runtime.
- **TypeScript:** 5.8+ — `erasableSyntaxOnly`; `verbatimModuleSyntax`, `moduleResolution: "bundler"`.
- **UnoCSS:** current `presetWind4` (Tailwind v4-compatible; `presetUno`/`presetWind3` superseded).
- **Biome:** 2.x — `files.includes`, `assist.actions.source.organizeImports`; Svelte support experimental (v2.3+, improved v2.4).
- **Firefox MV3:** `gecko.id` required; `data_collection_permissions` required for new AMO extensions since Nov 3 2025; built-in consent on FF desktop 140+ / Android 142+.

- **Research date:** August 22, 2026
- **Research basis:** current official docs, release notes, specifications, changelogs, and primary repositories.
