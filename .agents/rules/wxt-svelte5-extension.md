---
type: "agent_requested"
description: "Bun + WXT + Svelte 5 + TypeScript + UnoCSS + Biome coding guidelines"
---
# Cross-Browser MV3 Extensions with WXT, Svelte 5, and Bun

This stack builds one Manifest V3 codebase that ships to both Chromium browsers and Firefox from a single source tree. WXT (a Vite-based, Nuxt-style framework) generates the manifest from files in `entrypoints/`, abstracts the Chromium-service-worker-vs-Firefox-event-page split, and provides typed `browser` APIs, storage, and content-script UI helpers. Svelte 5's runes compile away to fine-grained DOM updates — ideal for popups, options pages, side panels, and shadow-root content-script UIs where bundle size and startup latency matter. Bun is the package manager, script runner, and (for pure logic) test runner; UnoCSS is the atomic CSS engine; Biome is the formatter and linter; svelte-check is the type checker for `.svelte` files.

Optimize for: entrypoint code that runs in the right context (service workers have no DOM, content scripts have an invalidatable lifecycle), reactive state modules in `.svelte.ts`, shadow-root isolation for injected UI, and manifest generation that adapts per browser. The most common wrong-but-plausible mistakes come from importing habits from SvelteKit and from Node/npm: reaching for `$app/*` stores or SSR load functions (there is no SvelteKit here), doing top-level `await`/`browser.*` work at module scope in entrypoints (WXT imports entrypoint modules in Node at build time), assuming a persistent background page (MV3 service workers are killed after idle), assuming Firefox uses a service worker (it uses an event page), and using `on:click`/`export let` Svelte 4 syntax instead of `onclick`/`$props()`.

## Toolchain, versions, and the one compatibility knot

Target the latest mutually compatible stable line of each tool. The one constraint worth stating up front: **Svelte's language tools (svelte-check, svelte2tsx) cannot yet consume TypeScript 7.0's Go-based programmatic API**, so pin TypeScript to the 6.0 line for `.svelte` type checking even though TS 7.0 is stable. You can still run `tsgo` as a fast non-blocking checker for plain `.ts`, but the source of truth for Svelte remains TypeScript 6.0.

`@sveltejs/vite-plugin-svelte` 7.x requires Vite 8; WXT 0.21 requires Vite ≥ 6.3.4, so Vite 8 satisfies both. WXT 0.21 declares `vite` as a required peer dependency (and `web-ext`/`typescript` as optional peers) rather than bundling them — this cut a fresh install from roughly 98 MB/366 packages to 22 MB/156 packages — so you must add `vite` to your own `devDependencies` and control the exact version.

```jsonc
// package.json
{
  "name": "my-extension",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test": "vitest run",
    "postinstall": "wxt prepare"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.12",
    "@sveltejs/vite-plugin-svelte": "7.2.0",
    "@wxt-dev/module-svelte": "2.0.5",
    "@wxt-dev/unocss": "1.0.1",
    "@unocss/preset-wind4": "66.9.2",
    "svelte": "5.57.0",
    "svelte-check": "4.7.6",
    "typescript": "6.0.3",
    "unocss": "66.9.2",
    "vite": "8.0.0",
    "vitest": "3.2.4",
    "@webext-core/fake-browser": "1.5.2",
    "wxt": "0.21.4"
  },
  "dependencies": {
    "@webext-core/messaging": "2.3.0",
    "@wxt-dev/storage": "1.2.9"
  }
}
```

Bun is the package manager and runner: `bun install`, `bun run dev`, `bunx wxt@latest init` to scaffold, and `bunx biome check`. WXT 0.21 raised its Node floor to Node 22 (`>=22`), and Bun 1.4 satisfies the toolchain comfortably. Keep exact version pins here and in the version table only; the prose refers to release lines.

`bunfig.toml` stays minimal — Bun runs scripts and installs; Vite/WXT own the build:

```toml
# bunfig.toml
[install]
exact = true
```

