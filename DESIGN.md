---
name: DocRewind
description: Local-first Google Docs revision-replay — a calm, archival manuscript you can scrub through time.
colors:
  revision-indigo: "oklch(54% 0.13 264)"
  revision-indigo-soft: "oklch(62% 0.11 264)"
  revision-indigo-ring: "oklch(70% 0.10 264)"
  marginal-green: "oklch(52% 0.12 165)"
  marginal-green-soft: "oklch(95% 0.03 165)"
  marginal-green-soft-dark: "oklch(38% 0.06 165)"
  strike-vermilion: "oklch(55% 0.16 35)"
  strike-vermilion-soft: "oklch(95% 0.03 35)"
  strike-vermilion-soft-dark: "oklch(40% 0.08 35)"
  caution-amber: "oklch(58% 0.12 75)"
  cool-paper: "oklch(98.5% 0.001 106)"
  cool-paper-deep: "oklch(97% 0.001 106)"
  leaf-white: "oklch(100% 0 0)"
  graphite-border: "oklch(92.3% 0.003 49)"
  graphite-muted: "oklch(55.3% 0.013 58)"
  graphite-ink: "oklch(21.6% 0.006 56)"
  night-panel: "oklch(26.8% 0.007 34)"
  night-surface: "oklch(21.6% 0.006 56)"
  night-deep: "oklch(14.7% 0.004 49)"
typography:
  title:
    fontFamily: "Literata, ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.3"
    letterSpacing: "-0.025em"
  reading:
    fontFamily: "Literata, ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: "1.8"
    letterSpacing: "normal"
  body:
    fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.5"
    letterSpacing: "normal"
  eyebrow:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: "1.4"
    letterSpacing: "0.16em"
  data:
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: "1.4"
    letterSpacing: "normal"
rounded:
  sm: "0.125rem"
  md: "0.375rem"
  lg: "0.5rem"
  xl: "0.75rem"
  full: "9999px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2.25rem"
components:
  button-primary:
    backgroundColor: "{colors.revision-indigo}"
    textColor: "{colors.leaf-white}"
    rounded: "{rounded.md}"
    padding: "0.375rem 0.75rem"
  button-primary-hover:
    backgroundColor: "{colors.revision-indigo-soft}"
  button-secondary:
    backgroundColor: "{colors.leaf-white}"
    textColor: "{colors.graphite-ink}"
    rounded: "{rounded.md}"
    padding: "0.375rem 0.75rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.graphite-muted}"
    rounded: "{rounded.md}"
    padding: "0.375rem 0.75rem"
  card:
    backgroundColor: "{colors.leaf-white}"
    textColor: "{colors.graphite-ink}"
    rounded: "{rounded.lg}"
    padding: "1rem"
  leaf:
    backgroundColor: "{colors.leaf-white}"
    textColor: "{colors.graphite-ink}"
    rounded: "{rounded.xl}"
    padding: "2.25rem 1.5rem"
---

# Design System: DocRewind

## 1. Overview

**Creative North Star: "The Manuscript and Its Margin"**

DocRewind looks like an archival sheet under raking light, with a working margin
running down its spine. The page is cool, near-neutral paper; the document sits on
an elevated leaf with a ruled binding margin; and the revision timeline reads as
*marginalia* — small paper seals pressed into the margin of the record, each one a
mark you can press to jump through time. The whole system is built outward from that
single image: a historical document you can wind back and forth, read closely, and
trust completely. The playhead is a writing nib, not a scrubber bar. The "now" of any
given frame is carried by one disciplined accent — revision indigo — and nothing else
competes with it.

The personality is **approachable, calm, trustworthy** — an everyday utility, not a
specialist instrument. The archival calm is in service of that approachability: it
keeps the chrome quiet so the document and its evolution stay center stage, and it
reads as careful rather than clever. Density is low and breathing; type does the
heavy lifting; color is rare and meaningful. The tool is meant to disappear into the
reading.

