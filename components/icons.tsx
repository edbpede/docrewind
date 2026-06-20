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
// Solid idioms: `props.x` (never destructured), `class` (never `className`).

import type { Component, JSX } from "solid-js";

export interface IconProps {
  /** Edge length in px. Default 20. */
  readonly size?: number;
  /** Extra classes (color via `text-*`, since paths use `currentColor`). */
  readonly class?: string;
  /** Stroke width for outline icons. Default 1.75. */
  readonly stroke?: number;
}

type Internal = IconProps & { readonly children: JSX.Element; readonly filled?: boolean };

/** Shared SVG frame. `filled` swaps stroke geometry for solid fills (play/pause). */
const Svg: Component<Internal> = (props) => {
  const size = (): number => props.size ?? 20;
  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill={props.filled ? "currentColor" : "none"}
      stroke={props.filled ? "none" : "currentColor"}
      stroke-width={props.stroke ?? 1.75}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
};

// ── Transport ────────────────────────────────────────────────────────────────
export const IconPlay: Component<IconProps> = (props) => (
  <Svg {...props} filled>
    <path d="M7 4.5v15a1 1 0 0 0 1.52.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" />
  </Svg>
);

export const IconPause: Component<IconProps> = (props) => (
  <Svg {...props} filled>
    <rect x="6" y="5" width="4" height="14" rx="1.4" />
    <rect x="14" y="5" width="4" height="14" rx="1.4" />
  </Svg>
);

export const IconRestart: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
    <path d="M3 3v5h5" />
  </Svg>
);

/** A clock-with-rewind — the "revision history / replay" mark. */
export const IconHistory: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7.5V12l3 1.7" />
  </Svg>
);

// ── Chrome ─────────────────────────────────────────────────────────────────
export const IconSettings: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M21 4h-7" />
    <path d="M10 4H3" />
    <path d="M21 12h-9" />
    <path d="M8 12H3" />
    <path d="M21 20h-5" />
    <path d="M12 20H3" />
    <path d="M14 2v4" />
    <path d="M8 10v4" />
    <path d="M16 18v4" />
  </Svg>
);

export const IconInfo: Component<IconProps> = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9.25" />
    <path d="M12 11.5v5" />
    <path d="M12 7.75h.01" />
  </Svg>
);

/** Shield-check — the privacy / on-device reassurance mark. */
export const IconShield: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M12 21.5c4.4-1.5 8-4.2 8-9.3V5.6a1 1 0 0 0-.7-.95C16.6 3.8 14.3 2.9 12.5 2.1a1.2 1.2 0 0 0-1 0C9.7 2.9 7.4 3.8 4.7 4.65a1 1 0 0 0-.7.95v6.6c0 5.1 3.6 7.8 8 9.3Z" />
    <path d="m9 12 2 2 4-4.5" />
  </Svg>
);

export const IconChevronRight: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);

export const IconChevronDown: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const IconArrowLeft: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Svg>
);

export const IconClose: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Svg>
);

export const IconExternal: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
);

export const IconCheckCircle: Component<IconProps> = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9.25" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Svg>
);

export const IconAlert: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4.5" />
    <path d="M12 17.25h.01" />
  </Svg>
);

export const IconTrash: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M3.5 6h17" />
    <path d="M19 6v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8.5 6V4.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V6" />
    <path d="M10 11v5M14 11v5" />
  </Svg>
);

// ── Marker / structure glyphs (intuitive, replacing scholarly § ⌃ ⌄ ‖) ──────
export const IconPencil: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M12.5 5.5 16 9M4 20l1-4 11-11a2.1 2.1 0 0 1 3 3L8 19l-4 1Z" />
  </Svg>
);

export const IconPlus: Component<IconProps> = (props) => (
  <Svg {...props} stroke={props.stroke ?? 2.5}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconMinus: Component<IconProps> = (props) => (
  <Svg {...props} stroke={props.stroke ?? 2.5}>
    <path d="M5 12h14" />
  </Svg>
);

export const IconPauseBars: Component<IconProps> = (props) => (
  <Svg {...props} stroke={props.stroke ?? 2.2}>
    <path d="M9 6v12M15 6v12" />
  </Svg>
);

export const IconImage: Component<IconProps> = (props) => (
  <Svg {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <circle cx="8.5" cy="8.5" r="1.6" />
    <path d="m21 15-4.5-4.5L6 21" />
  </Svg>
);

export const IconTable: Component<IconProps> = (props) => (
  <Svg {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <path d="M3 9h18M3 15h18M9 3v18" />
  </Svg>
);

export const IconList: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </Svg>
);

export const IconComment: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
  </Svg>
);

export const IconFile: Component<IconProps> = (props) => (
  <Svg {...props}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M18 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8l5 5v11a2 2 0 0 1-2 2Z" />
  </Svg>
);
