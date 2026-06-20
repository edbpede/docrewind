# Design

<!--
  Impeccable context file (visual system). Answers "how it looks". Paired with
  PRODUCT.md (who/what/why). Loosely follows the Google Stitch DESIGN.md format.
  This is the TARGET system the refactor implements; uno.config.ts is the
  machine-readable source of truth and must match this document.
-->

## Direction

**"A warm reading room, kept by a helpful hand."** We evolve the existing
"manuscript and its margin" soul toward an **Apple-Settings-friendly, classroom-warm**
register. The document still feels like a real document; the *interface around it*
becomes soft, generous, and reassuring — the feeling of a well-made consumer app a
teacher already trusts, not an archival research tool.

Warmth is carried by **accent, type, space, and gentle motion** — never by a cream
body background (the saturated AI default) and never by gradients or glow. Neutrals
are a near-neutral *warm* gray (very low chroma); the ink is a cool blue-black, so
warm paper + cool ink gives the page its quiet, legible character.

North star: **iOS Settings** — grouped surfaces, hairline separators, big tap
targets, plain-language rows, restrained color, calm motion.

## Color

OKLCH throughout. Light is the default (daytime grading); dark is a genuine warm
charcoal (evening grading), not a cold gray. Contrast targets are verified, not
eyeballed.

### Neutrals — warm gray (hue ~75, very low chroma; deliberately NOT cream)

| Role | Light | Dark |
|---|---|---|
| `canvas` (page) | `oklch(0.975 0.004 75)` | `oklch(0.205 0.006 75)` |
| `surface` (cards, sheets) | `oklch(0.995 0.0015 75)` | `oklch(0.255 0.007 75)` |
| `surface-sunken` (tracks, wells) | `oklch(0.955 0.005 75)` | `oklch(0.175 0.006 75)` |
| `hairline` (subtle border/divider) | `oklch(0.905 0.005 75)` | `oklch(0.330 0.008 75)` |
| `hairline-strong` | `oklch(0.845 0.006 75)` | `oklch(0.400 0.009 75)` |

### Ink — cool blue-black (hue 264; pairs against the warm paper)

| Role | Light | Dark | Min contrast vs canvas |
|---|---|---|---|
| `ink` (primary text/headings) | `oklch(0.27 0.02 264)` | `oklch(0.955 0.004 75)` | ≥ 12:1 |
| `ink-secondary` (labels) | `oklch(0.42 0.018 264)` | `oklch(0.82 0.006 75)` | ≥ 7:1 |
| `ink-muted` (help/caption) | `oklch(0.50 0.015 264)` | `oklch(0.70 0.006 75)` | ≥ 4.5:1 |
| `ink-faint` (large/decorative only) | `oklch(0.60 0.012 264)` | `oklch(0.58 0.006 75)` | large text only |

### Brand — friendly indigo (the heritage "revision" accent, hue 264)

Primary action + the "now" / playhead identity. Used as a **solid, confident
color** — never a gradient-for-decoration.

| Role | Light | Dark |
|---|---|---|
| `brand` (primary action bg) | `oklch(0.52 0.16 264)` | `oklch(0.52 0.16 264)` |
| `brand-hover` (press/hover) | `oklch(0.46 0.16 264)` | `oklch(0.58 0.16 264)` |
| `brand-text` (links/accent on light) | `oklch(0.47 0.16 264)` | `oklch(0.74 0.13 264)` |
| `brand-soft` (selected / info tint) | `oklch(0.95 0.025 264)` | `oklch(0.30 0.06 264)` |
| `brand-ring` (focus) | `oklch(0.62 0.14 264)` | `oklch(0.70 0.12 264)` |

White text on `brand` must clear 4.5:1 (verified). `brand` retains the exact role
the old `revision` token had (timeline fill, playhead, caret), so the heritage and
the new system are the same color story, refined.

### Accent — honey (warm secondary, hue ~80; used sparingly for human warmth)

The single warm note. For small moments of friendliness and positive confirmation
(a completed replay, a gentle highlight) — **not** a second primary, never on more
than a few percent of any screen. Kept clearly out of the document-markup palette.

