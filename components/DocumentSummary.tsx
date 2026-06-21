// SPDX-License-Identifier: AGPL-3.0-or-later
//
// DocumentSummary — the "advanced view" linked from the replay page. Two
// content-free visualizations over the decoded revisions (no document text):
//
//   1. "Timeline of activity" — an area of the document's LENGTH over time with
//      an overlaid strip of editing ACTIVITY marks (one per timed revision).
//   2. "Where in the document were the changes?" — a scatter of each edit's
//      POSITION in the document over time.
//
// Rendering is plain hand-built inline SVG (no chart dependency → honors the
// local-first / no-network promise and keeps the bundle small). Geometry lives in
// a fixed logical 1000-wide viewBox scaled to the container via CSS, so circles
// stay round and the layout is fully deterministic (jsdom-testable). The plotted
// series is already capped + down-sampled by `deriveDocumentSummary`, so even a
// multi-thousand-revision document draws a bounded, lightweight SVG.
//
// Colors come from the semantic `--dr-*` variables (set inline so they theme with
// the page and never depend on an on-demand color utility being generated): the
// document length reads in the brand indigo tint, activity in the honey accent,
// and edit positions in neutral graphite — color always paired with a legend.
//
// Solid idioms: `props.x` (never destructured), `class` (never `className`),
// `<For>`/`<Show>` over `.map()`/ternaries; components run once, signals read in JSX.

import type { Component } from "solid-js";
import { createMemo, For, Show } from "solid-js";
import { IconChart } from "@/components/icons";
import type { DecodedRevision } from "@/lib/domain/model";
import { formatDayLabel, formatDuration, strings } from "@/lib/i18n/strings";
import { deriveDocumentSummary, type SummaryPoint } from "@/lib/summary/derive";

export interface DocumentSummaryProps {
  readonly revisions: readonly DecodedRevision[];
}

// ── Logical chart geometry (a fixed viewBox; CSS scales it to the container) ──
const VB_W = 1000;
const PAD_X = 18;
const PAD_TOP = 14;
const PAD_BOTTOM = 16;
const ACTIVITY_VB_H = 200;
const POSITION_VB_H = 360;
const MIN_LABEL_GAP_PCT = 7;
const ONE_DAY_MS = 86_400_000;

const LENGTH_FILL = "var(--dr-brand-soft)";
const LENGTH_LINE = "var(--dr-brand)";
const ACTIVITY_FILL = "var(--dr-accent-strong)";
const POSITION_FILL = "var(--dr-ink-muted)";
const GRID_STROKE = "var(--dr-hairline)";

interface DayTick {
  readonly t: number;
  /** Left offset as a percent of the container width (matches the SVG x mapping). */
  readonly pct: number;
}

/** Day-boundary ticks (local midnights) spanning [start, end], thinned to a
 *  readable count. The first tick is the midnight of the start day (≤ start), so
 *  it anchors the leftmost label. Uses local time deliberately — a teacher reads
 *  "Sat, Oct 18" in their own timezone. */
