// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DocRewind design system. presetWind4 ONLY (oklch, Tailwind-4 compatible) — no
// tailwind.config, no PostCSS. See PRODUCT.md (strategy) and DESIGN.md (the visual
// system this file implements; DESIGN.md is the human-readable spec, this is the
// machine source of truth — keep them in sync).
//
// Direction: "a warm reading room, kept by a helpful hand." A friendly, Apple-
// Settings-calm classroom companion for educators of mixed technical ability. The
// document still reads like a real document (serif leaf); the interface around it
// is soft, generous and reassuring.
//
// Color architecture: SEMANTIC CSS VARIABLES (`--dr-*`) defined once in the
// preflight and FLIPPED under the pinned `.dark` class. Uno theme colors map to
// those vars (`bg-canvas`, `text-ink`, `bg-brand`, …), so components carry NO
// `dark:` duplication for color — dark mode "just works" when the variables flip.
// Warmth lives in a low-chroma warm-gray neutral (hue ~75, NOT cream) plus a honey
// accent and friendly type; the ink is a cool blue-black, so warm paper + cool ink
// gives the page its quiet, legible character. Every value below is WCAG-AA verified.
//
// Dark mode is pinned EXPLICITLY to the class strategy (`.dark` on <html>), driven
// by the Seam-E applier (lib/theme.ts + the page mounts). Motion suppression is
// declarative: a `prefers-reduced-motion` preflight neutralizes
// timeline/scrubber/progress transitions at the CSS layer, and the App separately
// caps the JS auto-advance cadence.
//
// The three reconstruction states ALWAYS pair color with a non-color affordance
// (suggestion = dotted underline, deletion = strike, opaque = labeled chip) so
// meaning is never carried by color alone (§9.11).

import { defineConfig, presetWind4, type SourceCodeTransformer } from "unocss";

// Build-determinism transformer (Phase 7).
//
// presetWind4 emits its `:root,:host { … }` theme-variable block (theme layer)
// and its `*,::before… { --un-* }` registered-property block (properties layer)
// in extraction-ENCOUNTER order — `Array.from(Set/Map)`, unsorted
// (@unocss/preset-wind4/dist/index.mjs:503,20). WXT runs one Vite build over
// several entrypoints, so the order keys are first touched varies run-to-run,
// permuting those blocks. That changes the CSS bytes AND the Vite asset `[hash]`
// (assigned inside renderChunk at @unocss/vite index.mjs:595), which cascades
// into the sibling JS/HTML that embed the hashed name — so back-to-back builds
// would not be per-file content-identical.
//
// UnoCSS runs config `transformers` (enforce:"post") over each generated layer's
// CSS at @unocss/vite index.mjs:586-590, immediately BEFORE that CSS is handed to
// vite:css-post for hashing. Sorting the declarations of any innermost pure-`--`
// block here makes the emitted bytes — and therefore the filename hash —
// deterministic. Safe because each custom property is emitted exactly once
// (Set/Map dedup), so declaration order within a single rule has no cascade
// effect; the `--`-only guard leaves every non-var rule untouched.
const sortUnoVarBlocks: SourceCodeTransformer = {
  name: "docrewind:sort-uno-var-blocks",
  enforce: "post",
  // The generated layer CSS is passed to transformers under a synthetic id
  // ending in `-unocss-hash.css` (@unocss/vite index.mjs:584); match it so this
  // runs on generated CSS (the default extraction filter would skip it).
  idFilter: (id) => id.endsWith("-unocss-hash.css"),
  transform(code) {
    const css = code.toString();
    const blockRe = /\{([^{}]*)\}/g;
    let changed = false;
    const next = css.replace(blockRe, (whole, body: string) => {
      const decls = body
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      if (decls.length < 2 || !decls.every((d) => d.startsWith("--"))) return whole;
      const sorted = [...decls].sort();
      if (sorted.every((d, i) => d === decls[i])) return whole; // already ordered
      changed = true;
      return `{${sorted.join(";")};}`;
    });
    if (changed) code.overwrite(0, code.original.length, next);
  },
};