## Project layout and entrypoints

WXT discovers entrypoints by filename/foldername under `entrypoints/` and generates the manifest. Everything else (`components/`, `utils/`, `assets/`) is ordinary source. WXT auto-imports `defineBackground`, `defineContentScript`, `browser`, `storage`, `createShadowRootUi`, and friends via a generated `#imports` module; examples below import Svelte and app code explicitly and rely on auto-imports for the WXT `define*`/`browser` globals, matching WXT's own conventions.

```
entrypoints/
  background.ts            # service worker (Chromium) / event page (Firefox)
  popup/
    index.html             # toolbar popup
    main.ts
    App.svelte
  options/
    index.html
    main.ts
    App.svelte
  sidepanel/
    index.html             # Chromium sidePanel / Firefox sidebar_action
    main.ts
  content.ts               # simple content script, OR:
  overlay.content/
    index.ts               # content script with a shadow-root UI
    Overlay.svelte
components/
utils/
  storage.ts
  messaging.ts
  settings.svelte.ts       # shared reactive state (runes outside .svelte)
wxt.config.ts
uno.config.ts
biome.json
tsconfig.json
```

The critical rule: **do not run `browser.*` calls or side effects at module top level in an entrypoint.** WXT imports these modules in Node during the build to read their options, so browser-only work must live inside `main()` (or the mounted component).

## `wxt.config.ts` — modules, manifest, and per-browser output

Register the Svelte and UnoCSS modules, and generate the manifest as a function so Firefox gets its required `browser_specific_settings.gecko.id` and browser-appropriate permissions. Declare manifest keys in MV3 form; WXT down-converts for MV2 targets automatically.

```ts
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte', '@wxt-dev/unocss'],
  // Narrows import.meta.env.BROWSER to a string-literal union of these names:
  targetBrowsers: ['chrome', 'firefox'],
  unocss: {
    // UnoCSS never needs to run for the background service worker:
    excludeEntrypoints: ['background'],
  },
  manifest: ({ browser }) => ({
    name: 'Tab Concierge',
    description: 'Search, pin, and close tabs from anywhere.',
    permissions: ['storage', 'tabs', 'sidePanel'],
    host_permissions: ['<all_urls>'],
    action: {}, // empty action so the side panel can open on icon click
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'tab-concierge@example.com',
              strict_min_version: '128.0',
            },
          },
        }
      : {}),
  }),
});
```

Notes that change decisions:
- `sidePanel` permission and the Chromium `sidePanel` API only exist in Chromium. WXT adds the `sidePanel` permission automatically when a `sidepanel` entrypoint is present; Firefox maps the same entrypoint onto `sidebar_action`. Do not call `browser.sidePanel.*` on Firefox — gate it on `import.meta.env.CHROME`.
- Firefox requires a stable `gecko.id` to sign on AMO. Per MDN, `browser_specific_settings` is mandatory under Manifest V3 for signing extensions — i.e. distribution through addons.mozilla.org or self-distribution — because it provides the extension ID. Omit it and `wxt zip -b firefox` produces an unsignable artifact.
- Pass only the permissions each browser supports; use the function form to diverge (`declarativeNetRequest` is Chromium-centric, `webRequest` blocking is Firefox-centric).

## Background: service worker on Chromium, event page on Firefox

`defineBackground` abstracts the split: Chromium emits `background.service_worker`, Firefox emits `background.scripts` (a non-persistent event page). Both are **ephemeral**. On Chromium the worker is terminated specifically after 30 seconds of inactivity — receiving an event or calling an extension API resets that timer — and is also killed if a single request takes longer than 5 minutes to process or a `fetch()` response takes more than 30 seconds to arrive. Two consequences drive every background design:

1. **Register all event listeners synchronously at the top of `main()`.** A listener added later (e.g. after an `await`) will miss events that woke the worker.
2. **Never keep authoritative state in module variables.** Persist to `storage` and re-read on wake.