This system explicitly rejects three things. It is **not a surveillance or analytics
dashboard** — there are no KPI tiles, no charts-as-decoration, no telemetry sheen,
because the product is local and content-respecting and must never *look* like a
tracking tool. It is **not flashy consumer SaaS** — no gradient hero banners, no
hero-metric templates, no marketing-page polish bleeding into the product UI. And it
deliberately avoids **the warm-cream AI-default aesthetic** — the cream/sand/beige
near-white that signals generic machine output; DocRewind's paper is *cool*, and that
choice is load-bearing. One more, from the educator use case: it is never an
**accusatory "gotcha" tool** — reconstruction states are shown plainly and never
editorialize.

**Key Characteristics:**
- Cool archival paper (near-neutral stone), not warm cream — and a full first-class dark theme.
- Serif for the document and titles; system sans for UI; mono for data, eyebrows, and revision ids.
- One accent — revision indigo — for "now," primary actions, and focus, never decoration.
- Meaning is never carried by color alone; every state pairs a hue with a glyph, underline, strike, or label.
- The manuscript leaf and floating cards lift; everything else stays tonal and flat.
- Motion conveys state only (writing nib, accumulating ink, progress) and fully degrades under reduced-motion.

## 2. Colors

A disciplined, mostly-neutral palette: cool stone paper and graphite ink across the
whole surface, with three meaning-bearing hues that appear only where they carry
information, and a single indigo that owns "now."

### Primary
- **Revision Indigo** (`oklch(54% 0.13 264)`): The signature. It is "now" — the
  playhead nib, the current-revision writing caret, the accumulating-ink fill at the
  head of the timeline — and it is the primary action color (the only filled button).
  Its softer sibling **Revision Indigo Soft** (`oklch(62% 0.11 264)`) is the primary
  hover and the timeline's mid-ramp; **Revision Indigo Ring** (`oklch(70% 0.10 264)`)
  is every focus-visible ring and the indigo that text drops to on dark surfaces.

### Secondary
- **Marginal Green** (`oklch(52% 0.12 165)`): The *suggested insertion* state — text
  in green, always with a dotted underline and an `sr-only` label. Backgrounds
  **Marginal Green Soft** (`oklch(95% 0.03 165)` light / `oklch(38% 0.06 165)` dark).
- **Strike Vermilion** (`oklch(55% 0.16 35)`): The *marked-for-deletion* state — text
  in vermilion, always struck through and labeled. Backgrounds **Strike Vermilion
  Soft** (`oklch(95% 0.03 35)` light / `oklch(40% 0.08 35)` dark). Also tints the
  large-deletion timeline marker.

### Tertiary
- **Caution Amber** (`oklch(58% 0.12 75)`): A reserved warning accent, paired with an
  icon, never color-only. Used sparingly; not part of the everyday reading vocabulary.

### Neutral
- **Cool Paper** (`oklch(98.5% 0.001 106)` → **Cool Paper Deep** `oklch(97% 0.001 106)`):
  The page. A near-flat top-to-bottom wash (a touch lighter at the head) that gives a
  sheet-under-light depth without ever reading as a gradient hero. Deliberately cool /
  near-neutral, never warm cream.
- **Leaf White** (`oklch(100% 0 0)`): The elevated manuscript leaf, cards, panels, and
  floating tooltips — the surfaces that sit *above* the paper.
- **Graphite Border** (`oklch(92.3% 0.003 49)` / stone-200): hairline borders, dividers,
  the ruled binding margin.
- **Graphite Muted** (`oklch(55.3% 0.013 58)` / stone-500): secondary and label text,
  inactive marks.
- **Graphite Ink** (`oklch(21.6% 0.006 56)` / stone-900): primary body and document text.
- **Night surfaces** (`night-deep oklch(14.7% 0.004 49)`, `night-surface
  oklch(21.6% 0.006 56)`, `night-panel oklch(26.8% 0.007 34)`): the dark-theme paper,
  page foot, and lifted panels. Dark theme is a first-class peer, not an afterthought.

