---
type: 'agent_requested'
description: 'Bun + SolidJS + UnoCSS Coding Guidelines'
---

# Bun + SolidJS + TypeScript + UnoCSS + Browser Extension Agent Coding Playbook

## Agent Operating Contract

This playbook is implementation guidance for AI coding agents working in a Bun, SolidJS, TypeScript, UnoCSS codebase, including WebExtensions-style browser extension projects.

When creating code:

- Use the defaults and decision matrix before inventing structure.
- Prefer stack-native APIs and repository conventions.
- Add the smallest complete implementation that fits the task.

When modifying code:

- Preserve runtime behaviour unless asked to change it.
- Follow nearby established project conventions unless they conflict with a Reject item.
- Improve only nearby touched code toward this playbook.
- Do not perform broad unrelated rewrites.

When refactoring:

- Identify the stale or rejected pattern first.
- Choose the smallest safe migration path.
- Keep changes reviewable.
- Surface broad migrations instead of silently doing them.

When reviewing:

- Check Solid reactivity, type safety, security, data flow, UnoCSS extraction, verification commands, extension boundaries, permissions, and messaging.
- Reject adjacent-ecosystem drift.

When uncertain:

- Prefer conservative stable defaults.
- Do not invent APIs, commands, build tools, config, routers, validation libraries, component libraries, extension helper frameworks, test runners, formatters, or migration steps.
- Use the repository’s existing choice whenever this playbook marks something project-local.

## Stack Snapshot & Defaults

- **Research date:** 2026-05-13
- **Research basis:** Current official docs, release notes, migration guides, specifications, changelogs, and primary repositories.

This stack is a **Bun-first**, **SolidJS TSX**, **UnoCSS presetWind4**, optionally **WebExtensions-style browser extension** stack.

Stable defaults that materially affect code today:

- **Bun:** Use Bun as the package manager, script runner, and default CLI surface in Bun repositories. Keep `bun.lock` authoritative. Bun transpiles TypeScript and TSX, includes a test runner, and provides Bun-specific TypeScript defaults, but it does **not** type-check and its defaults are not automatically correct for Solid or browser-only extension code. citeturn23view1turn23view2turn23view3turn22view0
- **SolidJS:** Current stable work is in the **1.x / 1.9.x** line. Use stable Solid 1.x APIs and conventions. Components run once, then Solid updates only the reactive reads that changed. Write Solid, not React-with-different-imports. Do not import Solid 2 beta ideas into production code unless the repository has explicitly adopted them. citeturn5search1turn3search13turn0search13turn0search19
- **TypeScript:** Repository pin wins. Modern TypeScript defaults changed materially, and recent TypeScript/Bun init defaults still need Solid-specific JSX overrides. A Solid project must explicitly set `jsx: "preserve"` and `jsxImportSource: "solid-js"`. citeturn20view0turn21view0turn22view0
- **UnoCSS:** Current stable work is in the **66.x** line. Use an explicit `uno.config.ts`, explicit presets, and extraction-aware class patterns. `presetWind4` is the Tailwind 4-compatible preset; its config keys differ from Wind3 and Tailwind-oriented examples. citeturn19search1turn19search5turn15view3turn15view1
- **Browser extension target:** For extension projects, default new work to **Manifest V3**. Chrome 139+ no longer runs Manifest V2. For **Chromium + Firefox**, MV3 background handling is not identical: Chromium uses `background.service_worker`; Firefox still uses `background.scripts` / `background.page` as its MV3 background context. Cross-browser code must account for that difference. citeturn33view0turn25view1turn25view0
- **Package manager default:** Use Bun commands in a Bun repository. Do not add or update npm, pnpm, or Yarn lockfiles.
- **Workspace boundary:** In new Bun workspaces/monorepos, isolated installs are the default. Do not rely on phantom dependencies.
- **Project-local override policy:** Keep the repository’s existing router, bundler, test runner, deployment target, browser environment exposure mechanism, extension framework, linter, formatter, and component library unless asked to change them or they conflict with a Reject item.
- **Bun config policy:** Use `bunfig.toml` only for Bun-specific behaviour. Keep general project config in `package.json`, `tsconfig.json`, and the existing tool config files.

## Decision Matrix

