---
type: "agent_requested"
description: "SolidJS + WXT + Bun browser-extension stack coding guidelines"
---
# SolidJS + WXT + Bun: Modern Cross-Browser Extension Engineering

This stack builds Manifest V3 cross-browser extensions (Chrome + Firefox) with **SolidJS** fine-grained reactivity, **WXT** as the file-based extension framework (Vite under the hood), **Bun** as package manager / script runner / unit-test runtime for tooling, **UnoCSS presetWind4** for styling, **Biome** for lint+format, and **Vitest + Playwright** for tests. It is exceptional at shipping tiny, fast, no-virtual-DOM UIs into popups, options pages, side panels, and content-script shadow roots from one codebase, while WXT erases the manifest/cross-browser boilerplate. Optimize for: components that run **once**, signals read inside JSX, the unified promise-based `browser.*` global, and typed storage/messaging wrappers.

The two biggest ways an agent writes wrong-but-plausible code here both come from importing habits from adjacent ecosystems. **(1) React habits poison SolidJS:** destructuring props, calling `useState`/`useEffect`, putting logic that "re-runs on render," using `.map()` and ternaries for lists/conditionals, and treating `createEffect` as a place to derive state. Solid components are **not** re-rendered — these patterns silently break reactivity. **(2) Node/npm habits poison Bun and the toolchain:** reaching for `npm install`/`npx`, hand-writing `manifest.json`, importing `chrome.*` callback APIs or `webextension-polyfill` manually, and running `bun test` against Solid component tests (which belong to Vitest). Show the modern idiom once and well; assume the latest stable floor is met.

## Stack snapshot & versions

- **Research date:** June 11, 2026
- **Research basis:** current official docs, release notes, specifications, changelogs, and primary repositories.

| Tool | Version | Notes |
|---|---|---|
| TypeScript | 6.0.3 | `strict` is the default since 6.0; `moduleResolution` resolves to `bundler` from `module`. |
| Bun | 1.3.14 | Package manager + script/test runner; `bun.lock` text lockfile stable since 1.2. |
| SolidJS | 1.9.11 | 1.9.x is the stable line; 2.0 is beta-only — do **not** use 2.0 APIs in production. |
| UnoCSS (`unocss`, `@unocss/preset-wind4`) | 66.5.x | presetWind4 is the current Tailwind-4-compatible preset. |
| WXT | 0.20.26 | 0.20 is the v1.0 release candidate; introduced `#imports` and the polyfill-free `browser`. |
| `@wxt-dev/module-solid` | 1.1.4 | Wires `vite-plugin-solid` + Solid auto-imports. |
| `@wxt-dev/unocss` | 1.0.1 | UnoCSS WXT module. |
| `@wxt-dev/storage` | 1.2.8 | Backs `wxt/utils/storage` / `#imports`. |
| Vitest | 4.1.8 | 4.x stable; Browser Mode is stable; 5.0 is beta-only. |
| Playwright | 1.60.0 | Extension E2E in Chromium only. |
| Biome | 2.4.16 | Unified lint + format; 507 lint rules; type-aware rules since v2. |
| `idb` | 8.0.3 | Promise wrapper for IndexedDB (Jake Archibald). |