| Role | Light | Dark |
|---|---|---|
| `accent` (warm fill/highlight) | `oklch(0.80 0.13 80)` | `oklch(0.82 0.12 80)` |
| `accent-strong` (warm text/icon, AA on light) | `oklch(0.56 0.12 70)` | `oklch(0.84 0.11 80)` |
| `accent-soft` (warm tint bg) | `oklch(0.95 0.04 80)` | `oklch(0.32 0.06 70)` |

### Functional document colors (PRESERVED — they carry meaning + an affordance)

These mark reconstruction state inside the rebuilt document and must stay stable
(color is always paired with a non-color affordance). Unchanged in hue from the
heritage system.

- `suggest` (suggested insertion → color **+ dotted underline + label**):
  `oklch(0.52 0.12 165)`; soft `oklch(0.95 0.03 165)` / dark `oklch(0.38 0.06 165)`
- `strike` (marked for deletion → color **+ line-through + label**):
  `oklch(0.55 0.16 35)`; soft `oklch(0.95 0.03 35)` / dark `oklch(0.40 0.08 35)`

### Status (UI feedback; each pairs with an icon)

- `success`: `oklch(0.55 0.13 155)` · soft `oklch(0.95 0.03 155)`
- `danger` (destructive actions): `oklch(0.54 0.18 25)` · soft `oklch(0.95 0.03 25)`
- `warning`: `oklch(0.70 0.14 75)` (icon-paired) · `info`: the brand indigo

### Color strategy

**Restrained → committed.** Warm-tinted neutrals + one confident brand indigo
(≤ ~10% of a surface) + a honey accent used as an occasional human touch. Most of
every screen is paper and ink; color earns its place.

## Typography

**System fonts only** (privacy + zero network + native-friendly feel). No external
web fonts — ever — to honor the local-first promise.

- `--font-sans` (all UI chrome): `system-ui, -apple-system, "Segoe UI", Roboto,
  "Helvetica Neue", Arial, sans-serif` — humanist, friendly on every platform.
- `--font-display` (h1, brand wordmark, big figures): `ui-rounded, "SF Pro Rounded",
  system-ui, …` — gives a warm, rounded headline on Apple devices (where most of
  this audience lives), graceful humanist fallback elsewhere. This is the signature
  friendly touch.
- `--font-serif` (the reconstructed document column ONLY): `ui-serif, Georgia,
  "Times New Roman", serif` — the document reads as a document; a tasteful echo of
  the manuscript heritage in exactly the right place.
- `--font-mono` (data, counters, timestamps): `ui-monospace, "SF Mono", Menlo,
  Consolas, monospace` with `tabular-nums`.

### Scale (generous; Apple-roomy)

| Token | Size / line-height | Use |
|---|---|---|
| display | 1.625rem / 1.2, `-0.02em`, display font | Popup hero, big numbers |
| title | 1.375rem / 1.25, `-0.015em` | Page H1 |
| heading | 1.125rem / 1.3, weight 600 | Section H2 |
| body-lg | 1rem / 1.55 | Lead paragraphs |
| body | 0.9375rem / 1.55 | Default UI text |
| label | 0.875rem / 1.4, weight 500 | Form labels, buttons |
| caption | 0.8125rem / 1.45, `ink-muted` | Help text (still ≥ 4.5:1) |
| micro | 0.75rem / 1.4 | Meta, fine print |
| doc | 1.0625rem / 1.8, serif | Reconstructed document body |

**Hierarchy via size + weight + color, not via tracked mono eyebrows.** The
old mono-uppercase eyebrow is retired as a per-section device (it was on nearly
every block — an AI tell). It survives only as a rare, deliberate accent (e.g. one
small kicker), never as default section scaffolding.

## Spacing & Layout

- 4px base. Scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- **Vary spacing for rhythm** — tight within a group, generous between sections.
- Container widths: popup **360px** (was 320; roomier), options **40rem**, replay
  **48rem** reading measure; document column stays ≤ 68ch.
- **Touch targets ≥ 44px** for primary controls; ≥ 36px for compact desktop rows,
  with adequate hit area.
- iOS-grouped pattern: related rows live in one `surface` card separated by
  hairlines, with a quiet group label above — not a field of separate cards.

## Shape (radii)