| Scenario | Use / Default | Conditional | Avoid / Reject |
|---|---|---|---|
| Install dependencies | `bun install`, `bun add`, `bun add -d` | `bun install --frozen-lockfile` for CI/repro checks | `npm`, `pnpm`, `yarn`, or manual lockfile edits in a Bun repo |
| Run repository scripts | `bun run <script>` | Put Bun flags before `run`, e.g. `bun --watch run dev` | `bun run dev --watch` when you meant a Bun flag |
| Run one-off local tools | `bunx <tool>` | Keep the repo’s pinned tool version | `npx` by habit |
| TypeScript init | Explicit Solid JSX config: `jsx: "preserve"` and `jsxImportSource: "solid-js"` | Keep repository module/resolution settings unless fixing an actual mismatch | Raw `tsc --init` / `bun init` JSX defaults left unchanged |
| Local primitive/reactive value | `createSignal` | Inline pure expressions when trivial | React hooks or ad-hoc mutable locals |
| Nested structured state | `createStore` | `produce(...)` for dense nested edits | Direct mutation of store state; `createMutable` as general default |
| Derived value | `createMemo` or direct derivation from signals | Inline in JSX if trivial and cheap | `createEffect` that writes another signal |
| Async read in plain Solid | `createResource` + `<Suspense>` + `<ErrorBoundary>` | Use repo/router-native data APIs if already adopted | Manual `loading/error/data` signal triplets everywhere in new code |
| Simple conditional UI | Plain ternary or `&&` | `<Show>` when you need a fallback, accessor child, or keyed recreation | Effect-driven DOM toggling |
| Re-ordering / variable-length list | `<For>` |  | `.map()` in reactive JSX for dynamic lists |
| Stable-length list with frequently changing item contents | `<Index>` |  | `<For>` by habit |
| Common DOM events | `onClick`, `onInput`, `onKeyDown` |  | React event assumptions |
| Custom events, direct listeners, capture/passive/once options | `on:*` | Use `handleEvent` object form when listener options matter | Deprecated `oncapture:` or custom-event handling through delegated `on*` |
| Solid props | Read props directly or partition with `splitProps` | Use `mergeProps` for defaults; `children(...)` for repeated children reads | Destructuring props into plain locals when values must stay reactive |
| Styling repeated patterns | UnoCSS `shortcuts` | Small local class map when variants are finite | Style-only wrapper components for every repeated utility string |
| Dynamic-looking utility selection | Static literals, enum-like maps, `shortcuts`, or `safelist` | Extend Uno extraction for `.ts` / `.js` only when needed | Template-built utility names like ``bg-${tone}-500`` |
| UnoCSS config | Dedicated `uno.config.ts` with explicit `presetWind4()` | Enable transformers only when used | Tailwind config assumptions or hidden inline config |
| UnoCSS reset | `presetWind4({ preflights: { reset: true } })` if reset is needed | Leave off if the repo intentionally avoids reset | Importing old reset packages by default in new `presetWind4` work |
| Bun-only APIs | Isolate to Bun-only files/config and add Bun types only where needed | Guard with `process.versions.bun` when one module must branch | Using `Bun` globals directly in browser/shared UI modules |
| Routing | Use the repository’s existing router/meta-framework | Add one only if the task explicitly requires routing | Inventing `@solidjs/router` or SolidStart because examples elsewhere use them |
| Auto-run on known hosts | `content_scripts` or `scripting.registerContentScripts()` | `registerContentScripts()` persists; `executeScript()` does not | Re-injecting everything with one-off scripting calls on every navigation |
| User-invoked tab access | `activeTab` + `scripting.executeScript()` for one-tab, user-triggered features | Optional host permissions for broader opt-in access | Broad `host_permissions` or `<all_urls>` by default |
| Cross-browser MV3 background | Dual background declaration or repo-specific split manifests when Firefox matters | Check browser support matrix before relying on dual declaration for old Chromium | `service_worker`-only manifests for a Firefox target |
| Extension messaging | One typed dispatcher per context; JSON-safe payloads; `return true` for async responses by default | Namespace follows repository convention | Multiple ad-hoc `async` listeners returning accidental `undefined` / `null` |
| Extension API namespace | Repository’s existing convention | `browser.*` is acceptable only when Chromium 148+ is guaranteed and there is no `devtools_page` | Blindly rewriting a mixed codebase to `browser.*` |

## Implementation Guidelines

### Code Design

#### Type Solid components as plain functions first

**Default:** Use plain functions with explicit props and `JSX.Element` returns. This is the safest default and handles generics cleanly.

```tsx
// src/components/Greeting.tsx
import type { JSX } from "solid-js";

type GreetingProps = {
  name: string;
};

export function Greeting(props: GreetingProps): JSX.Element {
  return <p>Hello, {props.name}</p>;
}
```

**Conditional:** `Component<Props>` is fine when the surrounding codebase already uses it and the component is not generic.

**Reject:** Do not force `Component` types onto generic components. Write the generic function signature explicitly.

**Existing code:** Match the local file style. Do not rewrite every component signature just to standardise on one notation.

#### Treat the component body as setup, not as a re-rendering function

**Default:** Assume a Solid component function runs once to set up reactive relationships. Put signal/store/memo/effect creation in the component body. Put ongoing reactive work in memos, JSX expressions, resources, and effects. citeturn3search13turn0search13turn4search6

**Reject:** Do not import React’s mental model of “the function runs again on every state change”. Do not add `useState`, `useEffect`, `useMemo`, or `useCallback`.

**Existing code:** When touching a React-like Solid component, fix only the stale local pattern you are editing. Do not broad-rewrite the entire file unless requested.

#### Do not destructure reactive props at the top of the component

**Default:** Read props through `props.<name>`. For default props, use `mergeProps`. For wrapper/forwarding components, use `splitProps`. citeturn4search3turn4search11

**Conditional:** If you need to read `props.children` more than once, use `children(() => props.children)` so children are resolved once and reused safely.

**Reject:** Do not do this in reactive components:

```ts
const { name } = props;      // breaks reactivity
const name = props.name;     // also breaks reactivity if cached once
```

Use one of these instead:

```ts
const name = () => props.name;
```

or:

```ts
const [local, rest] = splitProps(props, ["name"]);
```

**Existing code:** If a touched component destructures a prop that must stay reactive, migrate that prop access locally. Do not refactor unrelated props in the same file.

### Type Safety and TypeScript Configuration

#### Use a Solid-first TS config for TSX, not Bun’s generic JSX settings