**Superseded / wrong-ecosystem choices to avoid:** Plasmo (maintenance mode → use **WXT**); CRXJS (narrower build-only tool → WXT covers it); `presetUno`/`presetWind`/`presetWind3` (older → **presetWind4**); ESLint + Prettier (heavier two-tool path → **Biome**); `bun test` for Solid component tests (→ **Vitest**); manual `webextension-polyfill` import and `chrome.*` callbacks (→ WXT's `browser`); `localStorage` in extensions (→ IndexedDB / `storage.local`).

## Project layout

WXT is convention-driven: files under `entrypoints/` become manifest entries automatically. There is **no hand-written `manifest.json`** — WXT generates it per browser/MV from `wxt.config.ts` + entrypoints.

```
my-extension/
├─ entrypoints/
│  ├─ background.ts            # MV3 service worker (defineBackground)
│  ├─ popup/
│  │  ├─ index.html            # action popup host page
│  │  └─ main.tsx              # Solid render() mount
│  ├─ options/
│  │  ├─ index.html
│  │  └─ main.tsx
│  ├─ sidepanel/
│  │  ├─ index.html
│  │  └─ main.tsx
│  └─ content.tsx              # *.content.ts(x) → content script
├─ components/                 # shared Solid components
├─ lib/                        # storage.ts, messaging.ts, db.ts, etc.
├─ public/                     # static assets + icon/*.png (copied verbatim)
├─ assets/                     # bundled assets (imported)
├─ uno.config.ts
├─ wxt.config.ts
├─ biome.json
├─ tsconfig.json
├─ vitest.config.ts
├─ playwright.config.ts
└─ package.json                # name/version/description feed the manifest
```

`.wxt/` holds generated TypeScript types (run via `wxt prepare`, usually a `postinstall`). `.output/chrome-mv3/` and `.output/firefox-mv2|mv3/` hold builds. Both are gitignored.

## Bun: package manager, script runner, test runtime

In a browser-extension project Bun's server APIs (`Bun.serve`, `Bun.sql`, `Bun.file`, `Bun.password`, `Bun.$`) are **irrelevant** — nothing Bun-runtime ships to the browser; Vite (via WXT) bundles everything that runs in the extension. Bun's job here is **install deps, run scripts, and run non-DOM unit tests fast**. Bun runs `.ts`/`.tsx` directly with no compile step, which is why scripts and config files need no build.

Use `bun` commands; never reintroduce npm/pnpm/yarn habits:

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
    "compile": "tsc --noEmit",
    "test": "vitest",
    "test:e2e": "playwright test",
    "check": "biome check --write .",
    "postinstall": "wxt prepare"
  }
}
```

Commands: `bun install` (writes `bun.lock`, the text lockfile stable since Bun 1.2 — commit it), `bun add -D wxt`, `bun run dev`, `bunx wxt@latest init` to scaffold. In CI use `bun install --frozen-lockfile`. `bunfig.toml` is optional; add it only when you need registry/install tweaks:

```toml
# bunfig.toml
[install]
exact = true        # pin exact versions, like Biome recommends for itself
```

**Critical insight:** `bun test` uses Bun's own Jest-style runner executing in the Bun runtime — it does **not** understand `vite-plugin-solid`'s JSX transform, jsdom, or WXT's fake-browser. Solid component and storage tests must run under **Vitest**. Reserve `bun test` (if used at all) for pure, DOM-free logic.

## TypeScript (strict)

TypeScript 6.0 makes `strict` the default and resolves `moduleResolution` to `bundler` from `module`. Still declare everything explicitly so the config is self-documenting. Bun runs TS directly and WXT/Vite transpiles for the browser, so TypeScript here is a **type checker only** (`noEmit`).

```jsonc
// tsconfig.json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "module": "preserve",
    "moduleResolution": "bundler",
    "target": "esnext",
    "lib": ["esnext", "dom", "dom.iterable"],
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "types": ["@types/chrome"],
    "noEmit": true,
    "skipLibCheck": true,
    "paths": { "@/*": ["./*"] }
  }
}
```

`jsxImportSource: "solid-js"` + `jsx: "preserve"` is mandatory — `vite-plugin-solid` does the real JSX compile; never set `jsx: "react-jsx"`. Extend `.wxt/tsconfig.json` so WXT's generated path aliases (`@/`, `@@/`) and entrypoint types resolve.

Use the modern type toolbox:

```ts
// satisfies — validate shape without widening the literal type
const permissions = ["storage", "tabs"] as const satisfies readonly string[];

// const type parameter — preserve literal tuple types through a generic
function defineRoutes<const T extends readonly string[]>(routes: T): T { return routes; }

