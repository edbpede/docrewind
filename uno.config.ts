// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DocRewind design system (plan Phase 5 Step 1 / PRD §11.3). presetWind4 ONLY
// (oklch, Tailwind-4 compatible) — no tailwind.config, no PostCSS, no
// @unocss/reset. The visual identity is "the manuscript and its margin": a calm,
// archival scrubbable-manuscript surface. Cool paper (not the warm-cream
// default), inky blue-black text, a revision-indigo "now" accent, and three
// reconstruction states that ALWAYS pair color with a non-color affordance
// (suggestion = underline, deletion = strike, opaque = labeled chip) so meaning
// is never carried by color alone (§9.11).
//
// Dark mode is pinned EXPLICITLY to the class strategy (`.dark` on <html>) so the
// Seam-E applier (lib/theme.ts + the page mounts) drives every `dark:` utility.
// Motion suppression is declarative: a `prefers-reduced-motion` preflight
// neutralizes timeline/scrubber/progress transitions at the CSS layer, and the
// App separately caps the JS auto-advance cadence.

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

// The design-system shortcuts, hoisted to a module const so `safelist` below can
// be derived from the keys (see the safelist note in defineConfig).
const shortcuts = {
  // ── Surfaces ────────────────────────────────────────────────────────────
  // Cool archival paper. A near-flat stone wash (top a touch lighter than the
  // foot) gives the page the depth of a sheet under raking light without ever
  // reading as a "gradient hero". Solid `bg-stone-50` stays as the fallback.
  "dr-page":
    "min-h-screen bg-stone-50 bg-gradient-to-b from-stone-50 to-stone-100 " +
    "text-stone-900 dark:bg-stone-900 dark:from-stone-900 dark:to-stone-950 dark:text-stone-100",
  "dr-panel": "rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800",
  "dr-card": "dr-panel p-4 shadow-sm",

  // ── Masthead: the archival record header (eyebrow + balanced title) ────────
  "dr-masthead": "flex flex-col gap-2 border-b border-stone-200/80 pb-4 dark:border-stone-700/80",
  "dr-title":
    "text-balance font-serif text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50",

  // ── The manuscript leaf: an elevated sheet with a graphite binding margin ──
  // `before:` draws the ruled binding margin — pure decoration (no meaning rides
  // on it), graphite-neutral so it never collides with the strike/suggest hues.
  "dr-leaf":
    "relative rounded-xl bg-white px-6 py-9 ring-1 ring-stone-200 sm:px-12 " +
    "shadow-[0_18px_40px_-24px_oklch(0%_0_0/0.22)] " +
    "before:pointer-events-none before:absolute before:inset-y-6 before:left-4 before:w-px " +
    "before:bg-stone-300/70 sm:before:left-9 dark:bg-stone-800 dark:ring-stone-700 " +
    "dark:before:bg-stone-600/50",
  // A dateline reads like the hand-noted date in a manuscript margin.
  // Same visual treatment as the masthead eyebrow — aliased to one source.
  "dr-dateline": "dr-eyebrow",

  // ── Buttons (focus-visible rings; never color-only — each carries a label) ─
  "btn-base":
    "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium " +
    "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-revision-ring " +
    "focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 " +
    "dark:focus-visible:ring-offset-stone-900 disabled:opacity-50 disabled:cursor-not-allowed",
  "btn-primary": "btn-base bg-revision text-white hover:bg-revision-soft",
  "btn-secondary":
    "btn-base border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 " +
    "dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700",
  "btn-ghost":
    "btn-base bg-transparent text-stone-700 hover:bg-stone-200/70 " +
    "dark:text-stone-200 dark:hover:bg-stone-700/70",
  // Pressed/active toggle state for play/pause + speed (paired with text/icon).
  "btn-active": "bg-revision text-white hover:bg-revision-soft",

  // ── Timeline: the signature "writing-activity stratum" + playhead caret ───
  // The track is a carved channel (inset shadow); the fill is accumulating ink
  // — an oklch ramp from faded early writing to saturated fresh indigo at the
  // playhead, interpolated `in oklch` so the ramp stays perceptually even.
  "tl-track":
    "group relative h-2.5 w-full rounded-full bg-stone-200 dark:bg-stone-700 " +
    "shadow-[inset_0_1px_2px_oklch(0%_0_0/0.07)] dark:shadow-[inset_0_1px_2px_oklch(0%_0_0/0.25)] " +
    "outline-none focus-visible:ring-2 focus-visible:ring-revision-ring " +
    "focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 " +
    "dark:focus-visible:ring-offset-stone-900 transition-shadow",
  "tl-fill":
    "absolute inset-y-0 left-0 rounded-full transition-[width] " +
    "bg-gradient-to-r from-revision-ring via-revision-soft to-revision",
  // The playhead reads as a writing caret (nib) standing on the track.
  "tl-thumb":
    "absolute top-1/2 h-6 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-revision " +
    "shadow-[0_1px_3px_oklch(54%_0.13_264/0.45)] ring-2 ring-white dark:ring-stone-900 transition-[left]",
  // Event markers read as marginalia seals pressed onto the writing stratum: a
  // small paper-faced stamp standing proud of the track, carrying a per-kind
  // editorial pen-mark (§ caret-up caret-down caesura) in a per-kind ink. Color
  // is ALWAYS paired with both the glyph and the seal ring, so the kind survives
  // grayscale (§9.11). A keyboard focus ring makes each a jump-to-event button.
  "tl-marker":
    "absolute top-1/2 grid size-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full " +
    "border bg-white text-[12px] leading-none cursor-pointer transition-transform hover:scale-110 " +
    "shadow-[0_1px_2px_oklch(0%_0_0/0.18)] dark:bg-stone-800 " +
    "outline-none focus-visible:ring-2 focus-visible:ring-revision-ring focus-visible:ring-offset-1 " +
    "focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-900",
  "tl-marker-session": "border-revision text-revision",
  "tl-marker-large": "border-strike text-strike",
  "tl-marker-pause": "border-stone-300 text-stone-500 dark:border-stone-600 dark:text-stone-400",

  // A stacked seal: where individual marks would collide into an unreadable pile,
  // they fuse into one slightly-larger paper seal carrying the COUNT in tabular
  // figures. Two faint offset paper silhouettes behind it (the layered box-shadow)
  // read as several seals pressed together — a non-color "many" affordance that
  // survives grayscale (§9.11) and turns a dense burst into legible signal. The
  // count is the glyph; the kind breakdown rides the hover/focus tooltip + aria.
  "tl-cluster":
    "absolute top-1/2 grid size-[18px] -translate-x-1/2 -translate-y-1/2 place-items-center " +
    "rounded-full border bg-white font-mono text-[10px] font-semibold leading-none tabular-nums " +
    "cursor-pointer transition-transform hover:scale-110 dark:bg-stone-800 " +
    "shadow-[1.5px_1.5px_0_-0.5px_oklch(89%_0_0),-1.5px_-1.5px_0_-0.5px_oklch(94%_0_0),0_1px_3px_oklch(0%_0_0/0.22)] " +
    "dark:shadow-[1.5px_1.5px_0_-0.5px_oklch(33%_0_0),-1.5px_-1.5px_0_-0.5px_oklch(29%_0_0),0_1px_3px_oklch(0%_0_0/0.4)] " +
    "outline-none focus-visible:ring-2 focus-visible:ring-revision-ring focus-visible:ring-offset-1 " +
    "focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-900",
  // Mixed-kind clusters drop to graphite ink (no single kind owns the seal); the
  // breakdown in the tooltip carries which kinds, so color is never the sole tell.
  "tl-cluster-mixed": "border-stone-400 text-stone-700 dark:border-stone-500 dark:text-stone-200",

  // The hover/focus tooltip: a small paper card lifted above the hovered seal,
  // carrying the mark's name, its content-free revision data, and the frame it
  // jumps to. `pointer-events-none` so it never intercepts a scrub; positioned by
  // the leaf via inline `left`/`transform` (edge-clamped near the track ends). A
  // stacked seal trades the old cramped `·`-run for a ledger: one chip-row per
  // kind, so nothing wraps mid-phrase, plus a hint that a click opens the full list.
  "tl-tip":
    "pointer-events-none absolute bottom-[calc(100%+0.6rem)] z-20 flex w-max max-w-[17rem] flex-col gap-1.5 " +
    "rounded-lg border border-stone-200 bg-white px-3 py-2 " +
    "shadow-[0_10px_30px_-12px_oklch(0%_0_0/0.4)] dark:border-stone-700 dark:bg-stone-800",
  "tl-tip-title": "font-sans text-[13px] font-semibold text-stone-800 dark:text-stone-100",
  "tl-tip-detail": "font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400",
  "tl-tip-rev": "font-mono text-[11px] tabular-nums text-revision dark:text-revision-ring",
  // The stacked-seal breakdown: a quiet ledger of kind-rows (chip · count · name).
  "tl-tip-breakdown": "m-0 flex list-none flex-col gap-1 p-0",
  "tl-tip-row": "flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300",
  "tl-tip-count":
    "font-mono text-[11px] font-semibold tabular-nums text-stone-800 dark:text-stone-100",
  "tl-tip-hint":
    "mt-0.5 border-t border-stone-200/70 pt-1 font-sans text-[10px] uppercase tracking-wide " +
    "text-stone-400 dark:border-stone-700 dark:text-stone-500",
  // A small static seal reused inside tip-rows and panel-rows (the marker stamp
  // without the track positioning). The kind tone supplies its border + ink.
  "tl-chip":
    "inline-grid size-[15px] shrink-0 place-items-center rounded-full border bg-white text-[11px] " +
    "leading-none shadow-[0_1px_1px_oklch(0%_0_0/0.12)] dark:bg-stone-800",

  // The pinned detail panel: clicking a stacked seal lifts this interactive card —
  // a manuscript ledger of every mark in the burst, each row a jump-to-frame button.
  // Unlike the hover peek it accepts the pointer (no `pointer-events-none`), caps its
  // height and scrolls, and is dismissed by Escape / an outside click / its close mark.
  "tl-panel":
    "absolute bottom-[calc(100%+0.6rem)] z-30 flex max-h-[15rem] w-[17rem] flex-col overflow-hidden " +
    "rounded-lg border border-stone-200 bg-white " +
    "shadow-[0_18px_48px_-16px_oklch(0%_0_0/0.5)] dark:border-stone-700 dark:bg-stone-800",
  "tl-panel-head":
    "flex items-start justify-between gap-3 border-b border-stone-200/80 px-3 py-2 dark:border-stone-700",
  "tl-panel-heading": "flex flex-col gap-0.5",
  // Same treatment as the hover tip's title/rev — aliased to one source.
  "tl-panel-title": "tl-tip-title",
  "tl-panel-rev": "tl-tip-rev",
  "tl-panel-close":
    "grid size-6 shrink-0 place-items-center rounded-md text-lg leading-none text-stone-400 " +
    "transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-100 " +
    "outline-none focus-visible:ring-2 focus-visible:ring-revision-ring",
  "tl-panel-list": "m-0 flex list-none flex-col gap-0.5 overflow-y-auto p-1.5",
  "tl-panel-row":
    "flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left " +
    "transition-colors hover:bg-stone-100 dark:hover:bg-stone-700/70 " +
    "outline-none focus-visible:ring-2 focus-visible:ring-revision-ring focus-visible:ring-inset",
  "tl-panel-row-main": "flex min-w-0 flex-1 flex-col gap-0.5",
  "tl-panel-row-kind": "font-sans text-xs font-medium text-stone-700 dark:text-stone-200",
  "tl-panel-row-detail":
    "truncate font-mono text-[11px] tabular-nums text-stone-500 dark:text-stone-400",
  "tl-panel-row-rev":
    "shrink-0 font-mono text-[11px] tabular-nums text-revision dark:text-revision-ring",

  // The marginalia key: a quiet wrapped row naming each seal-mark in view. A
  // static `tl-seal` mirrors the marker's stamp (sans the absolute positioning
  // and hover lift) so the legend and the stratum read as one vocabulary.
  "tl-legend": "m-0 flex flex-wrap items-center gap-x-4 gap-y-1.5 p-0",
  "tl-legend-item": "inline-flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-300",
  "tl-seal":
    "inline-grid size-4 place-items-center rounded-full border bg-white text-[12px] leading-none " +
    "shadow-[0_1px_2px_oklch(0%_0_0/0.18)] dark:bg-stone-800",

  // ── Progress (determinate + indeterminate + error) ────────────────────────
  "progress-track": "h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700",
  "progress-fill": "h-full rounded-full bg-revision transition-[width]",
  "progress-indeterminate": "h-full w-1/3 rounded-full bg-revision dr-indeterminate",

  // ── PrivacyBanner / reconstruction-warning surface ────────────────────────
  "banner-warning":
    "flex items-start gap-2 rounded-md border-l-4 border-caution bg-caution-soft " +
    "px-3 py-2 text-sm text-stone-800 dark:bg-caution-softDark dark:text-stone-100",

  // ── Document-rendering primitives (color ALWAYS + a non-color affordance) ──
  "doc-column":
    "mx-auto max-w-[68ch] whitespace-pre-wrap break-words font-serif text-[1.0625rem] leading-[1.8] " +
    "text-stone-900 dark:text-stone-100",
  "doc-accepted": "text-stone-900 dark:text-stone-100",
  // Suggested insert: color + underline + label affordance.
  "doc-suggest":
    "rounded-sm bg-suggest-soft text-suggest underline decoration-suggest decoration-dotted " +
    "underline-offset-2 dark:bg-suggest-softDark dark:text-suggest",
  // Marked for deletion: color + line-through + label affordance.
  "doc-strike":
    "rounded-sm bg-strike-soft text-strike line-through decoration-strike " +
    "dark:bg-strike-softDark dark:text-strike",
  // Opaque structures: an inline labeled chip carrying icon + text (never bare).
  "doc-opaque":
    "mx-0.5 inline-flex items-center gap-1 rounded border border-stone-300 bg-stone-100 " +
    "px-1.5 py-0.5 align-baseline font-sans text-xs text-stone-600 " +
    "dark:border-stone-600 dark:bg-stone-700 dark:text-stone-300",

  // ── Data / chrome typography helpers ──────────────────────────────────────
  "dr-counter": "font-mono text-sm tabular-nums text-stone-600 dark:text-stone-400",
  "dr-eyebrow":
    "font-mono text-[11px] uppercase tracking-[0.16em] text-stone-500 dark:text-stone-400",
};