```ts
// entrypoints/background.ts
import { onMessage } from '@/utils/messaging';

export default defineBackground({
  type: 'module',
  main() {
    // Open the side panel when the toolbar icon is clicked (Chromium).
    if (import.meta.env.CHROME) {
      browser.action.onClicked.addListener(async (tab) => {
        if (tab.windowId != null) {
          await browser.sidePanel.open({ windowId: tab.windowId });
        }
      });
    }

    browser.runtime.onInstalled.addListener(({ reason }) => {
      if (reason === 'install') {
        void browser.tabs.create({ url: '/options.html' });
      }
    });

    // Typed request/response handlers (see Messaging).
    onMessage('listTabs', async () => {
      const tabs = await browser.tabs.query({ currentWindow: true });
      return tabs.map((t) => ({
        id: t.id,
        title: t.title ?? '',
        url: t.url ?? '',
        favIconUrl: t.favIconUrl,
      }));
    });

    onMessage('closeTab', async ({ data }) => {
      if (data.tabId != null) await browser.tabs.remove(data.tabId);
    });
  },
});
```

`main()` for a background entrypoint **cannot be async** — WXT forbids it because async registration would miss the synchronous-listener contract. Content-script `main()` may be async.

## Content scripts: lifecycle and shadow-root Svelte UI

A content script's first argument is a `ctx` (`ContentScriptContext`). Browsers keep old content scripts running after an extension update/disable, which then throw "Extension context invalidated." Use `ctx` timers/listeners (`ctx.addEventListener`, `ctx.setInterval`) and check `ctx.isValid` so async work stops when the context dies.

For injected UI, prefer `createShadowRootUi` — it isolates your styles from the host page and the host page's styles from you. Mount a Svelte 5 component with `mount`/`unmount` from `svelte`, and set `cssInjectionMode: 'ui'` so bundled CSS (including UnoCSS) is injected into the shadow root instead of the page `<head>`.

```ts
// entrypoints/overlay.content/index.ts
import { mount, unmount } from 'svelte';
import Overlay from './Overlay.svelte';
import 'uno.css'; // collected into the shadow root because cssInjectionMode: 'ui'

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'tab-concierge-overlay',
      position: 'inline',
      anchor: 'body',
      onMount: (container) => mount(Overlay, { target: container }),
      onRemove: (app) => {
        if (app) void unmount(app);
      },
    });

    ui.mount();

    // Re-mount on SPA navigations; ctx auto-removes the UI when invalidated.
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      ui.mount();
    });
  },
});
```

Two gotchas that bite here:
- **UnoCSS inside a shadow root is not fully reliable via the module.** `import 'uno.css'` in the entrypoint with `cssInjectionMode: 'ui'` is the documented mechanism and works for popups/options, but injecting UnoCSS output into a shadow-root content-script UI has an open, unresolved report against the `@wxt-dev/unocss` module. If overlay styles fail to appear while popup styles work, fall back to `cssInjectionMode: 'manual'`, fetch the built stylesheet via `browser.runtime.getURL('/content-scripts/overlay.css')`, and append a `<style>` into the shadow root in `onMount`, rewriting `:root` to `:host`.
- Component libraries that portal to `document.body` (dialogs, dropdowns) escape the shadow root and lose their styles. Portal them to the shadow root's `body` instead, or keep overlay UI self-contained.

## Svelte 5: runes, props, snippets, and shared reactive state

Use runes exclusively — this is a Svelte 5 codebase with no Svelte 4 legacy mode. `$state` holds values, `$derived` computes, `$effect` runs side effects (network, imperative DOM) after the DOM updates. **Reach for `$derived` before `$effect`;** using an effect to copy one value into another is the single most common runes anti-pattern. Props come from `$props()`, two-way props are opted in with `$bindable`, and DOM events use attribute syntax (`onclick`, not `on:click`).

