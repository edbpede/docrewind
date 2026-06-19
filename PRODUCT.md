# Product

## Register

product

## Users

Two audiences, one privacy-first thread: **anyone who can already open a Google Doc and
wants to watch how it came to be — on their own machine, without an account.**

- **Doc owners reviewing their own work** — a writer, researcher, or team member who wants
  to scrub back through how a document evolved: when the hard thinking happened, what was
  cut, how a draft reached its final shape. Their context is reflective, after the fact.
- **Educators reviewing a student's submitted Doc** — a teacher inside Google Classroom
  (grading and submission-status views) who opens a student's writing to understand the
  *process*, not just the result: pacing, revision, where effort went. Their context is
  evaluative, but the job is to *see and understand*, not to surveil or accuse.

The job to be done is the same for both: **reconstruct and replay the revision history of a
single Google Doc, locally, and read it as a story over time.** Users arrive already having
access to the document; DocRewind never reaches for anything they couldn't already see, and
never sends that content anywhere. Trust that nothing leaves the machine is a precondition
for the whole product, not a nice-to-have.

## Product Purpose

DocRewind is a local-first MV3 browser extension (Chrome + Firefox from one codebase) that
reconstructs and replays a Google Doc's revision history **entirely on-device — no backend,
no account, no telemetry.** Activated explicitly from an in-page affordance (it never
auto-loads history), it retrieves the revision data the user is already entitled to,
reconstructs the document state at every point in time, and opens a replay surface where the
user can play, pause, change speed, scrub the timeline, and inspect what changed and who
changed it.

It exists because the writing *process* is invisible by default — Google's own version
history is shallow and clumsy to read — and because the obvious way to expose that process
(a cloud service that ingests your documents) is exactly the privacy trade no one should
have to make. DocRewind's answer is to do all of it locally.

Success looks like: a user activates it on a Doc they care about, and within one calm,
legible session understands how that document was written — the bursts, the deletions, the
contributors, the shape of the effort — and never once wonders where their data went.

## Brand Personality

**Approachable, calm, trustworthy.** DocRewind is an everyday utility, not an instrument for
specialists — anyone should be able to pick it up and immediately understand what they're
looking at. The voice is plain and reassuring (the popup tells you, unprompted, that it
opens no document data), never jargon-heavy, never alarming.

The *visual* identity is "the manuscript and its margin": a cool archival-paper surface,
inky blue-black text, a single revision-indigo accent for "now," and marginalia-style
timeline marks. That archival calm is in service of approachability — it keeps the chrome
quiet so the document and its evolution stay center stage, and it reads as careful and
trustworthy rather than clever. Unobtrusive on purpose: the tool should disappear into the
reading.

Three words: **calm, honest, unobtrusive.**

## Anti-references

- **A surveillance / analytics dashboard.** No KPI tiles, no charts-as-decoration, no
  telemetry sheen. This is local and content-respecting; it must never *look* like a
  tracking product, because it isn't one.
- **Flashy consumer SaaS.** No gradient hero banners, no hero-metric templates, no
  marketing-page polish bleeding into the product UI. Earned familiarity over spectacle.
- **The warm-cream AI-default aesthetic.** The cream/sand/beige near-white that signals
  generic machine output. DocRewind deliberately uses *cool* paper instead; that choice is
  load-bearing and must not drift warm.
- (Implicit, from the educator use case) **An accusatory "gotcha" tool.** It shows process
  neutrally; it never editorializes or presumes wrongdoing.

## Design Principles

1. **Privacy is the product, not a setting.** Every surface should make "this stays on your
   machine" legible and must never betray it — content-free tooltips, an About panel that
   states what it does *not* access, no affordance that implies data leaves the device. The
   locked manifest (storage + docs.google.com only) is the design constraint, not a
   limitation to route around.
2. **Show the process; never judge it.** DocRewind reconstructs *how* a document came to be
   and presents that evidence plainly. It does not score, flag, or accuse — especially when
   an educator is on the other side of the screen. Neutral presentation is an ethical
   requirement, not a stylistic one.
3. **The tool disappears into the reading.** This is an instrument for close reading. Chrome
   stays calm and recedes so attention stays on the document and its evolution; signature
   moments (the manuscript leaf, the writing-activity timeline) earn their presence, the
   rest gets out of the way.
4. **Meaning never rides on color alone.** Every reconstruction state pairs a hue with a
   non-color affordance (suggestion = underline + label, deletion = strike + label, opaque
   structure = labeled chip). An accessibility rule elevated to a product principle, because
   the whole point is that the user can *trust what they're seeing*.
5. **Earned familiarity over novelty.** Standard, predictable affordances — play/pause/scrub,
   visible focus, real form controls — so anyone can use it without instruction. Surprise is
   spent only where it pays for itself.

## Accessibility & Inclusion

Target: **WCAG 2.2 AA**, already reflected in the implementation and to be held as a floor.

- **Never color-only.** Every state-bearing color is paired with a glyph, underline, strike,
  or label so meaning survives grayscale and color-vision differences.
- **Contrast.** Body text ≥ 4.5:1, large/bold text ≥ 3:1, in both light and dark themes;
  placeholder and muted text held to the same body bar, not allowed to wash out.
- **Reduced motion is honored.** `prefers-reduced-motion: reduce` neutralizes timeline,
  scrubber, caret-blink, and progress transitions (and caps JS auto-advance); the
  indeterminate bar degrades to a non-travelling pulse rather than freezing into a
  broken-looking stub.
- **Keyboard + assistive tech.** Visible `focus-visible` rings on every interactive element,
  jump-to-event markers reachable by keyboard, and `sr-only` labels carrying the meaning of
  non-accepted runs for screen readers while the visible page stays uncluttered.
- **Theme follows the user.** Light / dark / system, with the native `color-scheme` driven
  off the same toggle so OS form controls and scrollbars never strand the user in
  dark-on-dark.
