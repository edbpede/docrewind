<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
Output a single JSON object matching the provided schema. Key rules:

- `schema_version` is `"1.0"`.
- `review_event` is ALWAYS `"COMMENT"`. You must never approve or request
  changes; the pipeline rejects any other value.
- `summary` is at most three sentences, with no code blocks and no file or line
  references. Do not repeat the inline comments in it.
- `comments` may be empty. Each comment carries `path`, `line`, `side`, `body`,
  `severity` (low | medium | high | critical), `category`, `confidence` (0–1),
  and `rationale` (why it is high-confidence; not shown to users).
- `dropped_or_uncertain_findings` holds anything you considered but could not
  confirm or anchor.

Do not add fields that are not in the schema. Do not wrap the JSON in prose or a
code fence — emit the object itself.