```svelte
<!-- entrypoints/popup/App.svelte -->
<script lang="ts">
  import { settings } from '@/utils/settings.svelte';
  import { sendMessage } from '@/utils/messaging';
  import TabRow from '@/components/TabRow.svelte';

  type TabInfo = { id?: number; title: string; url: string; favIconUrl?: string };

  let query = $state('');
  let tabs = $state<TabInfo[]>([]);

  // Derived, always-consistent view model — no $effect needed for filtering.
  const visible = $derived(
    query.trim() === ''
      ? tabs
      : tabs.filter((t) => t.title.toLowerCase().includes(query.toLowerCase())),
  );

  // $effect for a genuine side effect: load once on mount.
  $effect(() => {
    let cancelled = false;
    void sendMessage('listTabs', undefined).then((result) => {
      if (!cancelled) tabs = result;
    });
    return () => {
      cancelled = true;
    };
  });

  async function close(id: number) {
    await sendMessage('closeTab', { tabId: id });
    tabs = tabs.filter((t) => t.id !== id);
  }
</script>

<div class="w-80 p-3 font-sans">
  <input
    class="w-full rounded border border-gray-300 px-2 py-1 text-sm"
    placeholder="Filter tabs…"
    bind:value={query}
  />

  {#if visible.length === 0}
    <p class="mt-4 text-center text-sm text-gray-500">No matching tabs.</p>
  {:else}
    <ul class="mt-2 flex flex-col gap-1">
      {#each visible as tab (tab.id)}
        <TabRow {tab} density={settings.compact ? 'compact' : 'cozy'} onClose={close} />
      {/each}
    </ul>
  {/if}
</div>
```

A child component with typed props, a `$bindable` prop, and a snippet:

```svelte
<!-- components/TabRow.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    tab: { id?: number; title: string; url: string; favIconUrl?: string };
    density?: 'compact' | 'cozy';
    onClose: (id: number) => void;
    badge?: Snippet<[string]>;
  }

  let { tab, density = 'cozy', onClose, badge }: Props = $props();
</script>

<li class="flex items-center gap-2 rounded px-2 hover:bg-gray-100"
    class:py-0.5={density === 'compact'}
    class:py-1.5={density === 'cozy'}>
  {#if tab.favIconUrl}
    <img src={tab.favIconUrl} alt="" class="h-4 w-4 shrink-0" />
  {/if}
  <span class="truncate text-sm">{tab.title}</span>
  {#if badge}{@render badge(tab.url)}{/if}
  <button
    class="ml-auto text-gray-400 hover:text-red-600"
    aria-label="Close tab"
    onclick={() => tab.id != null && onClose(tab.id)}
  >×</button>
</li>
```

**Shared reactive state lives in `.svelte.ts` modules**, not Svelte stores. Runes work in any `.svelte.ts`/`.svelte.js` file, so a plain object with `$state` fields is the idiomatic replacement for a writable store. Persist it to extension storage so popup, options, side panel, and content scripts stay in sync:

```ts
// utils/settings.svelte.ts
import { storage } from 'wxt/utils/storage';

interface Settings {
  compact: boolean;
  theme: 'light' | 'dark' | 'system';
}

const item = storage.defineItem<Settings>('sync:settings', {
  fallback: { compact: false, theme: 'system' },
  version: 1,
});

function createSettings() {
  const state = $state<Settings>({ compact: false, theme: 'system' });

  void item.getValue().then((v) => Object.assign(state, v));
  // Cross-context reactivity: storage.watch fires in every extension context.
  item.watch((v) => v && Object.assign(state, v));

  return {
    get compact() {
      return state.compact;
    },
    set compact(v: boolean) {
      state.compact = v;
      void item.setValue({ ...state });
    },
    get theme() {
      return state.theme;
    },
    set theme(v: Settings['theme']) {
      state.theme = v;
      void item.setValue({ ...state });
    },
  };
}

export const settings = createSettings();
```

Mount HTML entrypoints (popup/options/sidepanel) with `mount`, not `new Component()` (removed in Svelte 5):