**Default:** In application-level TSX code, keep Solid’s JSX requirements and modern TypeScript/Bun module settings together.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "module": "preserve",
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noEmit": true,
    "lib": ["es2025", "dom"],
    "types": []
  }
}
```

**Why this is the safe default:**

- Solid TSX requires preserved JSX and `jsxImportSource: "solid-js"`.
- Bun and modern bundled web apps are best represented by `module: "preserve"` plus `moduleResolution: "bundler"` in new work.
- Recent TypeScript defaults can differ materially from older generated configs.
- `types: []` avoids accidental global pollution and makes Bun/test/browser globals explicit.

**Conditional:** If the repository contains Bun-only scripts, server files, Bun-specific tests, or browser-extension build tooling, add Bun types in a separate config or package scope instead of globally across all browser TSX.

```jsonc
// tsconfig.bun.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["es2025"],
    "types": ["bun"]
  },
  "include": ["scripts/**/*.ts", "server/**/*.ts"]
}
```

**Browser-extension boundary:** Bun-specific globals, Bun APIs, and Bun TypeScript relaxations belong in Bun-run scripts and tooling, not popup, content, options, or background UI code. Bun’s TS guidance enables options such as `types: ["bun"]`, `moduleResolution: "bundler"`, and `allowImportingTsExtensions`; do not spread those into browser-only extension code unless the repo already standardises on them. citeturn22view0turn23view3

**Reject:**

- `jsx: "react-jsx"` in Solid `.tsx` projects
- `moduleResolution: "node"` / `"classic"` in new Bun/bundled app code
- `types: ["*"]` unless the repository explicitly requires broad global types
- Setting `esModuleInterop` or `allowSyntheticDefaultImports` to `false`
- `.ts` import suffixes or Bun-only loaders in browser runtime code just because Bun accepts them

**Existing code:** If a repo is on older TypeScript config, change config in a small dedicated commit before touching many TSX files. Do not mix mass tsconfig migration with feature work.

#### Keep type imports explicit

**Default:** Use `import type` when importing types only. With `verbatimModuleSyntax`, this keeps emitted module syntax predictable.

```ts
import type { JSX } from "solid-js";
```

**Reject:** Do not rely on deprecated import-elision-era habits. Do not keep value-looking imports that are actually type-only.

#### Bun transpiles, TypeScript type-checks

**Default:** Treat Bun as the runtime/transpiler and TypeScript as the type-checker. Always run the repository type-check after meaningful TS/TSX changes.

**Reject:** Do not assume “it runs under Bun” means “the types are correct”.

#### Keep side-effect imports explicit and valid

**Default:** With modern TypeScript, missing side-effect imports are surfaced more aggressively. Keep CSS and virtual-module imports aligned with the repository’s existing type declarations or bundler/client types.

**Conditional:** If a CSS or virtual-module import errors in a typed project, add the smallest local declaration or repository-standard client types package. Do not globally weaken type-checking to silence it.

### Runtime, Project, and Workspace Boundaries

**Default:** Treat Bun as the tooling/runtime boundary where code actually runs under Bun. Browser-facing Solid UI and extension code must remain browser-safe.

Use:

- `process.env` or `Bun.env` in Bun runtime code
- the repository’s existing browser environment mechanism in client code
- standard ESM/TS for shared utilities that must work in the project’s existing build path

**Conditional:** If a shared helper must branch on runtime, use `process.versions.bun` to detect Bun.

**Reject:**

- Importing Bun-only modules into browser components
- Reading secrets directly from UI code
- `typeof Bun !== "undefined"` in shared TS unless the project already includes Bun types for that file
- Spreading Bun types globally across browser/extension code

**Workspace default:** In Bun workspaces/monorepos, isolated installs mean every package must declare its own dependencies. Do not rely on dependencies that are only present elsewhere in the workspace.

### State, Reactivity, and Data Flow

#### Use signals for local scalar state

**Default:** Use `createSignal` for local values such as booleans, selected IDs, counts, open/closed state, and form field values.

#### Use stores for structured nested state

**Default:** Use `createStore` for objects and arrays that need nested reactive reads and targeted updates. citeturn3search1turn3search5

```tsx
const [state, setState] = createStore({
  filters: { query: "", onlyOpen: false },
  items: [] as { id: string; title: string }[],
});

setState("filters", "query", "solid");
```

**Conditional:** Use `produce(...)` when the touched update is deep and imperative-style edits are clearer than many path arguments.

**Reject:** Do not mutate store state directly:

```ts
state.filters.query = "solid";
```

**Existing code:** If a file already uses `createMutable`, preserve behaviour unless you are explicitly refactoring state management. Do not perform a file-wide mutable-to-store migration as part of unrelated work.

#### Derive state with memos, not effects

**Default:** If a value can be computed from other reactive values, use `createMemo` or compute it directly in JSX if it is trivial. citeturn0search19turn4search6

```tsx
// src/components/Counter.tsx
import { createMemo, createSignal, mergeProps, type JSX } from "solid-js";

type CounterProps = {
  initial?: number;
  disabled?: boolean;
  onCommit?: (value: number) => void;
};

export function Counter(allProps: CounterProps): JSX.Element {
  const props = mergeProps({ initial: 0, disabled: false }, allProps);
  const [count, setCount] = createSignal(props.initial);
  const isEven = createMemo(() => count() % 2 === 0);

  const increment: JSX.EventHandler<HTMLButtonElement, MouseEvent> = () => {
    const next = count() + 1;
    setCount(next);
    props.onCommit?.(next);
  };

  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={increment}
      class="rounded-md px-3 py-2 text-sm font-medium transition"
      classList={{
        "bg-sky-600 text-white": isEven(),
        "bg-slate-200 text-slate-900": !isEven(),
      }}
    >
      {count()}
    </button>
  );
}
```

**Reject:** Do not mirror derived state with an effect like this:

```ts
createEffect(() => setIsEven(count() % 2 === 0));
```

That adds unnecessary state and can introduce loops or ordering bugs.

#### Use effects only for side effects and imperative bridges

**Default:** Use `createEffect` for work that touches the outside world: logging, syncing to a non-Solid library, non-reactive browser APIs, or imperative integration.

**Conditional:** Use `onMount` for one-time imperative DOM work and `onCleanup` to dispose timers, subscriptions, and listeners.

**Reject:** Do not use `createEffect` as a substitute for derived state. Do not update signals inside effects unless you are bridging to an imperative system and the write is clearly bounded.

#### Use `batch` and `untrack` deliberately

**Default:** Use `batch(...)` when you intentionally group several synchronous writes into a single downstream update. Use `untrack(...)` when you need a snapshot read that should not become a dependency.

**Conditional:** `batch(...)` only applies to synchronous work up to the first `await`. If you cross an async boundary, use a new batch after the await if needed.

**Reject:** Do not sprinkle `untrack` to “fix” unclear reactive code. Use it only when you can explain why a read must not subscribe.

### Rendering and Events

#### Call `render` with a function

**Default:** Mount Solid apps like this:

```tsx
// src/main.tsx
import { render } from "solid-js/web";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error('Missing mount element "#root"');