// discriminated union — exhaustively narrow message shapes
type Msg =
  | { kind: "ping" }
  | { kind: "save"; payload: Note }
  | { kind: "delete"; id: string };

function handle(msg: Msg) {
  switch (msg.kind) {
    case "ping": return "pong";
    case "save": return msg.payload;     // narrowed
    case "delete": return msg.id;        // narrowed
    default: { const _x: never = msg; return _x; }
  }
}

// branded type — prevent mixing opaque IDs
type NoteId = string & { readonly __brand: "NoteId" };
const asNoteId = (s: string) => s as NoteId;

// using / await using — explicit resource management (TS 5.2+)
async function readCursor(db: IDBPDatabase<MyDB>) {
  await using tx = { [Symbol.asyncDispose]: async () => { /* cleanup */ } };
  // tx disposed at scope exit
}
```

`noUncheckedIndexedAccess` means `arr[0]` is `T | undefined` — guard before use. Always use **type-only imports** for types so `verbatimModuleSyntax` keeps emit clean: `import { type Browser } from "wxt/browser"`.

## SolidJS: fine-grained reactivity (the core mental model)

**SolidJS is not React.** A component function runs **exactly once** to set up a reactive graph; there is no re-render, no virtual DOM, no reconciliation. Only the specific DOM expressions that read a signal update when that signal changes. Everything else follows from this.

```tsx
import { createSignal } from "solid-js";

function Counter(props: { start: number }) {
  // This body runs ONCE. console.log fires a single time, ever.
  const [count, setCount] = createSignal(props.start);
  console.log("setup");

  // Only the {count()} text node updates — not the function, not the button.
  return <button onClick={() => setCount((c) => c + 1)}>Count {count()}</button>;
}
```

`class`, not `className` (Solid uses standard DOM attribute names). Signals are accessor functions: read with `count()`, write with `setCount(v)`.

### Never destructure props

Props are a reactive proxy whose values are accessed through getters. Destructuring reads the getter **once at setup time** and permanently freezes the value — reactivity is lost. This is the single most common agent error.

```tsx
// ❌ WRONG — breaks reactivity, `name` never updates
function Hi({ name }: { name: string }) {
  return <h1>{name}</h1>;
}

// ✅ Access reactively
function Hi(props: { name: string }) {
  return <h1>{props.name}</h1>;
}

// ✅ Need defaults / to split? Use the helpers — they preserve getters
import { mergeProps, splitProps } from "solid-js";
function Button(props: { label?: string; variant?: string; onClick: () => void }) {
  const merged = mergeProps({ label: "OK", variant: "primary" }, props);
  const [local, rest] = splitProps(merged, ["label", "variant"]);
  return <button class={local.variant} {...rest}>{local.label}</button>;
}
```

### Derive with createMemo; don't sync with effects

`createMemo` produces cached derived values that update fine-grainedly. Using `createEffect` to write a signal that mirrors other signals is a React-ism — it causes extra passes and stale reads.

```tsx
import { createMemo, createSignal } from "solid-js";

const [items, setItems] = createSignal<Note[]>([]);
const [query, setQuery] = createSignal("");

// ✅ derived state
const filtered = createMemo(() =>
  items().filter((n) => n.title.includes(query()))
);

// ❌ anti-pattern: effect that sets derived state
// createEffect(() => setFiltered(items().filter(...)));
```

### Effects, lifecycle, and timing

`createEffect` runs **after** render for side effects (logging, manual DOM, network); it tracks any signal read inside it. `createRenderEffect` runs during render (before paint); `createComputed` runs eagerly and is rarely needed in app code. Use `onMount` for one-time setup, `onCleanup` for teardown.

```tsx
import { createEffect, onMount, onCleanup, on, untrack, batch } from "solid-js";

createEffect(() => console.log("count is", count()));        // re-runs on count change

// on() — explicit deps, defer skips the initial run
createEffect(on(query, (q) => search(q), { defer: true }));

onMount(() => {
  const id = setInterval(tick, 1000);
  onCleanup(() => clearInterval(id));   // also runs on HMR dispose
});