### Named Rules
**The One-Indigo Rule.** Revision indigo means *now* and *primary action* — nothing
else. It is never used to decorate, fill a background, or color a heading. Its scarcity
is what makes the playhead and the active control instantly findable.

**The Cool-Paper Rule.** The page is cool, near-neutral stone. Warming it toward cream,
sand, ivory, or beige is forbidden — that warm-near-white is the generic-AI tell this
system was built to avoid.

**The Never-Color-Alone Rule.** Every meaning-bearing hue (indigo, green, vermilion,
amber) is *always* paired with a non-color affordance — a glyph, underline, strike,
ringed seal, or `sr-only` label — so meaning survives grayscale and color-vision
differences. A color used as the sole signal is a defect.

## 3. Typography

**Document & Title Font:** **Literata** — a literary reading serif, bundled as a local
variable woff2 (upright + italic), over the `ui-serif` system fallback (Georgia, Cambria,
Times New Roman, Times, serif).
**UI Body Font:** **IBM Plex Sans** — a neutral grotesque chosen to recede, bundled as a
local variable woff2, over the `ui-sans-serif` system fallback (system-ui, sans-serif).
**Data / Label Font:** **IBM Plex Mono** — bundled local woff2 (400/500/600), over the
`ui-monospace` system fallback (SF Mono, Menlo, Monaco, Consolas, monospace). Shares the
Plex superfamily's engineered tone with the UI sans.

All three are **self-hosted** (`public/fonts/*.woff2`, served from the extension origin
only — see `assets/fonts.css`); nothing is fetched from a font CDN, so the privacy
invariant holds. Each stack keeps its system fallback, so the content-script affordance —
which never loads the bundled faces — degrades to native fonts with no extra requests.

**Character:** A three-voice system pairing on a genuine contrast axis. The serif gives
the document and its titles the weight and calm of print — this is a *manuscript*, and
it should read like one. The system sans handles all functional UI chrome so it feels
native and invisible. Mono carries every figure that must stay honest and aligned —
revision ids, counts, percentages, datelines — in `tabular-nums` so digits never reflow.

### Hierarchy
- **Title** (serif, 600, 1.25rem, tracking-tight): the masthead / archival-record header.
  `text-wrap: balance` so it never breaks awkwardly.
- **Reading** (serif, 400, 1.0625rem / 17px, line-height 1.8): the document column
  itself — the most important text in the product. Capped at **68ch** for a calm,
  book-like measure.
- **Body** (sans, 400, 0.875rem, line-height ~1.5): UI copy, descriptions, button and
  control labels.
- **Eyebrow / Label** (mono, 400, 0.6875rem / 11px, uppercase, letter-spacing 0.16em):
  the masthead eyebrow, the manuscript dateline, and detail-row keys. A deliberate,
  named brand device — *not* a per-section scaffold.
- **Data** (mono, 600, 0.875rem, tabular-nums): the determinate percentage figure and
  prominent counters; revision ids ride a lighter mono variant in indigo.

### Named Rules
**The Three-Voice Rule.** Serif = the record. Sans = the controls. Mono = the figures.
A label in serif, body copy in mono, or a revision id in sans is wrong. Keep each voice
in its lane.

**The Honest-Figures Rule.** Every number that changes (percent, count, revision id,
timestamp) is mono + `tabular-nums`, so it holds its column and never jitters as it
climbs.

## 4. Elevation

Depth is **primarily tonal, with selective lift.** The three-tone stack does most of
the work — cool paper for the page, a lighter leaf-white for surfaces that sit on it,
and a hairline graphite border to seat them — so the system reads flat and calm at rest.
True shadow is then spent deliberately, on exactly the things that should feel *physically
above* the page: the manuscript leaf, and the floating tooltips / detail panels that lift
over the timeline and contributor chips. Inset shadow does the inverse for the timeline
track, carving it into the page as a channel the ink fills.

### Shadow Vocabulary
- **Resting card** (`box-shadow` = Tailwind `shadow-sm`): panels and cards — barely-there,
  just enough to separate leaf-white from the paper.