```ts
// entrypoints/popup/main.ts
import { mount } from 'svelte';
import App from './App.svelte';
import 'uno.css';

mount(App, { target: document.getElementById('app')! });
```

## Data layer: typed storage with versioned migrations

Use `wxt/utils/storage` (re-exported by `@wxt-dev/storage`) rather than raw `browser.storage`. Define each item once with `storage.defineItem`, prefixed by area (`local:`, `session:`, `sync:`, `managed:`), so the key, type, default, and migrations live in one place. The API is available in every context — content scripts included — so read/write storage directly instead of round-tripping through the background just to persist data.

```ts
// utils/storage.ts
import { storage } from 'wxt/utils/storage';

export const pinnedTabs = storage.defineItem<string[]>('local:pinnedTabs', {
  fallback: [],
});

// A value initialized exactly once, then persisted:
export const installId = storage.defineItem<string>('local:installId', {
  init: () => globalThis.crypto.randomUUID(),
});

// Versioned schema evolution — start at version 1, migrate forward:
interface RecentV2 {
  urls: { url: string; at: number }[];
}
export const recent = storage.defineItem<RecentV2>('local:recent', {
  fallback: { urls: [] },
  version: 2,
  migrations: {
    // v1 stored a bare string[]; v2 adds timestamps.
    2: (old: string[]): RecentV2 => ({
      urls: old.map((url) => ({ url, at: 0 })),
    }),
  },
});
```

Choose the area deliberately: `sync:` for small user settings that should roam (subject to tight quotas), `local:` for bulk data, `session:` for in-memory data that must survive a service-worker restart but not a browser restart. Wrap large writes in try/catch to handle `QUOTA_BYTES` errors, and batch related fields into one item rather than many keys.

## Messaging: typed protocols across contexts