// untrack — read without subscribing
createEffect(() => { if (enabled()) log(untrack(count)); });

// batch — coalesce multiple writes into one update pass
batch(() => { setA(1); setB(2); });
```

### Stores for nested state

`createStore` gives fine-grained reactivity **per nested property** — update one field and only readers of that field update. Use `produce` for mutable-style updates and `reconcile` to diff incoming data (e.g. from storage/DB) into the store without replacing references.

```tsx
import { createStore, produce, reconcile } from "solid-js/store";

const [state, setState] = createStore({ user: { name: "Ada" }, notes: [] as Note[] });

setState("user", "name", "Grace");                       // path update
setState(produce((s) => { s.notes.push(newNote); }));    // mutable draft
setState("notes", reconcile(await loadNotesFromDb()));   // diff, keep stable refs
```

### Control flow — never .map() or ternaries the React way

Because components don't re-render, raw `.map()` and `? :` recreate DOM and lose reactivity. Use Solid's control-flow components.

```tsx
import { For, Index, Show, Switch, Match, Suspense, ErrorBoundary } from "solid-js";

// <For> — keyed by reference; best when the LIST changes (add/remove/reorder)
<For each={notes()} fallback={<p>No notes</p>}>
  {(note) => <li>{note.title}</li>}
</For>