- **The Lifted Leaf** (`box-shadow: 0 18px 40px -24px oklch(0% 0 0 / 0.22)`): the
  document sheet. A long, soft, low-opacity drop — a sheet held just off the desk.
- **Floating tip** (`box-shadow: 0 10px 30px -12px oklch(0% 0 0 / 0.4)`): hover/focus
  tooltips and the contributor popover.
- **Pinned panel** (`box-shadow: 0 18px 48px -16px oklch(0% 0 0 / 0.5)`): the clicked,
  interactive seal-detail panel — the most-lifted surface in the system.
- **Carved channel** (`box-shadow: inset 0 1px 2px oklch(0% 0 0 / 0.07)`, deeper in dark):
  the timeline track, recessed so the accumulating ink reads as filling a groove.
- **Pressed seal** (`box-shadow: 0 1px 2px oklch(0% 0 0 / 0.18)`): timeline markers and
  legend seals — a small stamp standing just proud of the track.

### Named Rules
**The Earned-Lift Rule.** A drop shadow means "this floats above the page." Only the leaf
and genuinely floating overlays (tips, popovers, pinned panels) earn one. Cards and
panels stay tonal; reaching for a heavy shadow to fake hierarchy is forbidden.

## 5. Components

Buttons, cards, and inputs are **refined and restrained** — quiet, precise, standard
affordances that recede. Nothing tactile or showy; the chrome never competes with the
document.

### Buttons
- **Shape:** gently rounded (`0.375rem`, `rounded-md`). All buttons share one base:
  `inline-flex`, `gap-1.5`, `text-sm`, `font-medium`, `transition-colors`.
- **Primary:** revision indigo fill, white text. Hover → revision indigo soft. The
  *only* filled button on any screen; one primary action per view.
- **Secondary:** leaf-white surface, graphite border, ink text; hover lifts to a faint
  stone tint. The default for non-primary actions.
- **Ghost:** transparent, graphite-muted text, hover gets a soft stone wash. For
  low-emphasis and icon-adjacent actions (back, dismiss).
- **Focus:** every interactive element shows a 2px revision-indigo-ring `focus-visible`
  ring with a 2px paper-colored offset. Disabled → 50% opacity, `not-allowed`.

### Cards & Containers
- **Corner Style:** `0.5rem` (`rounded-lg`) for panels/cards; `0.75rem` (`rounded-xl`)
  for the manuscript leaf.
- **Background:** leaf-white on paper (night-panel on night-surface in dark).
- **Shadow Strategy:** resting cards use `shadow-sm`; the leaf uses the Lifted Leaf
  shadow (see Elevation). Tonal separation does most of the work.
- **Border:** a single hairline graphite border (`1px`) — full borders only, never a
  colored side-stripe.
- **Internal Padding:** `1rem` (cards); the leaf breathes wider at `2.25rem`/`1.5rem`,
  opening to `px-12` at ≥640px.

### Inputs / Fields
- **Style:** the Options page uses **native** form controls (`<select>`, checkbox,
  number) on purpose — refined, not reinvented. `color-scheme` is driven off the `.dark`
  class so native controls and scrollbars follow the theme and never strand the user in
  dark-on-dark.
- **Focus:** the same 2px revision-indigo-ring as buttons.

### Disclosure / Banner
- **PrivacyBanner:** a collapsed-by-default `<details>` disclosure on a calm stone
  surface — orientation, not a hazard. No alarming hue, no colored left-border; the
  chevron rotates on open as the non-color "expanded" affordance.

### Signature Component — The Revision Timeline
The system's centerpiece, a "writing-activity stratum":
- **Track:** a carved channel (`tl-track`, inset shadow), `h-2.5`, fully rounded.
- **Fill (accumulating ink):** an indigo gradient interpolated *in oklch* from faded
  early writing (`revision-indigo-ring`) to saturated fresh indigo (`revision-indigo`)
  at the playhead — the one place a gradient is correct, because it encodes time.