export default defineConfig({
  // `dark: "class"` pins class-based dark mode (Wind4's default, pinned so the
  // `.dark` toggle — not the OS media query — is the single source of truth).
  presets: [presetWind4({ reset: true, dark: "class" })],

  // Deterministic CSS variable ordering — see sortUnoVarBlocks above.
  transformers: [sortUnoVarBlocks],

  theme: {
    colors: {
      // Revision-indigo: the "now"/playhead accent and primary action color.
      revision: {
        DEFAULT: "oklch(54% 0.13 264)",
        soft: "oklch(62% 0.11 264)",
        ring: "oklch(70% 0.10 264)",
      },
      // Suggested-insert (paired with an underline + label, never color-only).
      suggest: {
        DEFAULT: "oklch(52% 0.12 165)",
        soft: "oklch(95% 0.03 165)",
        softDark: "oklch(38% 0.06 165)",
      },
      // Marked-for-deletion (paired with a strike + label).
      strike: {
        DEFAULT: "oklch(55% 0.16 35)",
        soft: "oklch(95% 0.03 35)",
        softDark: "oklch(40% 0.08 35)",
      },
      // Reconstruction/warning surface (the persistent PrivacyBanner).
      caution: {
        DEFAULT: "oklch(58% 0.12 75)",
        soft: "oklch(96% 0.04 80)",
        softDark: "oklch(36% 0.06 75)",
      },
    },
  },

  // Shortcuts live in a module const (above) so `safelist` can list them all.
  shortcuts,
  // WHY safelist: @wxt-dev/unocss has every HTML entrypoint import the SAME
  // `virtual:uno.css`, which Vite dedups to ONE shared CSS chunk (the build's
  // "imported multiple times … using the first occurrence" warning). Shortcut
  // GENERATION then keys off whichever entry is scanned first, so shortcuts used
  // only by replay-page components (the timeline channel, the leaf, progress, the
  // banner) were silently dropped from the shipped chunk and rendered UNSTYLED.
  // Safelisting every shortcut forces all of them into the shared chunk no matter
  // the entry order; insertion order is stable, so the determinism contract holds.
  safelist: Object.keys(shortcuts),

  preflights: [
    {
      // Declarative motion suppression: the timeline/scrubber/progress transitions
      // above are neutralized under `prefers-reduced-motion: reduce`, so motion is
      // build-visible and verifiable rather than hidden in component logic. The App
      // additionally caps the JS auto-advance cadence (Step 6).
      getCSS: () => `
/* Drive the native UA color-scheme from the SAME pinned \`.dark\` class that the
   Seam-E applier toggles on <html>. Without this the document stays at the
   default \`light\` scheme, so native form controls (<select>, number inputs,
   checkboxes) and scrollbars render with light-mode chrome — dark glyphs — even
   under \`.dark\`, where surfaces like \`dr-panel\` only flip the background. That
   produces dark-on-dark, near-unreadable controls on the otherwise-dark Options
   page. Setting color-scheme makes every native control follow the theme. */
:root { color-scheme: light; }
.dark { color-scheme: dark; }

@media (prefers-reduced-motion: reduce) {
  .tl-fill, .tl-thumb, .tl-track, .tl-marker, .tl-cluster, .progress-fill, .btn-base { transition: none !important; }
  .dr-indeterminate { animation: none !important; }
}
@keyframes dr-indeterminate-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
.dr-indeterminate { animation: dr-indeterminate-slide 1.2s ease-in-out infinite; }
`,
    },
  ],
});