render(() => <App />, root);
```

**Reject:** Do not call `render(<App />, root)`.

#### Use the right control-flow primitive

**Default:**

- Use a ternary or `&&` for very small inline conditions.
- Use `<Show>` when you want a fallback or function child.
- Use `<For>` when list order/length may change.
- Use `<Index>` when length/order are stable but item values change often.

**Conditional:** Use `<Show keyed>` only when you need to recreate the subtree even when the condition stays truthy but the value changes.

**Reject:**

- Do not wrap every condition in `<Show>` by habit.
- Do not use `<For>` for stable fixed-position cells if `<Index>` matches the data shape better.
- Do not use `.map()` in reactive JSX for dynamic lists.

#### Use native event semantics, not React expectations

**Default:**

- `onInput` fires as the input value changes.
- `onChange` uses native change semantics.
- `on*` uses Solid’s delegated event system when supported.
- `on:*` attaches a direct listener and is the right tool for custom events or listener options.

**Conditional:** When you need `capture`, `once`, or `passive: false`, use `on:*` with a `handleEvent` object.

**Reject:**

- Do not assume React-style synthetic event semantics.
- Do not rebind handlers reactively by passing signal values directly as event handlers.
- Do not introduce deprecated `oncapture:` in new code.
- Do not use React-style camelCase `style` object keys. In Solid, object `style` keys are lower-case, dash-separated CSS property names. citeturn3search21

#### Wrap async UI with `Suspense` and `ErrorBoundary`

**Default:** If component rendering depends on a resource, put the read under `<Suspense>` and a nearby `<ErrorBoundary>`.

**Important boundary:** `ErrorBoundary` catches render/update errors in its subtree. It does **not** catch errors thrown from event handlers or from work scheduled outside Solid’s render/update flow. Use local `try`/`catch` or explicit promise error handling there.

### Data Loading and Mutations

#### Use `createResource` for component-scoped async reads in plain Solid

**Default:** For plain Solid code that fetches async data and does not already use a router-native data API, use `createResource`.

```tsx
// src/components/RemoteUsers.tsx
import { createResource, ErrorBoundary, For, Suspense } from "solid-js";

type User = {
  id: string;
  name: string;
};

async function fetchUsers(): Promise<User[]> {
  const response = await fetch("/api/users");

  if (!response.ok) {
    throw new Error(`Failed to load users: ${response.status}`);
  }

  return response.json() as Promise<User[]>;
}

export function RemoteUsers() {
  const [users, { refetch }] = createResource(fetchUsers);

  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div class="space-y-2">
          <p class="text-red-600">{error.message}</p>
          <button
            type="button"
            class="btn"
            onClick={() => {
              reset();
              void refetch();
            }}
          >
            Retry
          </button>
        </div>
      )}
    >
      <Suspense fallback={<p class="text-slate-500">Loading…</p>}>
        <ul class="space-y-2">
          <For each={users()}>{(user) => <li>{user.name}</li>}</For>
        </ul>
      </Suspense>
    </ErrorBoundary>
  );
}
```

**Conditional:** If the repository already uses `@solidjs/router`, SolidStart, or another existing data layer, follow that local pattern instead of introducing `createResource` alongside it.

**Reject:** Do not add a third-party async state library unless the repository already depends on it or the task explicitly requires one.

#### Keep mutations explicit

**Default:** Model mutations as explicit `async` functions that validate inputs, call the backend/API, and then update signals/stores/resources in one obvious place.

**Reject:** Do not hide writes inside memos or broad reactive effects.

**Existing code:** If a touched area already uses manual `loading/error` signals, keep that pattern unless you are explicitly refactoring the async flow.

### Browser Extension Architecture and Compatibility

#### Separate code by extension context

**Default:** Separate code by extension context because capabilities differ:

- **background** for privileged event handling
- **content** for page DOM interaction
- **popup / action page** for quick user-triggered UI
- **options page** for durable configuration
- **shared** for types, message contracts, storage schemas, and pure utilities

Suggested file locations:

- `manifest.json`
- `uno.config.ts`
- `src/background/`
- `src/content/`
- `src/popup/`
- `src/options/`
- `src/shared/` for message contracts, storage keys, and pure utilities

citeturn25view1turn30view1turn30view2

#### Target MV3 for new extension work

**Default:** For new Chromium + Firefox work, target **Manifest V3**. Chrome MV2 is effectively dead for production use. Use `action`, not `browser_action` / `page_action`. citeturn33view0turn31search4turn31search0turn31search15

**Critical compatibility rule:** A current cross-browser MV3 manifest cannot assume one background model. Chromium uses `service_worker`; Firefox currently uses background scripts/pages in MV3. The smallest cross-browser default is either:

- dual declaration in one manifest, or
- repo-specific split manifests if the build already supports them. citeturn25view1turn25view0

```json
// manifest.json
{
  "manifest_version": 3,
  "name": "My Extension",
  "version": "0.1.0",
  "action": {
    "default_popup": "popup/index.html"
  },
  "options_ui": {
    "page": "options/index.html"
  },
  "background": {
    "scripts": ["background.js"],
    "service_worker": "background.js",
    "type": "module"
  },
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": [],
  "optional_host_permissions": ["https://*/*", "http://*/*"],
  "browser_specific_settings": {
    "gecko": {
      "id": "your-extension@example.com"
    }
  }
}
```

Use this shape only when Firefox is a real target. `browser_specific_settings.gecko.id` matters for Firefox MV3 signing / self-distribution, and a fixed Firefox ID also matters in some resource and native-messaging cases. If the repo already has a manifest-generation system, follow that instead of pasting raw JSON. citeturn25view1turn25view0turn8search1turn26search12turn14search2

**Conditional:** If you must support older Chromium than 121, do **not** rely on the dual-declaration approach without checking the repository’s browser support matrix, because older Chrome refused MV3 manifests containing `background.scripts`. Current stable Chromium is past that boundary. citeturn25view1

#### Respect content-script boundaries

**Default:** Keep content scripts in their normal isolated environment. They do not see page JavaScript variables directly; Firefox applies Xray-like behaviour and Chromium uses an isolated world. If you truly need access to page-world JS state, treat it as a separate bridge problem, not as ordinary content-script code. In page-world code, do not expect privileged extension APIs. citeturn30view1turn30view2turn6search9turn6search10

**Default:** Use:

- static `content_scripts` for well-known always-on hosts,
- `scripting.registerContentScripts()` when registration is managed at runtime and should persist,
- `scripting.executeScript()` for one-off or user-invoked injection. citeturn30view1turn30view2turn26search20

### Extension Messaging, Storage, Permissions, and Security

#### Centralise typed message dispatch

**Default:** Define message contracts in one shared typed module and centralise message dispatch. Keep payloads **JSON-safe** even though Firefox uses richer structured cloning, because Chrome messaging remains JSON-serialised by default. citeturn29view0turn28search11

**Default:** For asynchronous `runtime.onMessage` handlers, use a **non-async listener** that kicks off async work and returns `true`. That is the most compatible default across current Chromium and Firefox, and it avoids Chrome’s gradual feature rollout edge cases plus Firefox’s “async listener consumes every message” trap. citeturn29view0turn28search1

```ts
// src/shared/messages.ts
export type Request =
  | { type: "PING" }
  | { type: "GET_SETTINGS" }
  | { type: "SET_SETTINGS"; value: { enabled: boolean } };