Friendly, not blobby. Cards 12–16px; never the 24–40px over-round AI tell.

`xs 6 · sm 8 (buttons, inputs) · md 12 (cards, rows) · lg 16 (sheets, the leaf) ·
xl 22 (popup shell) · pill 9999 (chips, segmented control, toggles)`

## Elevation

Soft, layered, low-opacity shadows (Apple-like). **Never** pair a 1px border with a
wide drop shadow on the same element (the "ghost-card" tell): a surface is defined
by background contrast + soft shadow, or by a hairline — pick one.

- `sm`: `0 1px 2px oklch(0 0 0/0.05)` — buttons, inputs
- `md`: `0 2px 8px -2px oklch(0 0 0/0.08), 0 6px 16px -8px oklch(0 0 0/0.06)` — cards
- `lg`: `0 12px 32px -12px oklch(0 0 0/0.14)` — popovers, sheets, the document leaf

## Motion

Calm and intentional; ease-out, no bounce/elastic. Motion clarifies state change;
it never blocks a task or gates content visibility.

- Durations: fast 120ms, base 180ms, slow 260ms, slower 420ms.
- Easing: `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`;
  `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)`.
- Signature moments: a gentle theme cross-dissolve; the playhead/caret as a soft
  resting nib; a list-stagger on the insights chips; the document settling in.
- **Reduced motion**: every animation degrades to a crossfade or instant state.
  The indeterminate bar pulses (never freezes to a dead pill).

## Components

- **Buttons**: `primary` (solid brand, white text, soft press-darken), `secondary`
  (surface + hairline, ink text), `ghost` (tinted hover only), `danger` (for
  destructive actions, with an icon + confirm). Pill or `sm` radius; min height 44
  (touch) / 36 (compact). Always a label; icon optional and decorative.
- **Grouped rows (iOS Settings)**: a `surface` card holding label/value/control
  rows divided by hairlines. The label is plain language; the control sits right;
  one-line help in `caption`/`ink-muted` beneath when needed.
- **Toggle / switch**: a real switch affordance for on/off settings (friendlier and
  bigger than a bare checkbox), brand when on, with a text state.
- **Segmented control**: pill track holding 2–4 options (speed, theme, diagnostics);
  the active segment is a raised brand-tinted pill — clearly the selected one.
- **Inputs**: `surface` fill, hairline, generous padding, brand focus ring; numeric
  budgets get a unit suffix and a friendly label, not "cap (MB)".
- **The document leaf**: an elevated `surface` sheet with a soft `lg` shadow and a
  quiet graphite binding margin; serif `doc` column ≤ 68ch. The one place the
  "manuscript" reads literally.
- **Timeline**: a soft channel (`surface-sunken`) with a brand fill that deepens
  toward the playhead; the playhead is a resting nib. Markers are friendly,
  legible seals carrying a glyph **with a visible legend** (the legend is shown, not
  hidden). Tooltips/panels lift on a `lg` shadow and are keyboard-reachable.
- **Privacy note**: a calm, compact disclosure row. The key reassurance line ("a
  reconstruction, not the live document") is **always visible** and doubles as the
  trigger; the fuller explanation is **collapsed by default** and expands on
  demand. A friendly shield mark — reassurance, not a warning. Never a banner that
  hides its own headline.
- **Status/empty/error states**: every async surface has a friendly, plain-language
  empty, loading, and error state with one clear recovery action and an icon —
  never a bare sentence on a card.
- **Brand mark**: the existing glyph on its light "app chip", refined to sit
  comfortably (not float) in both themes.

## Z-index scale (semantic, never arbitrary)

`base 0 · raised 1 · dropdown 10 · sticky 20 · banner 30 · backdrop 40 · modal 50 ·
popover 60 · toast 70 · tooltip 80`

## Anti-patterns (hard avoid, per impeccable + our anti-references)

Cream/sand/beige body bg · purple→blue gradients · gradient text · glow / neon ·
glassmorphism-as-default · side-stripe accent borders · identical icon-card grids ·
mono-uppercase eyebrow on every section · over-rounded 24–40px cards · ghost-card
(1px border + wide shadow) · childish/toy styling · dense jargon-laden control walls.
