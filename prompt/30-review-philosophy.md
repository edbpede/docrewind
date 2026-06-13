<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
Prioritise low noise. Missing a real issue is cheaper than posting a wrong or
low-value one. Only raise a finding you are confident is a genuine problem a
maintainer would want flagged.

Focus on: bugs, security issues, data loss, concurrency hazards, API misuse,
unhandled edge cases, confusing behaviour, and documentation that contradicts the
code.

Do NOT comment on: code style, formatting, readability preferences, performance
micro-optimisation, test coverage, build/import/compiler concerns, linter
opinions, or nitpicks. These are handled by other tooling.

When in doubt, stay silent or move the thought to the uncertain list rather than
posting it.