// ── Component vocabulary (shortcuts) ────────────────────────────────────────────
// Hoisted to a module const so `safelist` below can be derived from the keys.
// Heritage names (dr-card, btn-primary, tl-track, doc-suggest, doc-caret,
// dr-brandmark, …) are PRESERVED — some are queried directly by tests — and
// re-valued onto the new token system. Colors are semantic (`bg-canvas`,
// `text-ink`, `bg-brand`); no `dark:` needed for color (the vars flip).
const shortcuts = {
  // ── Page & surfaces ──────────────────────────────────────────────────────
  // The page is a calm, flat warm canvas (no hero gradient). Body type is the
  // friendly humanist system sans; the document leaf is the only serif surface.
  "dr-surface": "bg-canvas text-ink font-sans antialiased",
  "dr-page": "dr-surface min-h-screen",
  // A grouped surface card (iOS-Settings register): soft elevation, no border.
  "dr-card": "rounded-2xl bg-surface p-5 shadow-[var(--dr-shadow-md)]",
  // The same card without padding, for grouped row lists that draw their own.
  "dr-panel": "rounded-2xl bg-surface shadow-[var(--dr-shadow-md)]",
  // A quiet sunken well (tracks, code, read-only readouts).
  "dr-inset": "rounded-xl bg-sunken",

  // ── Grouped rows (the iOS-Settings pattern) ──────────────────────────────
  // A `dr-panel` holds a column of `dr-row`s separated by hairlines. A quiet
  // group label sits ABOVE the panel (not a tracked mono eyebrow).
  "dr-group": "flex flex-col gap-2",
  "dr-group-label": "px-1 text-[0.9375rem] font-semibold text-ink-secondary",
  "dr-rows": "dr-panel divide-y divide-hairline overflow-hidden",
  // A single label↔control row with a comfortable tap height.
  "dr-row": "flex min-h-[3.25rem] items-center justify-between gap-4 px-4 py-3",
  // A row that stacks its control/help beneath the label (long help, inputs).
  "dr-row-stack": "flex min-h-[3.25rem] flex-col justify-center gap-2 px-4 py-3.5",
  "dr-row-label": "text-[0.9375rem] font-medium text-ink",
  "dr-row-help": "text-[0.8125rem] leading-relaxed text-ink-muted text-balance",

  // ── Typography roles (hierarchy via size/weight/color, not eyebrows) ──────
  "dr-display":
    "[font-family:var(--dr-font-display)] text-[1.625rem] font-semibold leading-tight tracking-[-0.02em] text-balance text-ink",
  "dr-title":
    "[font-family:var(--dr-font-display)] text-[1.375rem] font-semibold leading-tight tracking-[-0.015em] text-balance text-ink",
  "dr-heading": "text-[1.125rem] font-semibold tracking-[-0.01em] text-ink",
  "dr-subheading": "text-base font-semibold text-ink",
  "dr-body": "text-[0.9375rem] leading-relaxed text-ink",
  "dr-lede": "text-base leading-relaxed text-ink-secondary text-pretty",
  "dr-muted": "text-[0.8125rem] leading-relaxed text-ink-muted",
  // A RARE, deliberate kicker — used at most once per surface, never per section.
  "dr-eyebrow": "text-[0.8125rem] font-semibold tracking-tight text-brand-text",
  // Mono data readouts.
  "dr-counter": "font-mono text-sm tabular-nums text-ink-muted",
  "dr-percent":
    "[font-family:var(--dr-font-display)] text-base font-semibold tabular-nums text-brand-text",
  "dr-dateline": "font-mono text-xs tabular-nums text-ink-muted",

  // ── Masthead ──────────────────────────────────────────────────────────────
  "dr-masthead": "flex flex-col gap-4",

  // ── Brand mark: the DocRewind glyph on a soft, always-light tile ──────────
  // The icon art carries light highlights and deep navies, so it is seated on a
  // tile that stays light in BOTH themes (the `--dr-chip` var has no `.dark`
  // override) — the way an OS launcher icon does — so the mark reads identically
  // regardless of color scheme. A hair of inset padding keeps the art off the
  // rounded corners; a hairline ring + soft shadow seats it on the page.
  "dr-brandmark":
    "inline-grid shrink-0 place-items-center overflow-hidden rounded-[11px] " +
    "bg-[var(--dr-chip)] p-1 shadow-[var(--dr-shadow-sm)] ring-1 ring-hairline",

  // ── Buttons (generous targets; focus-visible rings; always labeled) ───────
  "btn-base":
    "inline-flex min-h-[2.5rem] cursor-pointer select-none items-center justify-center gap-2 " +
    "rounded-xl px-4 text-[0.9375rem] font-medium leading-none " +
    "transition-[background-color,color,box-shadow,transform] duration-150 ease-[var(--dr-ease-out)] " +
    "outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2 " +
    "focus-visible:ring-offset-canvas active:translate-y-px " +
    "disabled:pointer-events-none disabled:opacity-45",
  // The primary call-to-action. One per surface.
  "btn-primary":
    "btn-base bg-brand text-brand-on shadow-[var(--dr-shadow-sm)] hover:bg-brand-hover",
  // Neutral action: a surface chip with a hairline (no shadow → no ghost-card).
  "btn-secondary": "btn-base bg-surface text-ink ring-1 ring-hairline-strong hover:bg-hover",
  // Quiet action: tinted hover only.
  "btn-ghost": "btn-base bg-transparent text-ink-secondary hover:bg-hover hover:text-ink",
  // Destructive action: danger-tinted, never a loud red block (reassurance first).
  "btn-danger":
    "btn-base bg-surface text-danger ring-1 ring-[var(--dr-danger-line)] hover:bg-danger-soft",
  // Taller variant for hero CTAs (≥44px touch target).
  "btn-lg": "min-h-[2.75rem] px-5 text-base",
  "btn-block": "w-full",

  // ── Segmented control (theme / speed / diagnostics) ───────────────────────
  // A pill track holding 2–4 options; the active one is a raised surface pill —
  // unmistakably "the selected one", the iOS register.
  seg: "inline-flex items-center gap-1 rounded-full bg-sunken p-1",
  "seg-item":
    "inline-flex min-h-[2rem] cursor-pointer select-none items-center justify-center gap-1.5 " +
    "rounded-full px-3.5 text-[0.875rem] font-medium text-ink-secondary " +
    "transition-[background-color,color,box-shadow] duration-150 ease-[var(--dr-ease-out)] " +
    "hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-ring",
  "seg-item-active": "bg-surface text-ink shadow-[var(--dr-shadow-sm)] hover:text-ink",

  // ── Switch (boolean settings — friendlier & bigger than a bare checkbox) ──
  "dr-switch":
    "relative inline-flex h-[1.6rem] w-[2.75rem] shrink-0 cursor-pointer items-center rounded-full " +
    "bg-hairline-strong px-[0.2rem] transition-colors duration-200 ease-[var(--dr-ease-out)] " +
    "outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2 " +
    "focus-visible:ring-offset-surface aria-checked:bg-brand disabled:opacity-45 disabled:cursor-not-allowed",
  "dr-switch-knob":
    "inline-block size-[1.2rem] rounded-full bg-white shadow-[var(--dr-shadow-sm)] " +
    "transition-transform duration-200 ease-[var(--dr-ease-out)]",

  // ── Inputs ────────────────────────────────────────────────────────────────
  "dr-input":
    "rounded-xl bg-surface px-3 py-2 text-[0.9375rem] text-ink ring-1 ring-hairline-strong " +
    "outline-none transition-shadow placeholder:text-ink-faint " +
    "focus-visible:ring-2 focus-visible:ring-brand-ring",
  "dr-field": "inline-flex items-center gap-1.5 rounded-xl bg-surface ring-1 ring-hairline-strong",
  "dr-field-input":
    "w-16 rounded-xl bg-transparent py-2 pl-3 text-right text-[0.9375rem] tabular-nums text-ink " +
    "outline-none focus-visible:ring-2 focus-visible:ring-brand-ring",
  "dr-field-suffix": "select-none pr-3 text-[0.8125rem] font-medium text-ink-muted",

  // ── Badges / chips ────────────────────────────────────────────────────────
  "dr-badge":
    "inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-ink-secondary",
  "dr-badge-brand":
    "inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand-text",

  // ── Links ─────────────────────────────────────────────────────────────────
  "dr-link":
    "rounded-sm font-medium text-brand-text underline decoration-1 underline-offset-2 " +
    "transition-[text-decoration-color] hover:decoration-2 " +
    "outline-none focus-visible:ring-2 focus-visible:ring-brand-ring",

  // ── Timeline: the writing-activity stratum + playhead nib ─────────────────
  // The track is a soft channel; the fill is a solid brand ramp that deepens to
  // the playhead. The playhead reads as a writing nib (a standing stroke), the
  // same gesture as the document's `doc-caret`, so page and transport rhyme.
  "tl-track":
    "relative h-2.5 w-full rounded-full bg-sunken shadow-[inset_0_1px_2px_var(--dr-inset-shadow)] " +
    "outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2 " +
    "focus-visible:ring-offset-canvas transition-shadow",
  "tl-fill": "absolute inset-y-0 left-0 rounded-full bg-brand transition-[width]",
  "tl-thumb":
    "absolute top-1/2 h-[1.4rem] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand " +
    "shadow-[0_1px_4px_var(--dr-brand-shadow)] ring-2 ring-surface transition-[left]",
  // Event markers read as friendly seals standing on the stratum: a small tile
  // carrying a per-kind glyph (non-color affordance) in a per-kind ink + ring.
  "tl-marker":
    "absolute top-1/2 grid size-[1.1rem] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full " +
    "bg-surface text-[12px] leading-none ring-1 cursor-pointer transition-transform duration-150 " +
    "ease-[var(--dr-ease-out)] hover:scale-110 shadow-[var(--dr-shadow-sm)] " +
    "outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-1 " +
    "focus-visible:ring-offset-canvas",
  "tl-marker-session": "ring-brand text-brand-text",
  "tl-marker-large": "ring-strike text-strike",
  "tl-marker-pause": "ring-hairline-strong text-ink-muted",

  // A stacked seal: collided marks fuse into one slightly larger tile carrying the
  // COUNT in tabular figures, with two faint paper silhouettes behind it (the
  // layered shadow) — a non-color "many" affordance that survives grayscale.
  "tl-cluster":
    "absolute top-1/2 grid size-[1.25rem] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full " +
    "bg-surface font-mono text-[10px] font-semibold leading-none tabular-nums ring-1 " +
    "cursor-pointer transition-transform duration-150 ease-[var(--dr-ease-out)] hover:scale-110 " +
    "shadow-[1.5px_1.5px_0_-0.5px_var(--dr-seal-1),-1.5px_-1.5px_0_-0.5px_var(--dr-seal-2),var(--dr-shadow-sm)] " +
    "outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-1 " +
    "focus-visible:ring-offset-canvas",
  "tl-cluster-mixed": "ring-hairline-strong text-ink-secondary",

  // The hover/focus tooltip: a small paper card lifted above the hovered seal.
  "tl-tip":
    "pointer-events-none absolute bottom-[calc(100%+0.6rem)] z-[60] flex w-max max-w-[17rem] flex-col gap-1.5 " +
    "rounded-xl bg-surface px-3 py-2 ring-1 ring-hairline shadow-[var(--dr-shadow-lg)]",
  "tl-tip-title": "text-[13px] font-semibold text-ink",
  "tl-tip-detail": "font-mono text-[11px] tabular-nums text-ink-muted",
  "tl-tip-rev": "font-mono text-[11px] tabular-nums text-brand-text",
  "tl-tip-breakdown": "m-0 flex list-none flex-col gap-1 p-0",
  "tl-tip-row": "flex items-center gap-2 text-xs text-ink-secondary",
  "tl-tip-count": "font-mono text-[11px] font-semibold tabular-nums text-ink",
  "tl-tip-hint": "mt-0.5 border-t border-hairline pt-1 text-[10px] font-medium text-ink-muted",
  // A small static seal reused inside tip-rows and the legend (the marker stamp
  // without the absolute positioning). The kind tone supplies its ink + ring.
  "tl-chip":
    "inline-grid size-[1rem] shrink-0 place-items-center rounded-full bg-surface text-[11px] " +
    "leading-none ring-1 shadow-[var(--dr-shadow-sm)]",

  // The pinned detail panel: clicking a stacked seal lifts this interactive card.
  "tl-panel":
    "absolute bottom-[calc(100%+0.6rem)] z-[60] flex max-h-[15rem] w-[17rem] flex-col overflow-hidden " +
    "rounded-2xl bg-surface ring-1 ring-hairline shadow-[var(--dr-shadow-lg)]",
  "tl-panel-head": "flex items-start justify-between gap-3 border-b border-hairline px-3 py-2.5",
  "tl-panel-heading": "flex flex-col gap-0.5",
  "tl-panel-title": "tl-tip-title",
  "tl-panel-rev": "tl-tip-rev",
  "tl-panel-close":
    "grid size-7 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors " +
    "hover:bg-hover hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-ring",
  "tl-panel-list": "m-0 flex list-none flex-col gap-0.5 overflow-y-auto p-1.5",
  "tl-panel-row":
    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 py-2 text-left " +
    "transition-colors hover:bg-hover outline-none focus-visible:ring-2 focus-visible:ring-brand-ring " +
    "focus-visible:ring-inset",
  "tl-panel-row-main": "flex min-w-0 flex-1 flex-col gap-0.5",
  "tl-panel-row-kind": "text-xs font-medium text-ink",
  "tl-panel-row-detail": "truncate font-mono text-[11px] tabular-nums text-ink-muted",
  "tl-panel-row-rev": "shrink-0 font-mono text-[11px] tabular-nums text-brand-text",

  // The legend: a quiet wrapped row naming each seal in view (always shown so the
  // vocabulary is learnable up front, never hidden behind a hover).
  "tl-legend": "m-0 flex flex-wrap items-center gap-x-4 gap-y-1.5 p-0",
  "tl-legend-item": "inline-flex items-center gap-1.5 text-xs text-ink-secondary",
  "tl-seal": "tl-chip",

  // ── Progress (determinate + indeterminate + error) ────────────────────────
  "progress-track": "h-2 w-full overflow-hidden rounded-full bg-sunken",
  "progress-fill": "h-full rounded-full bg-brand transition-[width]",
  // Layout only; the `dr-indeterminate` animation class is applied SEPARATELY on
  // the element (it's a preflight class, not a generatable utility).
  "progress-indeterminate": "h-full w-1/3 rounded-full bg-brand",

  // ── Info / privacy note: a calm, OPEN-by-default reassurance card ──────────
  // Friendly brand-soft surface with an info mark — orientation, not a hazard.
  "banner-card": "flex gap-3 rounded-2xl bg-brand-soft px-4 py-3.5",
  "banner-icon": "mt-0.5 size-5 shrink-0 text-brand-text",
  "banner-title": "text-[0.9375rem] font-semibold text-ink",
  "banner-body": "text-[0.875rem] leading-relaxed text-ink-secondary text-pretty",
  "banner-more":
    "mt-1 inline-flex items-center gap-1 self-start rounded-md text-[0.8125rem] font-medium text-brand-text " +
    "outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-ring",

  // ── Status notes (pending / success / error) — icon-paired, never bare ────
  "note-base": "flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[0.875rem] leading-relaxed",
  "note-info": "note-base bg-brand-soft text-ink",
  "note-success": "note-base bg-success-soft text-ink",
  "note-warning": "note-base bg-[var(--dr-warning-soft)] text-ink",
  "note-icon": "mt-px size-[1.15rem] shrink-0",

  // ── The manuscript leaf: an elevated sheet with a graphite binding margin ──
  // `before:` draws the ruled binding margin — pure decoration, graphite-neutral
  // so it never collides with the strike/suggest hues. This is the one surface
  // where the "manuscript" heritage reads literally.
  "dr-leaf":
    "relative rounded-2xl bg-surface px-6 py-9 sm:px-12 shadow-[var(--dr-shadow-lg)] " +
    "before:pointer-events-none before:absolute before:inset-y-7 before:left-4 before:w-px " +
    "before:bg-hairline-strong sm:before:left-9",

  // ── Document-rendering primitives (color ALWAYS + a non-color affordance) ──
  "doc-column":
    "mx-auto max-w-[68ch] whitespace-pre-wrap break-words font-serif text-[1.0625rem] leading-[1.8] text-ink",
  "doc-accepted": "text-ink",
  // Suggested insert: color + dotted underline + label affordance.
  "doc-suggest":
    "rounded-[3px] bg-suggest-soft px-[1px] text-suggest underline decoration-suggest decoration-dotted underline-offset-2",
  // Marked for deletion: color + line-through + label affordance.
  "doc-strike": "rounded-[3px] bg-strike-soft px-[1px] text-strike line-through decoration-strike",
  // Opaque structures: an inline labeled chip carrying icon + text (never bare).
  "doc-opaque":
    "mx-0.5 inline-flex items-center gap-1 rounded-md bg-sunken px-1.5 py-0.5 align-baseline " +
    "font-sans text-xs text-ink-secondary ring-1 ring-hairline",
  // The writing caret (nib): a thin rounded inline mark trailing the run the
  // current revision wrote, tinted to that author's hue (set inline). Same nib
  // vocabulary as the timeline playhead. Soft-blink + reduced-motion freeze in
  // the preflight (a layout-only utility can't carry keyframes).
  "doc-caret":
    "inline-block h-[1.15em] w-[2px] -mb-[0.18em] mx-[0.5px] rounded-full align-baseline " +
    "shadow-[0_1px_2px_var(--dr-caret-shadow)]",

  // ── Insights: contributor chips + stat tiles + hover/click detail card ────
  // Clean stat tiles (label + big figure) in a simple responsive row — NOT
  // icon-on-card grids. Each distinct contributor is an interactive chip; hover
  // /focus — or a click to pin — lifts a small paper card of content-free details.
  "dr-stat": "flex flex-col gap-0.5",
  "dr-stat-value":
    "[font-family:var(--dr-font-display)] text-[1.625rem] font-semibold leading-none tabular-nums text-ink",
  "dr-stat-label": "text-[0.8125rem] text-ink-muted",
  "author-chip":
    "inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[0.8125rem] text-ink-secondary " +
    "ring-1 ring-hairline transition-colors cursor-pointer hover:bg-hover hover:text-ink " +
    "outline-none focus-visible:ring-2 focus-visible:ring-brand-ring",
  // The collaborator's Google-assigned colour, as a small ringed dot (set inline).
  "author-dot": "size-2.5 shrink-0 rounded-full ring-1 ring-[var(--dr-dot-ring)]",
  "author-pop":
    "absolute left-0 bottom-[calc(100%+0.45rem)] z-[60] flex w-max min-w-[12rem] max-w-[18rem] flex-col gap-1.5 " +
    "rounded-2xl bg-surface px-3.5 py-3 text-left ring-1 ring-hairline shadow-[var(--dr-shadow-lg)]",
  "author-pop-name": "flex items-center gap-1.5 text-[13px] font-semibold text-ink",
  "author-pop-row": "flex items-baseline justify-between gap-3",
  "author-pop-key": "text-[11px] font-medium text-ink-muted",
  "author-pop-val": "break-all text-right font-mono text-[11px] tabular-nums text-ink-secondary",
  "author-pop-range":
    "border-t border-hairline pt-1.5 font-mono text-[10px] tabular-nums text-ink-muted",
};

