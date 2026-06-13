<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
Review the diff above. Propose only high-confidence findings, each anchored to a
specific changed line. You may propose zero findings. The deterministic pipeline
will re-check every anchor against the real diff and drop anything it cannot
place, so do not guess at line numbers — anchor only to lines that actually
appear as added, removed, or context lines in the diff.

The `anchorable_files` field in the PR context lists exactly which files and
lines can carry a comment. Do not comment on a file or line outside that set.
