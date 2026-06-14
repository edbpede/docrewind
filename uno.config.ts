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

// Build-determinism transformer (Phase 7 / docs/RELEASE.md).
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

  shortcuts: {
    // ── Surfaces ────────────────────────────────────────────────────────────
    "dr-page": "min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-900 dark:text-stone-100",
    "dr-panel":
      "rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800",
    "dr-card": "dr-panel p-4 shadow-sm",

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
    "tl-track":
      "relative h-2 w-full rounded-full bg-stone-200 dark:bg-stone-700 " +
      "outline-none focus-visible:ring-2 focus-visible:ring-revision-ring " +
      "focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 " +
      "dark:focus-visible:ring-offset-stone-900 transition-shadow",
    "tl-fill": "absolute inset-y-0 left-0 rounded-full bg-revision-soft transition-[width]",
    // The playhead reads as a writing caret standing on the track.
    "tl-thumb":
      "absolute top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-revision " +
      "shadow ring-2 ring-white dark:ring-stone-900 transition-[left]",
    // Event markers — each kind also gets a distinct glyph in the component.
    "tl-marker": "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] leading-none",
    "tl-marker-session": "text-revision",
    "tl-marker-large": "text-strike",
    "tl-marker-pause": "text-stone-500 dark:text-stone-400",

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
      "mx-auto max-w-[70ch] whitespace-pre-wrap break-words font-serif text-base leading-relaxed " +
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
  },

  preflights: [
    {
      // Declarative motion suppression: the timeline/scrubber/progress transitions
      // above are neutralized under `prefers-reduced-motion: reduce`, so motion is
      // build-visible and verifiable rather than hidden in component logic. The App
      // additionally caps the JS auto-advance cadence (Step 6).
      getCSS: () => `
@media (prefers-reduced-motion: reduce) {
  .tl-fill, .tl-thumb, .tl-track, .progress-fill, .btn-base { transition: none !important; }
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
