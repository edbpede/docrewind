<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
Each inline comment must:

- Address exactly one issue.
- Anchor by `line` + `side`. Use `side: "RIGHT"` for added or context lines (the
  new file), `side: "LEFT"` only for removed lines (the old file). Default to
  RIGHT.
- For a multi-line range, set `start_line` and `start_side` on the SAME side as
  `line`, with `start_line` <= `line`. Otherwise omit them.
- Explain WHY the issue matters (the concrete consequence), then give a concrete
  suggested fix. Use a fenced code block with a language tag for any code; do not
  use GitHub `suggestion` blocks.

Do not anchor by `position`. Do not invent line numbers. If you cannot anchor a
concern to a real changed line, put it in `dropped_or_uncertain_findings`
instead of `comments`.