export type Response =
  | { ok: true; value?: unknown }
  | { ok: false; error: string };
```

```ts
// src/background/index.ts
import type { Request, Response } from "../shared/messages";

async function handleMessage(message: Request): Promise<Response> {
  switch (message.type) {
    case "PING":
      return { ok: true, value: "pong" };

    case "GET_SETTINGS": {
      const { settings = { enabled: false } } =
        await chrome.storage.local.get("settings");
      return { ok: true, value: settings };
    }

    case "SET_SETTINGS":
      await chrome.storage.local.set({ settings: message.value });
      return { ok: true };

    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
  void handleMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      } satisfies Response);
    });

  return true;
});
```

**Reject:** Many scattered listeners competing to answer the same message type. In both browsers, only one effective response wins. Centralise each context’s inbound dispatch table. citeturn29view0turn28search1

#### Treat content-script input as untrusted

**Default:** Treat content-script messages as untrusted input. A compromised page can influence the renderer process hosting content scripts. Validate command type, sender, tab/frame assumptions, and data shape before performing privileged actions. Never send secrets or highly privileged objects to a content script unless they are already safe to leak to the page. citeturn30view0turn30view1

#### Persist extension state with extension storage

**Default:** Use `storage.local` for durable extension state. Background state must survive unloads: Chromium service workers terminate when idle, and Firefox event pages are non-persistent in MV3. Persist important state and restore on demand. Use `storage.sync` only for small user preferences that intentionally need browser-account synchronisation. citeturn7search0turn7search8turn26search4turn27search4turn27search1

**Reject:** `localStorage` as the default store for shared extension state or background state. Use the extensions storage API instead. citeturn12search18turn27search0

**Default:** If future work must survive background suspension, schedule with alarms or another event-driven API, not bare in-memory timers. citeturn12search18turn7search11

#### Request the smallest possible permission set

**Default:** Request the smallest possible permission set.

- Use **required permissions** only for core behaviour.
- Prefer **`activeTab`** for user-invoked access to the current page.
- Prefer **`optional_host_permissions`** for optional site access.
- Treat `<all_urls>` as exceptional. citeturn8search2turn13search0turn13search10turn8search17turn34search8

**Reject:** Remote hosted extension code, `eval`, or CSP-weakening patterns. MV3 forbids remotely hosted code and tightens extension CSP. Also avoid deprecated `extension.getURL()`; use `runtime.getURL()`. citeturn12search12turn12search17turn12search0turn14search3turn14search12

**Conditional:** If the feature is network-request filtering, do not design new cross-browser MV3 code around `webRequestBlocking` alone. Chrome MV3 moved most blocking/modification use cases to `declarativeNetRequest`; Firefox still supports some blocking patterns. Surface that as an explicit cross-browser design split rather than silently copying old Chrome MV2-era code. citeturn34search6turn34search4turn34search3

### UI, Styling, and Components with UnoCSS presetWind4

#### Configure UnoCSS in `uno.config.ts` and use `presetWind4()`

**Default:** Keep UnoCSS config explicit and local to the repo in a dedicated root config file. When `presets` is specified, UnoCSS ignores the default preset, so add `presetWind4()` explicitly. citeturn15view3turn16search9

```ts
// uno.config.ts
import { defineConfig, presetWind4 } from "unocss";

export default defineConfig({
  presets: [presetWind4()],
  shortcuts: {
    btn: "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium disabled:pointer-events-none disabled:opacity-50",
  },
});
```

If the project wants reset styles in a Wind4 setup, enable them through the preset:

```ts
// uno.config.ts
import { defineConfig, presetWind4, transformerDirectives } from "unocss";