export default defineConfig({
  // `dark: "class"` pins class-based dark mode (the `.dark` toggle — not the OS
  // media query — is the single source of truth, driven by the Seam-E applier).
  presets: [presetWind4({ reset: true, dark: "class" })],

  // Deterministic CSS variable ordering — see sortUnoVarBlocks above.
  transformers: [sortUnoVarBlocks],

  theme: {
    // Fonts: presetWind4's DEFAULT `--font-sans` / `--font-serif` / `--font-mono`
    // are already the friendly humanist system stacks we want (system-ui-led sans,
    // Georgia serif, ui-monospace) — zero external font fetch, honoring the
    // local-first / no-network promise — so we keep them. The one custom face is a
    // rounded DISPLAY stack (`--dr-font-display`, defined in the preflight and used
    // via `[font-family:var(--dr-font-display)]`), which gives a warm rounded
    // headline on Apple devices and a graceful humanist fallback elsewhere.

    // Colors map to semantic CSS variables flipped under `.dark` (preflight
    // below). DESIGN.md carries the human-readable table + the AA verification.
    colors: {
      canvas: "var(--dr-canvas)",
      surface: "var(--dr-surface)",
      sunken: "var(--dr-sunken)",
      hover: "var(--dr-hover)",
      hairline: "var(--dr-hairline)",
      "hairline-strong": "var(--dr-hairline-strong)",
      ink: {
        DEFAULT: "var(--dr-ink)",
        secondary: "var(--dr-ink-secondary)",
        muted: "var(--dr-ink-muted)",
        faint: "var(--dr-ink-faint)",
      },
      brand: {
        DEFAULT: "var(--dr-brand)",
        hover: "var(--dr-brand-hover)",
        text: "var(--dr-brand-text)",
        soft: "var(--dr-brand-soft)",
        ring: "var(--dr-brand-ring)",
        on: "var(--dr-on-brand)",
      },
      accent: {
        DEFAULT: "var(--dr-accent)",
        strong: "var(--dr-accent-strong)",
        soft: "var(--dr-accent-soft)",
      },
      // Functional document-state colors (preserved; each pairs with an affordance).
      suggest: { DEFAULT: "var(--dr-suggest)", soft: "var(--dr-suggest-soft)" },
      strike: { DEFAULT: "var(--dr-strike)", soft: "var(--dr-strike-soft)" },
      // UI status.
      success: { DEFAULT: "var(--dr-success)", soft: "var(--dr-success-soft)" },
      danger: { DEFAULT: "var(--dr-danger)", soft: "var(--dr-danger-soft)" },
      warning: "var(--dr-warning)",
    },
  },

  // Shortcuts live in a module const (above) so `safelist` can list them all.
  shortcuts,
  // WHY safelist: @wxt-dev/unocss has every HTML entrypoint import the SAME
  // `virtual:uno.css`, which Vite dedups to ONE shared CSS chunk. Shortcut
  // GENERATION then keys off whichever entry is scanned first, so shortcuts used
  // only by replay-page components were silently dropped from the shipped chunk
  // and rendered UNSTYLED. Safelisting every shortcut forces all of them into the
  // shared chunk no matter the entry order; insertion order is stable, so the
  // determinism contract holds.
  //
  // The trailing bare utilities hit the SAME shared-chunk hazard when no scanned
  // entry emits them standalone: `relative` (the positioning context the insights
  // hover card anchors to), `sr-only` (off-screen labels for non-accepted runs and
  // a legend), and `hidden` (the collapsed half of the privacy "more" disclosure).
  safelist: [...Object.keys(shortcuts), "relative", "sr-only", "hidden"],

  preflights: [
    {
      getCSS: () => `
/* ── Semantic design tokens (light) ──────────────────────────────────────────
   The single source of truth for color. Components reference these via Uno's
   theme colors (bg-canvas, text-ink, …); dark mode flips the values below. All
   pairs are WCAG-AA verified (see DESIGN.md). \`color-scheme\` drives native
   controls/scrollbars to match.

   Scoped to \`:root, :host\` (mirroring presetWind4's own theme block) so the
   variables resolve in BOTH the full pages (\`:root\` = <html>) AND the content-
   script SHADOW ROOTS (\`:host\` = the shadow host), where \`:root\` matches nothing.
   Without \`:host\`, the in-page "Replay revisions" affordance would render with
   unresolved \`var(--dr-*)\` colors. \`:root\` in a shadow sheet matches nothing, so
   this never leaks color-scheme onto the Google Docs page. */
:root,
:host {
  color-scheme: light;

  /* The one custom face: a rounded DISPLAY stack (warm rounded headline on Apple,
     graceful humanist fallback elsewhere). No .dark override — fonts don't theme.
     System-only: no external font fetch (honors the local-first promise). */
  --dr-font-display: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;

  --dr-canvas: oklch(0.975 0.004 75);
  --dr-surface: oklch(0.995 0.0015 75);
  --dr-sunken: oklch(0.955 0.005 75);
  --dr-hover: oklch(0.945 0.005 75);
  --dr-hairline: oklch(0.905 0.005 75);
  --dr-hairline-strong: oklch(0.845 0.006 75);

  --dr-ink: oklch(0.27 0.02 264);
  --dr-ink-secondary: oklch(0.42 0.018 264);
  --dr-ink-muted: oklch(0.50 0.015 264);
  --dr-ink-faint: oklch(0.60 0.012 264);

  --dr-brand: oklch(0.52 0.16 264);
  --dr-brand-hover: oklch(0.46 0.16 264);
  --dr-brand-text: oklch(0.47 0.16 264);
  --dr-brand-soft: oklch(0.95 0.025 264);
  --dr-brand-ring: oklch(0.62 0.14 264);
  --dr-on-brand: oklch(0.99 0 0);

  --dr-accent: oklch(0.80 0.13 80);
  --dr-accent-strong: oklch(0.53 0.12 65);
  --dr-accent-soft: oklch(0.95 0.04 80);

  --dr-suggest: oklch(0.49 0.12 165);
  --dr-suggest-soft: oklch(0.95 0.03 165);
  --dr-strike: oklch(0.51 0.17 35);
  --dr-strike-soft: oklch(0.95 0.03 35);

  --dr-success: oklch(0.50 0.13 155);
  --dr-success-soft: oklch(0.95 0.03 155);
  --dr-danger: oklch(0.50 0.18 25);
  --dr-danger-soft: oklch(0.95 0.03 25);
  --dr-danger-line: oklch(0.50 0.18 25 / 0.35);
  --dr-warning: oklch(0.62 0.13 70);
  --dr-warning-soft: oklch(0.95 0.04 75);

  /* The always-light brand-mark tile (no .dark override → stable in both themes). */
  --dr-chip: oklch(0.97 0.003 75);

  /* Elevation — soft, layered, low-opacity (Apple register). Never paired with a
     wide border on the same element (the ghost-card tell). */
  --dr-shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.05);
  --dr-shadow-md: 0 2px 8px -2px oklch(0% 0 0 / 0.08), 0 6px 16px -8px oklch(0% 0 0 / 0.06);
  --dr-shadow-lg: 0 12px 32px -12px oklch(0% 0 0 / 0.16);
  --dr-inset-shadow: oklch(0% 0 0 / 0.07);
  --dr-brand-shadow: oklch(0.52 0.13 264 / 0.45);
  --dr-caret-shadow: oklch(0% 0 0 / 0.28);
  --dr-seal-1: oklch(0.89 0.004 75);
  --dr-seal-2: oklch(0.94 0.003 75);
  --dr-dot-ring: oklch(0% 0 0 / 0.12);

  /* Motion easing (no bounce/elastic). */
  --dr-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --dr-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}

/* ── Semantic design tokens (dark) — a warm charcoal, not a cold gray ─────────
   Comes AFTER :root so equal-specificity rules resolve to dark when .dark is set
   on <html>. Markup colors flip to a LIGHT ink on a dark tint so they stay AA. */
.dark,
:host(.dark) {
  color-scheme: dark;

  --dr-canvas: oklch(0.205 0.006 75);
  --dr-surface: oklch(0.255 0.007 75);
  --dr-sunken: oklch(0.175 0.006 75);
  --dr-hover: oklch(0.31 0.008 75);
  --dr-hairline: oklch(0.33 0.008 75);
  --dr-hairline-strong: oklch(0.40 0.009 75);

  --dr-ink: oklch(0.955 0.004 75);
  --dr-ink-secondary: oklch(0.82 0.006 75);
  --dr-ink-muted: oklch(0.70 0.006 75);
  --dr-ink-faint: oklch(0.58 0.006 75);

  --dr-brand: oklch(0.52 0.16 264);
  --dr-brand-hover: oklch(0.58 0.16 264);
  --dr-brand-text: oklch(0.74 0.13 264);
  --dr-brand-soft: oklch(0.30 0.06 264);
  --dr-brand-ring: oklch(0.70 0.12 264);
  --dr-on-brand: oklch(0.99 0 0);

  --dr-accent: oklch(0.82 0.12 80);
  --dr-accent-strong: oklch(0.84 0.11 80);
  --dr-accent-soft: oklch(0.32 0.06 70);

  --dr-suggest: oklch(0.88 0.08 165);
  --dr-suggest-soft: oklch(0.34 0.05 165);
  --dr-strike: oklch(0.84 0.10 35);
  --dr-strike-soft: oklch(0.36 0.07 35);

  --dr-success: oklch(0.80 0.12 155);
  --dr-success-soft: oklch(0.32 0.05 155);
  --dr-danger: oklch(0.82 0.13 28);
  --dr-danger-soft: oklch(0.34 0.07 25);
  --dr-danger-line: oklch(0.82 0.13 28 / 0.40);
  --dr-warning: oklch(0.82 0.12 80);
  --dr-warning-soft: oklch(0.33 0.05 75);

  --dr-shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.4);
  --dr-shadow-md: 0 2px 8px -2px oklch(0% 0 0 / 0.5), 0 6px 16px -8px oklch(0% 0 0 / 0.4);
  --dr-shadow-lg: 0 12px 32px -12px oklch(0% 0 0 / 0.6);
  --dr-inset-shadow: oklch(0% 0 0 / 0.25);
  --dr-brand-shadow: oklch(0.55 0.15 264 / 0.5);
  --dr-caret-shadow: oklch(0% 0 0 / 0.5);
  --dr-seal-1: oklch(0.33 0.006 75);
  --dr-seal-2: oklch(0.29 0.006 75);
  --dr-dot-ring: oklch(100% 0 0 / 0.2);
}

/* A friendly, on-brand text selection. */
::selection { background: var(--dr-brand-soft); }

/* ── Reduced motion ──────────────────────────────────────────────────────────
   Every transition/animation degrades to a crossfade or instant state. */
@media (prefers-reduced-motion: reduce) {
  .tl-fill, .tl-thumb, .tl-track, .tl-marker, .tl-cluster, .progress-fill, .btn-base,
  .seg-item, .dr-switch, .dr-switch-knob { transition: none !important; }
  .doc-suggest::after, .doc-strike::after { transition: none !important; }
  /* Freeze the writing caret to a steady mark — still present and colour-coded. */
  .doc-caret { animation: none !important; opacity: 1 !important; }
  /* Don't freeze the indeterminate bar (a static pill reads as stalled). Pulse the
     FULL track instead so "still working" stays clear without travelling motion. */
  .dr-indeterminate {
    width: 100% !important;
    transform: none !important;
    animation: dr-indeterminate-pulse 1.5s ease-in-out infinite !important;
  }
}

/* "Discovering" is honestly indeterminate — the revision upper bound isn't known
   yet. A continuous sweep communicates liveness without faking determinate
   progress; the determinate fill takes over once checkpoints start landing. */
@keyframes dr-indeterminate-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
@keyframes dr-indeterminate-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
.dr-indeterminate { animation: dr-indeterminate-slide 1.1s linear infinite; }

/* The writing caret's soft blink — a living "now-writing" pulse rather than a hard
   on/off, so it reads as a nib resting on the page. Frozen under reduced-motion. */
@keyframes dr-caret-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}
.doc-caret { animation: dr-caret-blink 1.1s ease-in-out infinite; }

/* Reading-column affordance tooltips (suggested insertion / marked for deletion).
   Moved off the OS-timed \`title\` attribute onto a :hover pseudo-element that
   paints the moment the pointer enters and re-resolves on scroll-under-cursor, at
   zero JS cost. The text rides \`data-doc-tip\` (i18n stays single-source); the
   inline \`sr-only\` span keeps the same text for assistive tech. */
.doc-suggest, .doc-strike { position: relative; }
.doc-suggest::after, .doc-strike::after {
  content: attr(data-doc-tip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 0.4rem);
  transform: translateX(-50%);
  z-index: 60;
  width: max-content;
  max-width: 16rem;
  pointer-events: none;
  border-radius: 0.625rem;
  background: var(--dr-surface);
  box-shadow: var(--dr-shadow-lg), 0 0 0 1px var(--dr-hairline);
  padding: 0.1875rem 0.5rem;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--dr-ink-secondary);
  opacity: 0;
  transition: opacity 100ms ease-out;
}
.doc-suggest:hover::after, .doc-strike:hover::after { opacity: 1; }
`,
    },
  ],
});