function buildDayTicks(start: number, end: number): readonly number[] {
  if (!(end > start)) return [];
  const ticks: number[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  // Guard against pathological spans (the loop is also bounded by `end`).
  const maxIterations = Math.min(800, Math.ceil((end - start) / ONE_DAY_MS) + 4);
  for (let i = 0; i <= maxIterations; i++) {
    const ms = cursor.getTime();
    if (ms > end) break;
    ticks.push(ms);
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return ticks;
}

/** Keep day-axis ticks from overprinting: drop any whose label would sit within
 *  `MIN_LABEL_GAP_PCT` of the previous kept one (the first is always kept). */
function spaceTicks(ticks: readonly DayTick[]): DayTick[] {
  const out: DayTick[] = [];
  for (const tick of ticks) {
    const last = out[out.length - 1];
    if (last === undefined || tick.pct - last.pct >= MIN_LABEL_GAP_PCT) {
      out.push(tick);
    }
  }
  return out;
}

/** Horizontal label anchoring so edge labels never clip the chart frame. */
function labelTransform(pct: number): string {
  if (pct <= 6) return "translateX(0)";
  if (pct >= 94) return "translateX(-100%)";
  return "translateX(-50%)";
}

/** A small colored legend swatch + label, color set inline (theme-safe). */
const LegendSwatch: Component<{ readonly color: string; readonly label: string }> = (props) => (
  <span
    class="inline-flex items-center gap-1.5 text-ink-muted"
    style={{ "font-size": "0.8125rem" }}
  >
    <span
      aria-hidden="true"
      style={{
        width: "0.75rem",
        height: "0.75rem",
        "border-radius": "3px",
        "background-color": props.color,
        display: "inline-block",
      }}
    />
    {props.label}
  </span>
);

const DocumentSummary: Component<DocumentSummaryProps> = (props) => {
  const summary = createMemo(() => deriveDocumentSummary(props.revisions));

  const stats = createMemo(() => {
    const s = summary();
    return [
      { key: "edits", label: strings.summary.statEdits, value: s.totalRevisions.toLocaleString() },
      {
        key: "added",
        label: strings.summary.statAdded,
        value: s.charsInserted.toLocaleString(),
      },
      {
        key: "removed",
        label: strings.summary.statRemoved,
        value: s.charsDeleted.toLocaleString(),
      },
      {
        key: "span",
        label: strings.summary.statSpan,
        value: s.available
          ? formatDuration(s.endTime - s.startTime)
          : strings.insights.durationUnknown,
      },
    ];
  });

  // Shared x mapping (logical units) + day ticks projected to container percent.
  const xLogical = (t: number): number => {
    const s = summary();
    const span = s.endTime - s.startTime;
    if (span <= 0) return PAD_X;
    return PAD_X + ((t - s.startTime) / span) * (VB_W - 2 * PAD_X);
  };

  const dayTicks = createMemo<readonly DayTick[]>(() => {
    const s = summary();
    if (!s.available) return [];
    const all = buildDayTicks(s.startTime, s.endTime).map((t) => ({
      t,
      pct: (xLogical(t) / VB_W) * 100,
    }));
    // Drop the start-day midnight (a sliver clamped to the left edge) so its label
    // never overprints the first full day; the partial first day reads unlabeled,
    // as in the reference. Fall back to the start day for a sub-day span.
    const spaced = spaceTicks(all.filter((tick) => tick.pct >= 1.5));
    return spaced.length > 0 ? spaced : [{ t: s.startTime, pct: 0 }];
  });

  // ── Activity chart geometry (length area + activity strip) ──────────────────
  const activityBaseY = ACTIVITY_VB_H - PAD_BOTTOM;
  const activityInnerH = ACTIVITY_VB_H - PAD_TOP - PAD_BOTTOM;
  const activityDotY = activityBaseY - 6;
  const lengthY = (length: number): number => {
    const denom = Math.max(summary().maxLength, 1);
    return activityBaseY - (length / denom) * activityInnerH;
  };

  const areaPath = createMemo(() => {
    const series = summary().series;
    if (series.length === 0) return "";
    const first = series[0];
    const last = series[series.length - 1];
    if (first === undefined || last === undefined) return "";
    let d = `M ${xLogical(first.t).toFixed(2)} ${activityBaseY.toFixed(2)}`;
    for (const p of series) {
      d += ` L ${xLogical(p.t).toFixed(2)} ${lengthY(p.length).toFixed(2)}`;
    }
    d += ` L ${xLogical(last.t).toFixed(2)} ${activityBaseY.toFixed(2)} Z`;
    return d;
  });

  const topLinePath = createMemo(() => {
    const series = summary().series;
    return series
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"} ${xLogical(p.t).toFixed(2)} ${lengthY(p.length).toFixed(2)}`,
      )
      .join(" ");
  });

  // ── Position chart geometry (edit position scatter) ─────────────────────────
  const positionInnerH = POSITION_VB_H - PAD_TOP - PAD_BOTTOM;
  const positionY = (pos: number): number => PAD_TOP + pos * positionInnerH;
  const scatter = createMemo<readonly SummaryPoint[]>(() =>
    summary().series.filter((p) => p.pos >= 0),
  );

  return (
    <Show
      when={summary().available}
      fallback={
        <section class="dr-card flex flex-col items-center gap-3 py-10 text-center">
          <span class="text-ink-muted">
            <IconChart size={32} />
          </span>
          <h2 class="dr-heading">{strings.summary.unavailableTitle}</h2>
          <p class="text-ink-muted" style={{ "max-width": "32rem" }}>
            {strings.summary.unavailableHint}
          </p>
        </section>
      }
    >
      <div class="flex flex-col gap-6">
        {/* At-a-glance figures. */}
        <section class="dr-card">
          <dl class="flex flex-wrap gap-x-10 gap-y-5">
            <For each={stats()}>
              {(stat) => (
                <div class="dr-stat">
                  <dd class="dr-stat-value">{stat.value}</dd>
                  <dt class="dr-stat-label">{stat.label}</dt>
                </div>
              )}
            </For>
          </dl>
        </section>

        {/* Timeline of activity: document length area + activity strip. */}
        <section class="dr-card">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 class="dr-heading">{strings.summary.activityHeading}</h2>
            <div class="flex items-center gap-4">
              <LegendSwatch color={LENGTH_FILL} label={strings.summary.legendLength} />
              <LegendSwatch color={ACTIVITY_FILL} label={strings.summary.legendActivity} />
            </div>
          </div>
          <div class="relative">
            <svg
              role="img"
              aria-label={strings.summary.activityAria}
              viewBox={`0 0 ${VB_W} ${ACTIVITY_VB_H}`}
              style={{ width: "100%", height: "auto", display: "block" }}
            >
              <For each={dayTicks()}>
                {(tick) => (
                  <Show when={tick.pct > 0.5 && tick.pct < 99.5}>
                    <line
                      x1={xLogical(tick.t)}
                      y1={PAD_TOP}
                      x2={xLogical(tick.t)}
                      y2={activityBaseY}
                      style={{
                        stroke: GRID_STROKE,
                        "stroke-width": "1",
                        "stroke-dasharray": "2 5",
                      }}
                    />
                  </Show>
                )}
              </For>
              <path d={areaPath()} style={{ fill: LENGTH_FILL, "fill-opacity": "0.9" }} />
              <path
                d={topLinePath()}
                style={{
                  fill: "none",
                  stroke: LENGTH_LINE,
                  "stroke-width": "1.5",
                  "stroke-opacity": "0.5",
                  "stroke-linejoin": "round",
                }}
              />
              <For each={summary().series}>
                {(p) => (
                  <circle
                    cx={xLogical(p.t)}
                    cy={activityDotY}
                    r="2.8"
                    style={{ fill: ACTIVITY_FILL, "fill-opacity": "0.7" }}
                  />
                )}
              </For>
            </svg>
            <DayAxis ticks={dayTicks()} />
          </div>
        </section>

        {/* Where in the document were the changes: edit-position scatter. */}
        <section class="dr-card">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 class="dr-heading">{strings.summary.positionHeading}</h2>
            <div class="flex items-center gap-4">
              <LegendSwatch color={POSITION_FILL} label={strings.summary.legendPosition} />
            </div>
          </div>
          <div class="relative">
            <svg
              role="img"
              aria-label={strings.summary.positionAria}
              viewBox={`0 0 ${VB_W} ${POSITION_VB_H}`}
              style={{ width: "100%", height: "auto", display: "block" }}
            >
              <For each={dayTicks()}>
                {(tick) => (
                  <Show when={tick.pct > 0.5 && tick.pct < 99.5}>
                    <line
                      x1={xLogical(tick.t)}
                      y1={PAD_TOP}
                      x2={xLogical(tick.t)}
                      y2={POSITION_VB_H - PAD_BOTTOM}
                      style={{
                        stroke: GRID_STROKE,
                        "stroke-width": "1",
                        "stroke-dasharray": "2 5",
                      }}
                    />
                  </Show>
                )}
              </For>
              <For each={scatter()}>
                {(p) => (
                  <circle
                    cx={xLogical(p.t)}
                    cy={positionY(p.pos)}
                    r="2.8"
                    style={{ fill: POSITION_FILL, "fill-opacity": "0.5" }}
                  />
                )}
              </For>
            </svg>
            <DayAxis ticks={dayTicks()} />
          </div>
        </section>
      </div>
    </Show>
  );
};

/** The shared day-boundary label row beneath a chart, aligned to its gridlines. */
const DayAxis: Component<{ readonly ticks: readonly DayTick[] }> = (props) => (
  <div class="relative" style={{ height: "1.25rem", "margin-top": "0.25rem", overflow: "hidden" }}>
    <For each={props.ticks}>
      {(tick) => (
        <span
          class="text-ink-muted"
          style={{
            position: "absolute",
            left: `${Math.min(100, Math.max(0, tick.pct))}%`,
            transform: labelTransform(tick.pct),
            "white-space": "nowrap",
            "font-size": "0.6875rem",
          }}
        >
          {formatDayLabel(tick.t)}
        </span>
      )}
    </For>
  </div>
);

export default DocumentSummary;