// <Index> — keyed by index; best when the ITEMS' values change but length is stable
<Index each={scores()}>
  {(score, i) => <li>#{i + 1}: {score()}</li>}  {/* note: score is an accessor */}
</Index>

// <Show> — conditional; `when` also narrows types in the callback form
<Show when={user()} fallback={<Login />}>
  {(u) => <Profile user={u()} />}
</Show>

// <Switch>/<Match> — multi-branch
<Switch fallback={<NotFound />}>
  <Match when={route() === "home"}><Home /></Match>
  <Match when={route() === "settings"}><Settings /></Match>
</Switch>
```

**`<For>` vs `<Index>`:** `<For>` diffs by item reference (row identity is stable; reorders move DOM) — its callback receives a plain item and an index *signal*. `<Index>` diffs by position (DOM is stable; the item is an *accessor* `item()`) — ideal for inputs/fixed-length arrays where values mutate. Choosing wrong causes lost focus or unnecessary DOM churn.

### Async, context, lazy, refs

```tsx
import { createResource, createContext, useContext, lazy, children } from "solid-js";

// createResource + Suspense/ErrorBoundary for async data
const [notes] = createResource(query, fetchNotes);
// <ErrorBoundary fallback={<Err/>}><Suspense fallback={<Spin/>}>...</Suspense></ErrorBoundary>

// Context
const ThemeCtx = createContext<() => string>();
const theme = useContext(ThemeCtx);

// lazy() for code-split components (rarely needed in small extension UIs)
const Heavy = lazy(() => import("@/components/Heavy"));

// children() helper — resolve children once for inspection/manipulation
function List(props: { children: any }) {
  const resolved = children(() => props.children);
  return <ul>{resolved()}</ul>;
}

// refs are plain assignments
let el!: HTMLDivElement;
<div ref={el} />;
```

Signals can live **outside** components (module scope) for shared global state — perfectly idiomatic in Solid, unlike React. **Never** import `useState`/`useEffect`/`useMemo` — those are React; the Solid equivalents are `createSignal`/`createEffect`/`createMemo`. Solid mounts via `render`/`hydrate` from `solid-js/web`, never `react-dom`.

## WXT: the extension framework

WXT (the modern successor to Plasmo) turns `entrypoints/` files into a generated manifest and runs Vite for bundling + HMR. As of 0.20 — which WXT's own upgrade guide describes as "a release candidate for v1.0" — all WXT utilities are imported from the single virtual module **`#imports`**, the `browser` global is **polyfill-free** ("WXT's browser no longer uses the webextension-polyfill!"; types come from `@types/chrome` rather than `@types/webextension-polyfill`, which the guide notes are "more up-to-date with MV3 APIs, contain less bugs"), and `browser.runtime.onMessage` no longer supports returning a promise to reply.

### wxt.config.ts — full wiring

```ts
// wxt.config.ts
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-solid", "@wxt-dev/unocss"],
  // Per-browser manifest; always author properties in MV3 form — WXT down-converts for MV2.
  manifest: ({ browser }) => ({
    name: "My Extension",
    description: "Does a useful thing.",
    permissions: ["storage", "tabs"],
    host_permissions: ["https://*.example.com/*"],
    ...(browser === "firefox"
      ? { browser_specific_settings: { gecko: { id: "my-ext@example.com" } } }
      : {}),
  }),
  // Exclude UnoCSS from the background (no DOM there)
  unocss: { excludeEntrypoints: ["background"] },
  vite: () => ({
    // extra Vite config if needed; the Solid plugin is added by the module
  }),
});
```

`@wxt-dev/module-solid` adds `vite-plugin-solid`, sets `build.target: "esnext"` (required by Solid's Proxy-based reactivity), and registers Solid auto-imports. Add modules in `wxt.config.ts`, not by hand-wiring Vite plugins.

### Entrypoints

```ts
// entrypoints/background.ts — MV3 service worker
export default defineBackground(() => {
  // ⚠️ ALL browser.* usage must be INSIDE main/this callback.
  // Top-level browser.* runs in WXT's Node build context and throws.
  browser.runtime.onInstalled.addListener(() => console.log("installed"));
});
```

```tsx
// entrypoints/popup/main.tsx
import { render } from "solid-js/web";
import "virtual:uno.css";
import App from "@/components/App";

render(() => <App />, document.getElementById("app")!);
```

`defineContentScript`, `defineUnlistedScript` follow the same shape. The background **cannot be async** at the top level and must not place runtime code outside the callback — WXT imports the file in Node during build to generate the manifest.

### The browser global — always promise-based

WXT provides a unified `browser` (auto-imported) that smooths Chrome/Firefox differences. **Never** import `webextension-polyfill` manually, and **never** use `chrome.*` callback style.

```ts
// ✅ promise-based, cross-browser
const tabs = await browser.tabs.query({ active: true, currentWindow: true });

// ❌ callback style — wrong ecosystem habit
// chrome.tabs.query({ active: true }, (tabs) => { ... });

// Feature-detect APIs that don't exist everywhere (types assume all exist):
if (browser.sidePanel) await browser.sidePanel.open({ windowId });
```

One 0.20 gotcha: a message listener can no longer return a promise to reply. Use `sendResponse` + `return true`:

```ts
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  doAsyncWork().then(sendResponse);
  return true; // keep the channel open for the async reply
});
```

For non-trivial messaging, prefer the typed wrapper `@webext-core/messaging` (WXT's recommended choice):

```ts
// lib/messaging.ts
import { defineExtensionMessaging } from "@webext-core/messaging";
interface ProtocolMap {
  getHistory(data: { size: number }): HistoryItem[];
}
export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
```

### Content-script UI with SolidJS

WXT offers three mounts: `createShadowRootUi` (style-isolated, recommended), `createIntegratedUi` (no isolation, inherits page styles), `createIframeUi` (full isolation via iframe). Mount Solid with `render` from `solid-js/web` and return its dispose function.

```tsx
// entrypoints/example.content.tsx
import { render } from "solid-js/web";
import Widget from "@/components/Widget";
import "./style.css";

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui", // required so createShadowRootUi can inject the CSS
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "my-widget",
      position: "inline",
      anchor: "body",
      isolateEvents: ["keydown", "keyup", "wheel"], // stop events leaking to the page
      onMount: (container) => render(() => <Widget />, container),
      onRemove: (dispose) => dispose?.(),
    });
    ui.mount();
  },
});
```

### Dev / build / publish commands

`wxt` (dev with HMR), `wxt -b firefox` (target Firefox), `wxt build`, `wxt build -b firefox`, `wxt zip` (store-ready zip), `wxt submit` (automated store upload). Output lands in `.output/chrome-mv3/` etc. WXT auto-adds the `tabs`/`scripting` permissions in dev for reloading and the `sidepanel` permission when a sidepanel entrypoint exists; everything else you declare yourself.

## WebExtensions / Manifest V3 / cross-browser

The MV3 background is a **non-persistent service worker** (Chrome) — per Chrome's service-worker lifecycle docs it terminates after **30 seconds of inactivity** (a single activity running longer than 5 minutes also terminates it; any event or extension API call resets the idle timer), so persist anything important to storage and never rely on in-memory globals surviving. Firefox implements MV3 with **event-page background scripts** rather than service workers; WXT generates the correct `background` shape per target (and historically defaults Firefox to MV2, Chrome to MV3 — control with `-b`/manifest config). MV3 unified `browserAction`/`pageAction` into a single **`action`** API. Declare permissions and `host_permissions` explicitly; note Firefox treats `host_permissions` as opt-in (the user grants them per-site at runtime). For request blocking/redirection use `declarativeNetRequest` (Chrome MV3) and feature-detect since Firefox MV3 still supports blocking `webRequest`:

```ts
manifest: ({ browser }) => ({
  permissions: browser === "chrome"
    ? ["storage", "declarativeNetRequest"]
    : ["storage", "webRequest", "webRequestBlocking"],
});
```

## Storage: IndexedDB for data, browser.storage.local for settings

Two storage tiers with a hard rule: **`browser.storage.local` is for settings and small flags only; IndexedDB is for bulk/structured/queryable app data.** Never use `localStorage` in an extension (synchronous, unavailable in service workers, wiped unpredictably).

| Need | Use |
|---|---|
| User settings, feature flags, small key/value, versioned config | `storage.defineItem` over `browser.storage.local` |
| Bulk records, structured objects, indexed queries, large data | IndexedDB via `idb` |
| Ephemeral per-session cache | `browser.storage.session` |

### Settings via WXT's typed storage (`#imports`)

```ts
// lib/settings.ts
import { storage } from "#imports";

export const theme = storage.defineItem<"light" | "dark">("local:theme", {
  fallback: "dark",
});
export const installDate = storage.defineItem<number>("local:installDate", {
  init: () => Date.now(),
});

// usage
await theme.setValue("light");
const t = await theme.getValue();          // "light"
const unwatch = theme.watch((v) => applyTheme(v));
```

Keys must be area-prefixed (`local:`, `session:`, `sync:`, `managed:`). `defineItem` supports `version` + `migrations` for evolving shapes. `storage.local` is async and size-limited — keep it small.

### Bulk data via idb

```ts
// lib/db.ts
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

interface Note { id: string; title: string; body: string; updated: number; }
interface MyDB extends DBSchema {
  notes: { key: string; value: Note; indexes: { "by-updated": number } };
}

let dbPromise: Promise<IDBPDatabase<MyDB>> | undefined;
export function getDb() {
  return (dbPromise ??= openDB<MyDB>("my-ext", 1, {
    upgrade(db) {
      const store = db.createObjectStore("notes", { keyPath: "id" });
      store.createIndex("by-updated", "updated");
    },
  }));
}

export async function saveNote(note: Note) {
  const db = await getDb();
  await db.put("notes", note);
}
export async function recentNotes() {
  const db = await getDb();
  return db.getAllFromIndex("notes", "by-updated");
}
```

`idb` is the current small standard wrapper; reach for **Dexie.js** only when you need richer querying/live-query ergonomics. IndexedDB storage limits are far larger than `storage.local` and are governed by the browser's per-origin quota.

## UnoCSS (presetWind4)

UnoCSS is the on-demand atomic CSS engine; **presetWind4** is the current Tailwind-4-compatible preset (successor to `presetUno`/`presetWind`/`presetWind3`). It targets Tailwind 4 utilities and, per the official Wind4 docs, "we use the oklch color model to support better color contrast and color perception. Therefore, it is not compatible with presetLegacyCompat." Its reset is integrated internally (no separate `@unocss/reset`/`normalize.css`), and its output adds three new layers — `base`, `theme`, and `properties` — using `@property` for smaller, faster utilities.

```ts
// uno.config.ts
import { defineConfig, presetWind4 } from "unocss";

export default defineConfig({
  presets: [presetWind4({ reset: true })],
  shortcuts: {
    "btn": "px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700",
    "card": "p-4 rounded-lg shadow bg-white dark:bg-gray-800",
  },
  theme: {
    colors: { brand: "#6d28d9" },
  },
  rules: [
    ["text-balance", { "text-wrap": "balance" }],
  ],
});
```

Install and wire via the WXT module rather than the raw Vite plugin — `@wxt-dev/unocss` adds `unocss/vite` to the right build steps:

```ts
// wxt.config.ts (excerpt)
export default defineConfig({
  modules: ["@wxt-dev/unocss"],
  unocss: { excludeEntrypoints: ["background"] },
});
```

Then import the virtual stylesheet **once per UI entrypoint** — use `import "virtual:uno.css"` (not `import "uno.css"`):

```tsx
// entrypoints/popup/main.tsx
import "virtual:uno.css";
```

A dev-mode warning about `uno.css` not being found is expected and safe to ignore — styles are applied correctly in the build. presetWind4 also supports attributify-style usage and variants; configure via `uno.config.ts`. Unlike raw Tailwind, there is no `tailwind.config.js`/PostCSS pipeline — UnoCSS scans source tokens and generates only used CSS.

## Vitest: unit + component tests

Use **Vitest** (not `bun test`) because it reuses WXT's Vite/`vite-plugin-solid` pipeline, runs in jsdom, integrates `@solidjs/testing-library`, and can mock the extension API. The `WxtVitest` plugin polyfills `browser` with `@webext-core/fake-browser` (in-memory, so `storage.defineItem` "just works" in tests), sets WXT globals, and configures aliases.

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: "jsdom",
    globals: true,
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
```

Component test — note `render` takes a **function** returning JSX (Solid has no re-render; drive updates via signals):

```tsx
// components/Counter.test.tsx
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import Counter from "./Counter";

describe("Counter", () => {
  it("increments", async () => {
    const { getByRole } = render(() => <Counter start={0} />);
    const btn = getByRole("button");
    await fireEvent.click(btn);
    expect(btn).toHaveTextContent("Count 1");
  });
});
```

Storage / browser-API test with the fake browser:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { theme } from "@/lib/settings";

describe("theme setting", () => {
  beforeEach(() => fakeBrowser.reset());      // reset in-memory state between tests
  it("defaults to dark", async () => {
    expect(await theme.getValue()).toBe("dark");
  });
});
```

## Playwright: end-to-end

Playwright drives a real browser against the built extension. **Extension loading is Chromium-only** and requires a **persistent context** created via `chromium.launchPersistentContext` — extensions attach to the browser process at launch, not per-tab. Build first (`wxt build`) and point Playwright at `.output/chrome-mv3`. Use `channel: "chromium"` to allow headless extension loading; otherwise run headed.

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { trace: "on-first-retry" },
});
```

```ts
// e2e/fixtures.ts
import { test as base, chromium, type BrowserContext } from "@playwright/test";
import path from "node:path";

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const pathToExtension = path.join(__dirname, "../.output/chrome-mv3");
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();           // MV3 background = service worker
    if (!sw) sw = await context.waitForEvent("serviceworker");
    await use(sw.url().split("/")[2]);
  },
});
export const expect = test.expect;
```

```ts
// e2e/popup.spec.ts
import { test, expect } from "./fixtures";