export default defineConfig({
  presets: [
    presetWind4({
      preflights: { reset: true },
    }),
  ],
  transformers: [transformerDirectives()],
  safelist: [],
});
```

Keep `transformerDirectives()` only if the repo actually uses `@apply`, `--at-apply`, `@screen`, or `theme()`. Do not introduce directive syntax without the transformer. citeturn18view0turn18view1

**Reject:** Tailwind drift.

- Do not add `tailwind.config.*` files into an Uno-only project.
- Do not assume Tailwind plugins or Tailwind preflight behaviour.
- Do not write variant-group or directive syntax unless the matching UnoCSS transformer is enabled.
- Do not import older `@unocss/reset/tailwind.css` patterns into new `presetWind4` setups. `presetWind4` integrates reset handling internally. citeturn15view3turn16search0turn16search2turn17view2

#### Keep Uno utility names statically discoverable

**Default:** Keep utility strings fully static in scanned files. UnoCSS build-pipeline extraction includes TSX/JSX/HTML-like files by default, but **not** plain `.ts` / `.js` files. citeturn15view1turn15view4

If classes live in TS utilities, either:

- extend `content.pipeline.include`,
- add `// @unocss-include` to the file,
- move the class map into a scanned `.tsx` file, or
- safelist the exact finite classes.

**Reject:** Unconstrained string concatenation like:

```tsx
class={`bg-${tone}-500`}
```

or:

```tsx
class={`bg-${colour}-${level}`}
```

unless the exact output is safelisted or otherwise discoverable.

**Better pattern:**

```ts
// src/popup/ui/tokens.ts
export const buttonTone = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  neutral: "bg-zinc-200 text-zinc-900 hover:bg-zinc-300",
  danger: "bg-red-600 text-white hover:bg-red-700",
} as const;
```

Then consume:

```tsx
// src/popup/components/Button.tsx
import { splitProps } from "solid-js";
import { buttonTone } from "../ui/tokens";

type Tone = keyof typeof buttonTone;

export function Button(props: {
  tone?: Tone;
  class?: string;
  children: unknown;
}) {
  const [local, rest] = splitProps(props, ["tone", "class", "children"]);

  return (
    <button
      class={`rounded-md px-3 py-2 text-sm font-medium transition ${
        buttonTone[local.tone ?? "primary"]
      } ${local.class ?? ""}`}
      {...rest}
    >
      {local.children}
    </button>
  );
}
```

This is extractor-friendly and reviewable. citeturn15view1turn15view4turn3search2

#### Prefer shortcuts before style-only wrapper components

**Default:** If repeated styling is just a utility bundle and not a behavioural abstraction, use an Uno shortcut first.

**Conditional:** Extract a Solid component only when behaviour, accessibility, data flow, or composition needs are also being standardised.

**Reject:** Do not create wrapper components whose only job is to rename a static class string.

#### Use `presetWind4` keys, not Wind3 or Tailwind-shaped config keys

**Default:** When touching theme config in a `presetWind4` project, use Wind4 keys.

| Old shape | Wind4 shape |
|---|---|
| `fontFamily` | `font` |
| `borderRadius` | `radius` |
| `boxShadow` | `shadow` |
| `breakpoints` | `breakpoint` |
| `verticalBreakpoints` | `verticalBreakpoint` |

**Reject:** Do not copy Wind3 or Tailwind config snippets into a Wind4 config without translating the keys.

**Existing code:** If the repo migrated from Wind3, rename only the touched keys you actually work with. Do not broad-edit a large theme file without verifying generated CSS.

#### Treat `@property` generation as the default in `presetWind4`

**Default:** Leave `presetWind4` property preflights enabled. They are part of the preset’s current output model.

**Conditional:** If the repository has a verified compatibility issue with generated `@property` rules or the wrapper around them, disable or customise `preflights.property` in `presetWind4`.

**Risk:** Turning it off changes generated CSS structure and can affect styling assumptions around the `properties` layer.

#### Use standard class/classList unless Attributify is already configured

**Conditional:** If you need JSX valueless Attributify syntax, that is **not** part of this stack by default. Only use it if the repository already added `presetAttributify` and the JSX transformer needed for TSX.

**Stable fallback:** Standard `class` / `classList`. citeturn16search8turn3search2

### Example Solid + UnoCSS Component Pattern

```tsx
// src/popup/components/Toggle.tsx
import { createMemo, splitProps } from "solid-js";

type Props = {
  enabled: boolean;
  busy?: boolean;
  onToggle: () => void;
};

export function Toggle(props: Props) {
  const [local, rest] = splitProps(props, ["enabled", "busy", "onToggle"]);

  const tone = createMemo(() =>
    local.enabled ? "bg-emerald-600 text-white" : "bg-zinc-200 text-zinc-900",
  );

  return (
    <button
      type="button"
      class={`inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition ${tone()}`}
      classList={{ "pointer-events-none opacity-60": !!local.busy }}
      onClick={local.onToggle}
      {...rest}
    >
      {local.enabled ? "Enabled" : "Disabled"}
    </button>
  );
}
```

This keeps derivation reactive, preserves prop reactivity, and keeps UnoCSS class names statically discoverable. citeturn4search3turn3search2turn0search19turn15view1

### Bun Dependency and Configuration Security

#### Respect Bun’s dependency-script security model

**Default:** Bun does not run arbitrary dependency lifecycle scripts by default. If a dependency genuinely needs install-time scripts, whitelist it with `trustedDependencies`.

**Reject:**

- Do not blanket-re-enable arbitrary lifecycle scripts.
- Do not copy npm-era “just let postinstall run” assumptions into Bun.

**Existing code:** If a dependency install breaks under Bun, add the smallest explicit `trustedDependencies` entry required. Do not relax security globally.

