// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replay decode pipeline barrel (plan §1.7 / PRD §9.4, §10.9). The three editor
// pipelines live in SEPARATE per-kind modules (pipeline-docs / pipeline-sheets /
// pipeline-slides) so a kind-routed consumer — the Worker shell dynamic-imports
// exactly one — never bundles the other editors' decode/reconstruction code.
// This barrel re-exports everything for consumers that are inherently
// kind-generic (the same-thread fallback runners, the Bun unit specs), so the
// pure API surface is unchanged by the split.

export type { PipelineResult, PipelineSuccess } from "./pipeline-docs";
export { runPipeline, runPipelineOverBodies } from "./pipeline-docs";
export type { PipelineUnsupported, UnsupportedReason } from "./pipeline-shared";
export type { SheetsPipelineResult, SheetsPipelineSuccess } from "./pipeline-sheets";
export { runSheetsPipeline, runSheetsPipelineOverBodies } from "./pipeline-sheets";
export type { SlidesPipelineResult, SlidesPipelineSuccess } from "./pipeline-slides";
export { runSlidesPipeline, runSlidesPipelineOverBodies } from "./pipeline-slides";
