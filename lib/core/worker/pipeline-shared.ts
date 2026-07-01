// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared pipeline result vocabulary (plan §1.7 / PRD §9.4, §10.9). The three
// per-editor pipelines (pipeline-docs / pipeline-sheets / pipeline-slides) are
// SEPARATE modules so a consumer that knows its `DocumentKind` can load exactly
// one editor core — the worker shell dynamic-imports by kind, keeping a Doc
// replay's worker bundle free of the Sheets + Slides decoders. Only the
// kind-independent types live here.

/** Why a body could not be decoded (content-free, privacy-safe). */
export type UnsupportedReason = "parse-error" | "unknown-schema";

/** The body/bodies could not be decoded at all. */
export interface PipelineUnsupported {
  readonly kind: "unsupported";
  readonly reason: UnsupportedReason;
}