- **Playhead (the nib):** a thin standing stroke (`tl-thumb`), not a block cursor —
  shared vocabulary with the document's writing caret.
- **Seals (marginalia marks):** small paper-faced stamps standing proud of the track,
  each carrying a per-kind editorial glyph (`§ ⌃ ⌄`) in a per-kind ink, ringed so the
  kind survives grayscale. Dense bursts fuse into a **stacked seal** carrying a tabular
  count, with two faint offset silhouettes behind it as a non-color "many" cue.
- **Tip / Panel:** hover lifts a content-free paper tip (name, revision id, target
  frame); click pins an interactive ledger panel, each row a jump-to-frame button,
  dismissed by Escape / outside-click / close.

### Document-Rendering Primitives
- **Accepted text:** graphite ink, serif reading column.
- **Suggested insert** (`doc-suggest`): marginal-green text + soft tint + dotted
  green underline + `sr-only` "Suggested insertion:" label.
- **Marked for deletion** (`doc-strike`): vermilion text + soft tint + line-through +
  `sr-only` "Marked for deletion:" label.
- **Opaque structure** (`doc-opaque`): an inline labeled chip (icon + text), never a
  bare colored box.
- **Writing caret** (`doc-caret`): a thin rounded inline nib tinted to the active
  author's hue, with a soft blink; frozen (not removed) under reduced-motion.

### Contributor Chips (Insights)
Each distinct contributor is an interactive chip with the collaborator's Google-assigned
color as a small ringed dot; hover/focus — or click to pin — lifts a content-free detail
card (display name, the viewer's own email when known, a revision count, the active
window). Reuses the timeline tip's paper/lift/mono vocabulary.

## 6. Do's and Don'ts

### Do:
- **Do** keep the page **cool, near-neutral paper** (`cool-paper oklch(98.5% 0.001 106)`).
  Carry any warmth through accent and type, never the body background.
- **Do** reserve **revision indigo** for "now," the single primary action, and focus
  rings. One filled button per view.
- **Do** pair every meaning-bearing color with a non-color affordance — glyph, underline,
  strike, ringed seal, or `sr-only` label. Test every state in grayscale.
- **Do** keep the three type voices in their lanes: serif for the document and titles,
  system sans for UI, mono + `tabular-nums` for every figure.
- **Do** spend drop shadows only on the leaf and genuinely floating overlays; let tonal
  stone layering carry the rest.
- **Do** ship every interactive element with default, hover, `focus-visible`, active,
  and disabled states, and a visible 2px revision-indigo-ring focus ring.
- **Do** provide a `prefers-reduced-motion` alternative for every animation (freeze the
  caret, pulse — don't freeze — the indeterminate bar, drop transitions).
- **Do** prefer native form controls and standard affordances; the tool should feel
  familiar and recede.

### Don't:
- **Don't** drift the paper toward **cream, sand, ivory, or beige** — that warm AI-default
  near-white is the exact aesthetic this system rejects.
- **Don't** build a **surveillance / analytics dashboard** look: no KPI tiles, no
  charts-as-decoration, no telemetry sheen. This is local and content-respecting.
- **Don't** import **flashy consumer-SaaS** patterns: no gradient hero banners, no
  hero-metric template (big number + label + supporting stats), no marketing polish.
- **Don't** let reconstruction states read as **accusatory**. Show process neutrally;
  never score, flag, or editorialize, especially when an educator is reviewing a student.
- **Don't** use **gradient text** (`background-clip: text`) anywhere. The only sanctioned
  gradients are the timeline's oklch ink-ramp and the near-flat paper wash.
- **Don't** use a colored **side-stripe** (`border-left`/`border-right` > 1px) on cards,
  banners, or alerts. Full hairline borders or tonal tints only.
- **Don't** use **glassmorphism** / decorative blur, or reach for a heavy shadow to fake
  hierarchy that tonal layering should carry.
- **Don't** let a second accent compete with revision indigo, or use any meaning-bearing
  hue as decoration.