Do not hand-roll `browser.runtime.onMessage` with `sendResponse` and `return true` — it is untyped and easy to get wrong. Use `@webext-core/messaging` (WXT's documented default) to define a protocol map once and get typed `sendMessage`/`onMessage` everywhere.

```ts
// utils/messaging.ts
import { defineExtensionMessaging } from '@webext-core/messaging';

interface ProtocolMap {
  listTabs(): { id?: number; title: string; url: string; favIconUrl?: string }[];
  closeTab(data: { tabId: number }): void;
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
```

`sendMessage` from popup/content/side panel to a handler registered in the background is the standard flow. To message a specific tab's content script, use `browser.tabs.sendMessage(tabId, …)` (the webext-core wrapper exposes the tab-targeting overload). For long-lived streams, prefer `browser.runtime.connect` ports over repeated one-shot messages. Handle the "no receiver" case: sending to a tab with no content script rejects, so guard those calls.

## Styling: UnoCSS with the Wind4 preset

Use `presetWind4` (the Tailwind-4-aligned preset) — it integrates its own reset (no separate `@unocss/reset` needed) and emits `@property`-based CSS variables. `presetUno`/`presetWind3` are superseded for new projects. Add `presetIcons` and `presetAttributify` only if you actually use icon classes or attributify syntax.

```ts
// uno.config.ts
import { defineConfig, presetWind4, presetIcons, presetAttributify } from 'unocss';

export default defineConfig({
  presets: [
    presetWind4(),
    presetAttributify(),
    presetIcons({ scale: 1.2, warn: true }),
  ],
  theme: {
    colors: {
      brand: { DEFAULT: '#2563eb', muted: '#93c5fd' },
    },
  },
});
```

The `@wxt-dev/unocss` module wires the UnoCSS Vite plugin into WXT and reads this config; you then `import 'uno.css'` in each UI entrypoint. In dev you may see a harmless "uno.css not found" warning — styles are injected correctly at build time. Exclude the background from UnoCSS (as in `wxt.config.ts` above) since a service worker renders nothing. For shadow-root content-script UIs, see the shadow-root caveat above.

## Tooling config: Biome, svelte-check, and TypeScript

**Division of labor is the key decision here.** Biome 2.5 reliably formats and lints `.ts`, `.js`, `.json`, and `.css`. Its support for `.svelte` files is **experimental**: since v2.3 Biome can format/lint the `<script>` and `<style>` blocks out of the box, v2.4 added parsing of Svelte control-flow syntax such as `{#if}{/if}`, and cross-language lint rules work "a bit better" since v2.5.0 — but the docs still classify the whole feature as experimental and warn it "may flag some false positives." Therefore:

- **Biome** owns formatting + linting of `.ts`/`.js`/`.json`/`.css` and import organization.
- **svelte-check** owns type checking and Svelte-specific diagnostics for `.svelte` and `.svelte.ts` — this is mandatory and is not something Biome does.
- For `.svelte` *formatting*, either enable Biome's experimental Svelte support (via `html.experimentalFullHtmlSupportEnabled` plus an `overrides` entry for `.svelte`), or, if you need stable template formatting today, add `prettier` + `prettier-plugin-svelte` scoped to `.svelte` files only. That plugin's single job is reliable formatting of Svelte template markup (`{#if}`, `{#each}`, `{#snippet}`, attribute wrapping) that Biome's experimental formatter does not yet guarantee. Do not point both formatters at the same files.

```jsonc
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/2.5.12/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": true, "includes": ["**", "!**/.wxt/**", "!**/.output/**"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "assist": { "actions": { "source": { "organizeImports": "on" } } },
  "javascript": { "formatter": { "quoteStyle": "single" } }
}
```

`svelte.config.js` provides the preprocessor for svelte-check and vite-plugin-svelte:

```js
// svelte.config.js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
};
```

TypeScript config extends WXT's generated base (WXT emits `.wxt/tsconfig.json` after `wxt prepare`):

```jsonc
// tsconfig.json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "verbatimModuleSyntax": true,
    "types": ["chrome"]
  }
}
```

Commands: `bunx biome check .` (lint + format + import-organize, add `--write` to fix), `bun run check` (svelte-check), `bun run build` / `bun run zip`. In CI use `biome ci .` for non-mutating, reporter-friendly output. Pin TypeScript to the 6.0 line: svelte-check's stable path uses the TypeScript 6.0 programmatic API; TS 7.0 is only reachable behind svelte-check's experimental `--tsgo` flag and is not the default for `.svelte`.

## Testing

Use **Vitest with WXT's `WxtVitest` plugin** for anything that touches extension APIs, storage, or auto-imports — it polyfills `browser` in-memory via `@webext-core/fake-browser`, loads your Vite config, wires `#imports`, and sets `import.meta.env.BROWSER`/`MANIFEST_VERSION`. `bun test` is fine for pure, browser-free logic, but it does not provide the extension environment, so standardize on Vitest for extension code.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: { environment: 'happy-dom' },
});
```

```ts
// utils/storage.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { pinnedTabs } from './storage';