#### Be reproducible with installs

**Default:** Use `bun.lock` and verify it with `bun install --frozen-lockfile` in CI or when you need a reproducibility check.

**Reject:** Do not hand-edit `bun.lock`. Do not commit multiple package-manager lockfiles in a Bun-owned repository.

## Testing, Tooling, and Verification

Use repository scripts first. Because the stack does **not** specify a bundler, linter, extension framework, or browser-test framework, do not invent tool commands that are not already in `package.json`. Bun should wrap existing scripts where available. citeturn23view1turn23view3

| Trigger | Run | Failure means |
|---|---|---|
| Fresh checkout or dependency changes | `bun install` | Install/config/dependency breakage |
| Fresh install / CI / lockfile-sensitive change | `bun install --frozen-lockfile` | Dependency drift, lockfile mismatch, or manifest mismatch |
| Any meaningful TS/TSX change | `bun run typecheck` if present, otherwise `bunx tsc --noEmit` | Type/config/module-resolution breakage |
| Any meaningful code change | `bun run <existing-check-script>` for repository scripts such as `typecheck`, `build`, `test`, `lint`, or `check` | The repo’s declared verification no longer passes |
| Runtime or unit logic change | `bun run test` if present; otherwise `bun test` if the repo already uses Bun tests | Behavioural regression |
| Focused local iteration on Bun tests | `bun test <path>`, `bun test -t <pattern>`, `bun test --watch` | Narrowed failure in touched area |
| Coverage verification in Bun-test repos | `bun test --coverage` | Untested or uncovered paths in touched logic |
| Production-affecting build change | `bun run build` | Bundling/integration breakage |
| One-off repo-local tool | `bunx <tool>` | Ensures the repo’s pinned version is used |
| Added or changed message / storage / background logic | Manual extension smoke test in Chromium and Firefox: install unpacked/temp add-on, exercise popup/options/content-script flows, verify permission prompts, storage persistence, and background wake-up/resume | Cross-context integration is broken even if types compile |
| Changed background lifecycle behaviour | Re-test with extension DevTools closed in Chromium | Open DevTools can keep the service worker alive and hide lifecycle bugs citeturn7search18 |
| Changed UnoCSS config or classes | Rebuild and inspect affected UI surfaces for missing styles | Extraction, safelist, or preset config is wrong citeturn15view1turn15view4 |

Additional rules:

- **Default:** For Bun test suites, prefer explicit imports from `bun:test` over relying on globals in new code.
- **Conditional:** If the repository already uses Bun test globals, keep that style locally instead of rewriting the whole test suite.
- **Conditional:** If the task explicitly requires adding a new Solid component-test stack and the repository has none, the current Solid docs recommend Vitest with `@solidjs/testing-library`. Otherwise, do not introduce a new runner just for style compliance.
- **Reject:** Do not silently swap the repository’s existing browser-test setup to Bun test or Vitest during unrelated feature work.

### Minimum verification checklist for extension changes

- popup renders and can talk to background,
- options page loads and persists settings,
- content script runs only on granted hosts,
- user-invoked `activeTab` flows work,
- background state survives restart / suspension appropriately,
- Firefox-specific packaging fields still make sense for the manifest if Firefox is in scope. citeturn13search0turn7search8turn8search1

## Migration and Anti-Patterns

High-signal stale patterns first:

| Reject | Use instead | Existing-code migration |
|---|---|---|
| React hooks (`useState`, `useEffect`, `useMemo`, `useCallback`) in Solid code | `createSignal`, `createEffect`, `createMemo`, plain functions | Replace only in touched components |
| Top-level prop destructuring or cached `const x = props.x` | `props.x`, accessor wrappers, `splitProps` | Fix the touched reactive props path only |
| Effect-driven derived state | `createMemo` or inline derivation | Collapse touched duplicated state locally |
| Direct store mutation | `setStore(...)` or `produce(...)` | Wrap touched writes first |
| `jsx: "react-jsx"` in Solid TSX | `jsx: "preserve"` + `jsxImportSource: "solid-js"` | Update config before broad TSX edits |
| React JSX defaults from `tsc --init` / `bun init` | Solid JSX config (`jsx: "preserve"`, `jsxImportSource: "solid-js"`) | Correct config before touching more TSX |
| `moduleResolution: "node"` / `"classic"` for new Bun/bundled app code | `moduleResolution: "bundler"` | Migrate config in one dedicated change |
| Bun generic JSX config copied into Solid app config | Solid-first TSX config | Fix tsconfig, not each component individually |
| Template-built Uno class names | Static maps, shortcuts, or `safelist` | Convert touched call sites only |
| Dynamic, extractor-invisible utility strings | Static maps, `shortcuts`, `safelist`, or expanded include rules | Replace only the broken class-generation path |
| Wind3/Tailwind theme keys in `presetWind4` | Wind4 theme keys | Rename touched keys and verify CSS output |
| `tailwind.config.*` in an Uno-only project | `uno.config.ts` | Remove only when touching build config |
| Deprecated `oncapture:` usage | `on:*` with handler-object options | Replace touched listeners surgically |
| Bun globals in browser/shared UI modules | Bun-only modules or `process.versions.bun` guard | Move the touched helper behind a boundary |
| Hand-editing `bun.lock` or mixing lockfiles | Bun-managed lockfile updates | Regenerate with Bun in a small dedicated commit |
| Adding a router/meta-framework not present in the repo | Existing local routing pattern, or none | Surface as a proposal instead of silently adding it |
| Experimental Solid APIs in new production code, such as `SuspenseList` | Stable 1.x primitives | Leave existing experiments isolated unless tasked to remove them |
| Manifest V2 in new extension code | Manifest V3 | Do not keep MV2 alive for Chromium targets; plan smallest MV3 step |
| `browser_action` / `page_action` in MV3 | `action` | Rename touched manifest/API usage first |
| Firefox target with `service_worker`-only background | Dual-declared MV3 background or repo split manifests | Fix manifest boundary before adding more background features |
| Shared extension state in `localStorage` or background memory only | `storage.local` and event-driven restoration | Start with touched keys and background entrypoints |
| Bare timers for future background work | alarms / event-driven APIs | Replace the touched timer path first |
| `extension.getURL()` | `runtime.getURL()` | Replace locally when touched |
| Remote hosted code / `eval` | Packaged local code only | Remove the violating load path before new features |
| Scattered `async` message listeners | One dispatcher using `return true` for async responses | Consolidate one context at a time |
| Assuming `browser.*` is universally safe | Repo convention, or conditional adoption only with Chromium 148+ and no `devtools_page` | Avoid namespace rewrites unless the repo asks for them |
| Chromium-only blocking `webRequest` design in new cross-browser MV3 work | `declarativeNetRequest` where it fits; explicit browser split where it does not | Surface broader migration instead of silently copying legacy listeners |

