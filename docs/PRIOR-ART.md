<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Prior-art provenance & attribution

DocRewind reconstructs an **undocumented** data format. Getting the operation
grammar right required studying prior work. This document records exactly what was
**ported** (and is therefore attributed and license-bound) versus what was only
**studied for facts** (and from which **no code is reused**). This distinction
matters for an AGPL project (PRD §11.6).

## Ported code — attributed and license-bound

### `harvard-vpal/gdocrevisions` — MIT

- **Repository:** <https://github.com/harvard-vpal/gdocrevisions> (last release 2018)
- **License:** MIT
- **What was ported:** the Google Docs revision **operation grammar / vocabulary**
  — the operation type codes (`is`, `ds`, `mlti`, suggestion ops `iss`/`dss`/
  `msfd`/`usfd`, etc.) and the structural decode rules for them. Corroborated by
  the 2014 Google Docs teardown (PRD Appendix A.2).
- **Where it lives:** `lib/decoder/decode.ts` and `lib/decoder/types.ts`.
- **How it is attributed:** those files carry the MIT copyright notice **alongside**
  DocRewind's AGPL-3.0-or-later SPDX header. MIT → AGPL incorporation is permitted;
  the MIT terms (copyright + permission notice) are retained per the license. The
  header reads:

  ```
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Operation grammar ported from the MIT-licensed `harvard-vpal/gdocrevisions`
  // (https://github.com/harvard-vpal/gdocrevisions, last release 2018) and
  // corroborated by the 2014 Google Docs teardown — see PRD Appendix A.2.
  //
  //   Copyright (c) 2018 Harvard VPAL — MIT License (operation vocabulary).
  ```

If you add or change a file that incorporates `gdocrevisions` material, retain
this dual notice.

## Studied for facts only — no code reused

The following sources were consulted to **confirm protocol facts** (endpoint
shapes, response framing, operation behavior). **None** of their code is copied or
adapted into DocRewind. They are listed for transparency and to make the boundary
explicit.

| Source | License status | Why it is study-only |
|--------|----------------|----------------------|
| [`jsomers/draftback`](https://github.com/jsomers/draftback) | **No license** (all-rights-reserved); the repo is the old Rails/PHP web app, not the current closed-source extension | No license means no reuse rights. Facts about the revision endpoint may be confirmed against it; **code must never be reused**. Draftback's shipping extension is proprietary and must not be decompiled or copied. |
| benmarwick revision-history gist | **No license** (all-rights-reserved) | Study-for-facts-only, same as above — confirm facts, never reuse code. |

## Safe conceptual references

- **Etherpad** (Apache-2.0) and the broader **operational-transform** literature
  are safe conceptual references for reconstruction semantics. No code is ported;
  they inform the *approach*, not the implementation.

## Dependency licenses

All third-party runtime and build dependencies must be **AGPL-compatible**. This
is audited in CI by `scripts/license-audit.ts` (`bun run audit:licenses`), which
fails on any dependency whose license is not on the compatible allowlist. The core
stack — WXT, SolidJS, UnoCSS, Bun, Biome, `idb`, `@webext-core/messaging` — is
permissively licensed (MIT / Apache / ISC / BSD class) and compatible. See
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the SPDX-header requirement on
first-party files.