test("popup renders and increments", async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const btn = page.getByRole("button");
  await btn.click();
  await expect(btn).toContainText("Count 1");
});
```

The MV3 service worker may suspend after idle; Playwright keeps the same worker handle alive across restarts, so `sw.evaluate(...)` resumes transparently. Content-script UIs render into a shadow root — locate them via the page after navigation.

## Biome: lint + format

Biome is the single Rust binary replacing ESLint + Prettier — no plugins, ~Prettier-compatible formatting, a total of **507 lint rules**, and type-aware rules (e.g. `noFloatingPromises`) since v2, without requiring the TypeScript compiler. There is no maintained `eslint-plugin-solid` equivalent in Biome — rely on Biome's recommended rules **plus Solid's compile-time warnings** (e.g. the reactivity warnings emitted by `vite-plugin-solid`).

```jsonc
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/2.4.16/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "includes": ["**", "!**/.output", "!**/.wxt", "!**/coverage", "!**/dist"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "assist": { "enabled": true, "actions": { "source": { "recommended": true } } },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "error" },
      "complexity": { "noForEach": "off" }
    }
  },
  "javascript": {
    "formatter": { "quoteStyle": "double", "semicolons": "always", "trailingCommas": "all" }
  }
}
```

Commands: `biome check --write .` (format + lint + organize imports in one pass — the one to wire into the `check` script and pre-commit), `biome format --write .`, `biome lint .`, and `biome ci .` in CI (fails on any unformatted/lint issue). Install pinned: `bun add -D --exact @biomejs/biome`.

## Toolchain flow

`bun install` → `wxt prepare` (generates `.wxt/` types) → develop with `bun run dev` (WXT + Vite HMR) → `biome check --write .` → `vitest` (unit/component) → `wxt build` → `playwright test` against `.output/chrome-mv3` → `wxt zip` / `wxt submit`. Bun drives installs and scripts; WXT/Vite builds; Biome enforces style; Vitest covers logic and components; Playwright covers the assembled extension.

## Anti-patterns to avoid

- **Destructuring props** in Solid components — freezes values, kills reactivity. Use `props.x`, `splitProps`, `mergeProps`.
- **`useState`/`useEffect`/`useMemo`/`react-dom`** — React APIs; use `createSignal`/`createEffect`/`createMemo` and `render` from `solid-js/web`.
- **`.map()` / ternaries for lists & conditionals** — use `<For>`/`<Index>`/`<Show>`/`<Switch>`. Picking `<For>` when item values mutate (or `<Index>` when rows reorder) causes lost focus or DOM churn.
- **`createEffect` to derive state** — use `createMemo`.
- **`className`** — Solid uses `class`.
- **`chrome.*` callbacks or manual `webextension-polyfill`** — use WXT's promise-based `browser`. Returning a promise from `onMessage` no longer works in WXT 0.20 — use `sendResponse` + `return true`.
- **`browser.*` at entrypoint top level** — WXT imports the file in Node at build time; keep all API calls inside `main`/the callback.
- **Hand-writing `manifest.json`** — author the manifest in `wxt.config.ts`; declare MV3-shaped properties and let WXT down-convert for Firefox/MV2.
- **`localStorage`** — unavailable in service workers; use `storage.local` (settings) or IndexedDB (data).
- **Dumping bulk data into `browser.storage.local`** — it's for settings; use IndexedDB/`idb` for structured/large data.
- **`bun test` for Solid component tests** — use Vitest with `WxtVitest()`; `bun test` doesn't run the Solid JSX transform or fake-browser.
- **`import "uno.css"`** — import `virtual:uno.css`; and use **presetWind4**, not `presetUno`/`presetWind3`.
- **npm/pnpm/yarn/npx habits** — use `bun install`, `bun run`, `bunx`, and commit `bun.lock`.
- **ESLint + Prettier** — Biome's `check --write` replaces both.
- **Plasmo / CRXJS for new projects** — WXT is the maintained, fuller framework.
- **Headless/non-persistent Playwright context for extension E2E** — extensions need `launchPersistentContext` with `--load-extension`, Chromium only.
