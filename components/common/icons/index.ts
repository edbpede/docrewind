// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DocRewind icon set — a small, hand-authored inline-SVG vocabulary in ONE
// coherent style (24×24 viewBox, 1.75 stroke, round caps/joins, `currentColor`),
// so the UI never mixes icon families or ships emoji glyphs that render
// differently per-OS. No external icon dependency: this honors the local-first /
// no-network promise and keeps the bundle small. Geometry is Lucide-equivalent
// (ISC) re-authored for this project.
//
// Icons are DECORATIVE by default — they always sit beside a visible label or an
// aria-labelled control — so each carries `aria-hidden` and leaves the a11y tree.
// Svelte idioms: `class` (never `className`) — and since `class` is reserved in a
// destructuring pattern, each icon reads it as `class: klass` from `$props()`.
//
// Svelte allows one component per file, so the set is a directory and this barrel
// keeps the public specifier `@/components/common/icons` byte-identical for all
// 13 consumers. `Icon.svelte` is the shared SVG frame every icon renders through
// and owns the `IconProps` contract re-exported below.
//
// The set is organized in three families (the export list below is sorted
// alphabetically because Biome's assist enforces that):
//   Transport — Play, Pause, Restart, History, Crosshair
//   Chrome    — Settings, Chart, Info, Shield, ChevronRight, ChevronDown,
//               ArrowLeft, Close, External, CheckCircle, Alert, Trash
//   Marker / structure glyphs (intuitive, replacing scholarly § ⌃ ⌄ ‖) —
//               Pencil, Plus, Minus, PauseBars, Image, Table, List, Comment, File

export { default as IconAlert } from "./IconAlert.svelte";
export { default as IconArrowLeft } from "./IconArrowLeft.svelte";
export { default as IconChart } from "./IconChart.svelte";
export { default as IconCheckCircle } from "./IconCheckCircle.svelte";
export { default as IconChevronDown } from "./IconChevronDown.svelte";
export { default as IconChevronRight } from "./IconChevronRight.svelte";
export { default as IconClose } from "./IconClose.svelte";
export { default as IconComment } from "./IconComment.svelte";
export { default as IconCrosshair } from "./IconCrosshair.svelte";
export { default as IconExternal } from "./IconExternal.svelte";
export { default as IconFile } from "./IconFile.svelte";
export { default as IconHistory } from "./IconHistory.svelte";
export { default as IconImage } from "./IconImage.svelte";
export { default as IconInfo } from "./IconInfo.svelte";
export { default as IconList } from "./IconList.svelte";
export { default as IconMinus } from "./IconMinus.svelte";
export { default as IconPause } from "./IconPause.svelte";
export { default as IconPauseBars } from "./IconPauseBars.svelte";
export { default as IconPencil } from "./IconPencil.svelte";
export { default as IconPlay } from "./IconPlay.svelte";
export { default as IconPlus } from "./IconPlus.svelte";
export { default as IconRestart } from "./IconRestart.svelte";
export { default as IconSettings } from "./IconSettings.svelte";
export { default as IconShield } from "./IconShield.svelte";
export { default as IconTable } from "./IconTable.svelte";
export { default as IconTrash } from "./IconTrash.svelte";
export type { IconProps } from "./types";
