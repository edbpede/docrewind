# Product

<!--
  Impeccable context file (strategy). Answers who/what/why. Paired with DESIGN.md
  (how it looks). Authored from a design-direction interview, not inferred from a
  prompt. Read this before any visual work on DocRewind's UI.
-->

## Register

product

## Users

**Educators of mixed technical ability** — classroom teachers, instructors, TAs,
and academic-integrity / writing-support staff. Some are comfortable with
software; many are not. A secondary audience is **students** reviewing their own
writing process.

Their context when using DocRewind: at a laptop or Chromebook, often **mid-grading**
or reviewing a submission, frequently tired and time-pressed, sometimes uneasy
about whether a tool is "safe" or "allowed." They are inside Google Docs or Google
Classroom and want to understand *how a document came to be* — was it written
steadily or pasted in one block, who contributed, when the work happened.

The job to be done: **"Show me, in plain terms, how this document was written —
without me having to learn anything, install an account, or worry about where the
data goes."**

## Product Purpose

DocRewind reconstructs and **replays the revision history of a Google Doc entirely
on the user's own device** — no backend, no account, no telemetry. It turns an
opaque "final document" into a watchable story of how it was written: a scrubbable
timeline, a document that rebuilds itself, and a calm summary of who did what and
when.

Success looks like: a non-technical teacher opens the replay, understands what
they're looking at within a few seconds, presses one obvious button, and watches
the document come together — feeling informed and reassured, never confused or
alarmed. The privacy promise is felt, not just stated.

## Brand Personality

**Friendly · approachable · reassuring** — a helpful classroom companion that walks
you through what happened. Warm and human, like a knowledgeable colleague who is
good at making complicated things feel simple. Grown-up and credible at all
times — **never childish, never cute for its own sake.** Quietly trustworthy: the
local-first, private nature of the tool is part of the personality, expressed as
calm confidence rather than security theater.

Three words: **warm, clear, trustworthy.**

## Anti-references

- **Generic "AI app" dashboards** — purple→blue gradients, neon glow, glassmorphism,
  endless identical icon-on-card grids. The "an AI made this" look. Hard avoid.
- **Childish / cartoonish edutainment** — bubbly mascots, toy colors, oversized
  rounded blobs. Undermines credibility with professional educators.
- **Cluttered, over-technical tooling** — walls of options, developer jargon
  ("re-decode raw data", "per-document cap"), dense control panels. Intimidating.
- **Cold enterprise / B2B compliance software** — grey, dense, corporate, joyless.
  This is a tool teachers *choose* to use, not one HR makes them use.

## Design Principles

1. **Reassure first.** Every surface should lower a non-technical teacher's anxiety.
   Plain language, visible-but-calm privacy, no dead ends, no scary-looking states.
2. **One obvious next step.** Each screen makes its primary action unmistakable;
   everything secondary recedes. Never present a teacher with a flat field of
   equally-weighted choices.
3. **Plain words, not jargon.** Speak like a helpful colleague. If a sentence needs
   engineering knowledge to parse, it is wrong and must be rewritten.
4. **Warmth through craft, not noise.** Warmth comes from generous space, friendly
   type, gentle motion, and one human accent — not from decoration, gradients, or
   color for its own sake.
5. **Show, don't make them dig.** If something is interactive or meaningful, make
   that legible up front. Don't hide the legend, the privacy note, or "what this
   glyph means" behind a hover or a collapsed disclosure.
6. **Earn trust with honesty.** Be calmly clear that this is a reconstruction (an
   approximation), and that nothing leaves the device — framed as confidence, not
   as a warning.

## Accessibility & Inclusion

- **WCAG 2.1 AA** is the floor: body text ≥ 4.5:1, large text ≥ 3:1, verified.
- **Color is never the sole carrier of meaning** — every semantic color is paired
  with a glyph, label, underline, or strike (preserve and strengthen the existing
  approach). Must survive grayscale and the common color-vision deficiencies.
- **Full keyboard operability** with a visible, consistent focus ring on every
  interactive element; interactive content must be reachable, not hover-only.
- **Reduced motion is a first-class path**, not an afterthought: every animation has
  a `prefers-reduced-motion` alternative (crossfade or instant).
- **Generous touch/click targets** (≈44px, Apple-influenced) so the interface is
  comfortable for users of all abilities and input methods.
- **Light and dark themes**, both warm and legible, following the OS preference by
  default while allowing an explicit override.
- **Privacy is an inclusion feature**: the no-account, on-device model lowers the
  barrier for cautious or less-confident users; keep it visible and calm.