describe('pinnedTabs', () => {
  beforeEach(() => {
    fakeBrowser.reset(); // critical: reset in-memory state between tests
  });

  it('defaults to an empty array', async () => {
    expect(await pinnedTabs.getValue()).toEqual([]);
  });

  it('persists updates', async () => {
    await pinnedTabs.setValue(['https://example.com']);
    expect(await pinnedTabs.getValue()).toEqual(['https://example.com']);
  });
});
```

`fakeBrowser` implements `browser.storage` in-memory, so `wxt/utils/storage` works without manual mocks — reset it in `beforeEach` or state leaks across tests. For full end-to-end coverage (real popup/content interactions) use Playwright with a built extension; WxtVitest is for unit/integration scope.

## Anti-patterns to avoid

| Wrong | Why it's wrong | Right |
| --- | --- | --- |
| `browser.tabs.query(...)` at module top level in an entrypoint | WXT imports entrypoint modules in Node at build time; browser APIs are undefined and the build breaks | Put all `browser.*` work inside `main()` (or the mounted component) |
| `async main()` in `defineBackground` | Async registration misses events that woke the ephemeral worker | Keep background `main()` sync; register all listeners synchronously at the top |
| Storing state in a module-level variable in the background | MV3 workers/event pages are killed after idle (Chromium: 30s inactivity); the variable is gone on next wake | Persist to `storage` and re-read; use `session:` for restart-surviving memory |
| Assuming a service worker on Firefox / calling `browser.sidePanel` there | Firefox uses a non-persistent event page and `sidebar_action`, not `sidePanel` | Gate Chromium-only APIs on `import.meta.env.CHROME`; let WXT map the sidepanel entrypoint |
| `on:click`, `export let`, `$:`, `new App({ target })` | Svelte 4 syntax; removed/legacy in Svelte 5 runes mode | `onclick`, `$props()`, `$derived`/`$effect`, `mount(App, { target })` |
| `$effect(() => { b = a * 2 })` to sync state | Effects for derivation cause extra passes and stale-value bugs | `const b = $derived(a * 2)` |
| Svelte stores / `$app/*` imports for shared state | No SvelteKit in this stack; `$app/stores` doesn't exist here | `$state` in a `.svelte.ts` module, persisted via `storage.defineItem` |
| Omitting `browser_specific_settings.gecko.id` | Firefox MV3 build cannot be signed on AMO (the key is mandatory for signing) | Add a stable `gecko.id` in the Firefox branch of the manifest function |
| Raw `onMessage`/`sendResponse` + `return true` | Untyped, and the promise-return pattern no longer works with WXT's browser types | `defineExtensionMessaging<ProtocolMap>()` from `@webext-core/messaging` |
| Content-script UI in the page DOM without a shadow root | Host page CSS bleeds into your UI and vice versa | `createShadowRootUi` + `cssInjectionMode: 'ui'` |
| Pinning TypeScript 7.0 for the whole repo | svelte-check can't use TS 7.0's programmatic API yet | Pin TypeScript 6.0 for `.svelte` type checking |
| Pointing both Biome and Prettier at `.svelte` | Two formatters fight over the same files | Biome for `.ts/.js/.json/.css`; one chosen formatter for `.svelte` |

## Version & compatibility

| Component | Release line | Notes / floor |
| --- | --- | --- |
| Bun | 1.4.x | Package manager, runner; `bun test` for pure logic only |
| WXT | 0.21.x | Node 22 floor (`>=22`); declares `vite` (required) / `web-ext` / `typescript` as peers; 0.x minor bumps are breaking |
| Svelte | 5.57.x | Runes mode only; `mount`/`unmount` from `svelte` |
| `@sveltejs/vite-plugin-svelte` | 7.2.x | Requires Vite 8 |
| Vite | 8.x | Satisfies both WXT (≥ 6.3.4) and vite-plugin-svelte 7 |
| TypeScript | 6.0.x | Pinned for Svelte tooling; TS 7.0 not yet usable by svelte-check (no stable programmatic API until 7.1) |
| svelte-check | 4.7.x | Type checker + Svelte diagnostics for `.svelte`/`.svelte.ts` |
| UnoCSS + `@unocss/preset-wind4` | 66.9.x | Wind4 preset; built-in reset |
| `@wxt-dev/unocss` | 1.0.x | Shadow-root injection for content scripts has an open unresolved issue — verify per project |
| `@wxt-dev/module-svelte` | 2.0.x | Adds vite-plugin-svelte + Svelte auto-imports |
| `@wxt-dev/storage` / `wxt/utils/storage` | 1.2.x | `defineItem` with versioned migrations |
| `@webext-core/messaging` | 2.x | Typed messaging protocol |
| Biome | 2.5.x | `.ts/.js/.json/.css` stable; `.svelte` support experimental |
| Vitest + `@webext-core/fake-browser` | 3.x / 1.5.x | Via `WxtVitest` plugin |
| Manifest target | MV3 (Chromium + Firefox) | Chromium service worker vs Firefox event page; per-browser manifest via config function |

- **Research date:** 2026-09-05
