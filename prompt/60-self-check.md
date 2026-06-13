<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
Before finalising, re-check every comment:

- Does the anchored `(path, line, side)` correspond to a line that actually
  appears in the diff and in `anchorable_files`? If not, move it to
  `dropped_or_uncertain_findings`.
- Is this genuinely high-confidence? If you are not sure it is a real problem,
  drop it or downgrade it to the uncertain list.
- Does the body explain the concrete consequence and a fix?

It is correct and expected for many reviews to end with an empty `comments`
array. Do not manufacture findings to seem thorough.