Safe migration rules:

- Change config separately from feature logic when possible.
- Do not convert entire component trees from one state idiom to another during a nearby feature edit.
- If a broader migration is genuinely required, stop after the first safe step and surface the remaining work explicitly.

## Quick Reference

### Preferred defaults

- **Package manager / script runner / runtime:** Bun where the code actually runs under Bun
- **Lockfile:** `bun.lock`
- **Solid local scalar state:** `createSignal`
- **Solid structured nested state:** `createStore`
- **Derived reactive values:** `createMemo`
- **Async component-scoped reads:** `createResource`
- **DOM/imperative setup:** `onMount` + `onCleanup`
- **Dynamic list rendering:** `<For>` or `<Index>`
- **Styling system:** UnoCSS in `uno.config.ts` with `presetWind4()`
- **Repeated utility bundles:** Uno `shortcuts`
- **TSX config:** `jsx: "preserve"`, `jsxImportSource: "solid-js"`
- **Module config for new Bun/bundled app code:** `module: "preserve"`, `moduleResolution: "bundler"`
- **Extension manifest default:** MV3 with `action`
- **Cross-browser extension background:** Dual declaration or split manifests when Firefox matters
- **Extension storage:** `storage.local` for durable state
- **Extension page access:** `activeTab` for user-invoked access; optional host permissions for opt-in site access

### Use this, not that

| Use this | Not that |
|---|---|
| `createSignal(...)` | `useState(...)` |
| `createMemo(...)` | `createEffect(() => setSomething(...))` |
| `createStore(...)` | nested object mutation |
| `props.foo` / `splitProps(...)` | `const { foo } = props` |
| `children(() => props.children)` | reading `props.children` repeatedly |
| `<For>` / `<Index>` | reactive `.map()` in JSX |
| `onInput` for live text updates | React-style `onChange` expectations |
| `on:*` for custom/direct/options listeners | `oncapture:` or misusing delegated events |
| static class maps / `safelist` | template-built Uno utility strings |
| `uno.config.ts` + `presetWind4()` | `tailwind.config.*` in an Uno-only repo |
| `bun run` / `bunx` | `npm run` / `npx` |
| Bun-only module boundaries | `Bun` globals inside Solid browser components |
| MV3 `action` | `browser_action` / `page_action` in new MV3 code |
| Dual-declared cross-browser MV3 background when Firefox matters | `service_worker` only |
| `activeTab` for user-invoked page access | Broad host permissions by default |
| Typed JSON-safe messages + `return true` async listener | Ad-hoc `async` listeners everywhere |
| `storage.local` for durable extension state | `localStorage` or background-only memory |
| `runtime.getURL()` | `extension.getURL()` |
| `preflights.reset: true` in `presetWind4` if reset is needed | Old reset-package imports by default |

### File-location cheat sheet

| File | Purpose |
|---|---|
| `package.json` | scripts, dependencies, workspaces, `trustedDependencies` |
| `bun.lock` | authoritative lockfile |
| `tsconfig.json` | app-level TypeScript + Solid JSX config |
| `tsconfig.bun.json` | Bun-only scripts/server/tests when needed |
| `uno.config.ts` | UnoCSS preset, shortcuts, safelist, extraction config |
| `bunfig.toml` | Bun-specific behaviour only, when needed |
| `src/main.tsx` | browser mount entry, when the repo is a plain Solid app |
| `manifest.json` | extension manifest |
| `src/background/` | extension privileged event handling |
| `src/content/` | page DOM interaction |
| `src/popup/` | extension popup / action UI |
| `src/options/` | durable extension configuration UI |
| `src/shared/` | message contracts, storage keys, schemas, pure utilities |

### Verification commands

```bash
bun install
bun install --frozen-lockfile
bun run typecheck
bunx tsc --noEmit
bun run test
bun test
bun test --watch
bun test --coverage
bun run build
```

For extension changes, also load the extension in Chromium **and** Firefox after any manifest, background, permission, messaging, or storage change, and re-test background lifecycle with Chromium extension DevTools closed.

### Top anti-drift warnings

- Do not write React in Solid files.
- Do not copy Bun’s generic JSX config into Solid TSX projects.
- Do not build Uno utility names with string interpolation.
- Do not use Wind3 or Tailwind config keys in `presetWind4`.
- Do not rely on Bun globals in shared browser/UI modules.
- Do not invent routers, test runners, form libraries, deployment stacks, extension frameworks, linters, or formatters not already present in the repository.
- Do not default new extension work to Manifest V2.
- Do not request broad host permissions unless the feature truly requires them.
- Do not assume Chromium and Firefox MV3 background models are identical.
