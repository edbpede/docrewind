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
import { createMemo, createSignal, For, Show } from "solid-js";
import { IconChart } from "@/components/common/icons";

import {
  formatCompactCount,
  formatDayLabel,
  formatDuration,
  formatHourLabel,
  formatSummaryStamp,
  strings,
  summaryAxisPercent,
  summaryCharCount,
  summaryEditPosition,
} from "@/lib/core/i18n/strings";
import {
  buildDayTicks,
  buildHourTicks,
  isShortSpan,
  linearTicks,
  nearestPoint,
  startOfDay,
} from "@/lib/core/summary/axis";
import type {
  DocumentSummary as DocumentSummaryData,
  SummaryPoint,
} from "@/lib/core/summary/derive";

export interface DocumentSummaryProps {
  readonly summary: DocumentSummaryData;
}

// ── Logical chart geometry (a fixed viewBox; CSS scales it to the container) ──
const VB_W = 1000;
const PAD_X = 18;
const PAD_TOP = 14;
const PAD_BOTTOM = 16;
const ACTIVITY_VB_H = 200;
const POSITION_VB_H = 360;
const MIN_LABEL_GAP_PCT = 7;
// Width of the Y-axis label gutter to the LEFT of each plot. Fixed (not a viewBox
// fraction) so it stays legible at any container width and so both charts' plot
// areas line up; sized to fit the longest label ("Start of doc"/"End of doc").
const Y_AXIS_W = "4.75rem";
// Normalized edit-position gridlines for the scatter's Y axis (top = doc start).
const POSITION_TICKS = [0, 0.25, 0.5, 0.75, 1] as const;
// Length of an X-axis tick mark below the baseline (logical viewBox units).
const X_TICK_LEN = 4;

const LENGTH_FILL = "var(--dr-brand-soft)";
const LENGTH_LINE = "var(--dr-brand)";
const ACTIVITY_FILL = "var(--dr-accent-strong)";
const POSITION_FILL = "var(--dr-ink-muted)";
const GRID_STROKE = "var(--dr-hairline)";
// The baseline + tick marks read as a real axis, a shade stronger than the grid.
const AXIS_STROKE = "var(--dr-hairline-strong)";
// Hover-scrub feedback: a crisp neutral playline mirrored across both charts, and
// the lifted ring color for the emphasized data point under the cursor.
const SCRUB_STROKE = "var(--dr-ink)";
const SCRUB_RING = "var(--dr-surface)";
const POSITION_LINE = "var(--dr-ink)";

interface DayTick {
  readonly t: number;
  /** Left offset as a percent of the container width (matches the SVG x mapping). */
  readonly pct: number;
  /** The precomputed axis label (a day or, for short spans, a clock time). */
  readonly label: string;
}

interface YTick {
  /** Vertical offset as a percent of the chart height (matches the SVG y mapping,
   *  so the gutter label lines up exactly with its in-SVG gridline). */
  readonly pct: number;
  /** The precomputed axis label (a char-count scale value, or a position percent). */
  readonly label: string;
}

/** Keep day-axis ticks from overprinting: drop any whose label would sit within
 *  `MIN_LABEL_GAP_PCT` of the previous kept one (the first is always kept). */
function spaceTicks<T extends { readonly pct: number }>(ticks: readonly T[]): T[] {
  const out: T[] = [];
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
  const summary = () => props.summary;

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

  // Day-boundary ticks normally; hour-boundary ticks for a short single-session
  // span so the axis isn't one undivided band. Labels are precomputed — a granular
  // tick shows a clock time and re-shows the calendar day whenever it rolls over.
  const dayTicks = createMemo<readonly DayTick[]>(() => {
    const s = summary();
    if (!s.available) return [];
    const pctOf = (t: number): number => (xLogical(t) / VB_W) * 100;

    if (isShortSpan(s.startTime, s.endTime)) {
      const raw = buildHourTicks(s.startTime, s.endTime).map((t) => ({ t, pct: pctOf(t) }));
      const spaced = spaceTicks(raw.filter((tick) => tick.pct >= 1.5 && tick.pct <= 99.5));
      const base = spaced.length > 0 ? spaced : [{ t: s.startTime, pct: 0 }];
      let prevDay = Number.NaN;
      return base.map((tick, i) => {
        const day = startOfDay(tick.t);
        const withDate = i === 0 || day !== prevDay;
        prevDay = day;
        return { t: tick.t, pct: tick.pct, label: formatHourLabel(tick.t, withDate) };
      });
    }

    const all = buildDayTicks(s.startTime, s.endTime).map((t) => ({ t, pct: pctOf(t) }));
    // Drop the start-day midnight (a sliver clamped to the left edge) so its label
    // never overprints the first full day; the partial first day reads unlabeled,
    // as in the reference. Fall back to the start day for a sub-day span.
    const spaced = spaceTicks(all.filter((tick) => tick.pct >= 1.5));
    const base = spaced.length > 0 ? spaced : [{ t: s.startTime, pct: 0 }];
    return base.map((tick) => ({ t: tick.t, pct: tick.pct, label: formatDayLabel(tick.t) }));
  });

  // ── Activity chart geometry (length area + activity strip) ──────────────────
  const activityBaseY = ACTIVITY_VB_H - PAD_BOTTOM;
  const activityInnerH = ACTIVITY_VB_H - PAD_TOP - PAD_BOTTOM;
  const activityDotY = activityBaseY - 6;
  // Length axis: a tidy rounded ceiling (≥ peak length, with a little headroom) and
  // the gridline values from 0 up to it — so the chart shows a readable SCALE, not
  // only its peak. `lengthY` scales against that ceiling.
  const lengthAxis = createMemo(() => linearTicks(summary().maxLength, 4));
  const lengthY = (length: number): number => {
    const denom = Math.max(lengthAxis().axisMax, 1);
    return activityBaseY - (length / denom) * activityInnerH;
  };
  const activityYTicks = createMemo<readonly YTick[]>(() =>
    lengthAxis().ticks.map((v) => ({
      pct: (lengthY(v) / ACTIVITY_VB_H) * 100,
      label: formatCompactCount(v),
    })),
  );

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
  // Position axis: a 0–100% scale read top→bottom (doc start → doc end). The two
  // ends keep their plain-language captions; the interior quartiles read as percent.
  const positionYTicks = createMemo<readonly YTick[]>(() =>
    POSITION_TICKS.map((p) => ({
      pct: (positionY(p) / POSITION_VB_H) * 100,
      label:
        p === 0
          ? strings.summary.axisDocStart
          : p === 1
            ? strings.summary.axisDocEnd
            : summaryAxisPercent(p),
    })),
  );

  // ── Shared hover scrub (cross-chart correlation) ────────────────────────────
  // One signal feeds the scrub line on BOTH charts; `hoverChart` only decides
  // which chart floats the tooltip. The pointer handlers live on the chart
  // wrappers (not per-point), so the cost is independent of the revision count —
  // even a few thousand revisions stay one cheap binary search per pointer move.
  const [hover, setHover] = createSignal<SummaryPoint | null>(null);
  const [hoverChart, setHoverChart] = createSignal<"activity" | "position" | null>(null);
  const hoverPct = (): number => {
    const p = hover();
    return p === null ? 0 : (xLogical(p.t) / VB_W) * 100;
  };
  const moveHover = (chart: "activity" | "position", clientX: number, rect: DOMRect): void => {
    const s = summary();
    if (!s.available || rect.width <= 0) return;
    const fx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const targetT = s.startTime + fx * (s.endTime - s.startTime);
    const point = nearestPoint(s.series, targetT);
    if (point !== null) {
      setHover(point);
      setHoverChart(chart);
    }
  };
  const clearHover = (): void => {
    setHover(null);
    setHoverChart(null);
  };

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
                // <dt> before <dd> for valid definition-list semantics; the
                // flex-col-reverse keeps the big value visually on top (matching
                // SummaryInsights). Avoids the shared `dr-stat` shortcut, which is
                // plain flex-col and would render value-below.
                <div class="flex flex-col-reverse gap-0.5">
                  <dt class="dr-stat-label">{stat.label}</dt>
                  <dd class="dr-stat-value">{stat.value}</dd>
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
          <div class="flex">
            <YAxis ticks={activityYTicks()} />
            <div
              class="relative min-w-0 flex-1"
              data-chart="activity"
              onPointerMove={(e) =>
                moveHover("activity", e.clientX, e.currentTarget.getBoundingClientRect())
              }
              onPointerLeave={clearHover}
            >
              <svg
                role="img"
                aria-label={strings.summary.activityAria}
                viewBox={`0 0 ${VB_W} ${ACTIVITY_VB_H}`}
                style={{ width: "100%", height: "auto", display: "block" }}
              >
                {/* Horizontal length gridlines — the Y scale. */}
                <For each={lengthAxis().ticks}>
                  {(v) => (
                    <line
                      x1={PAD_X}
                      y1={lengthY(v)}
                      x2={VB_W - PAD_X}
                      y2={lengthY(v)}
                      style={{
                        stroke: GRID_STROKE,
                        "stroke-width": "1",
                        "stroke-dasharray": "2 5",
                      }}
                    />
                  )}
                </For>
                {/* Vertical time gridlines. */}
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
                {/* X-axis baseline + tick marks. */}
                <line
                  x1={PAD_X}
                  y1={activityBaseY}
                  x2={VB_W - PAD_X}
                  y2={activityBaseY}
                  style={{ stroke: AXIS_STROKE, "stroke-width": "1" }}
                />
                <For each={dayTicks()}>
                  {(tick) => (
                    <Show when={tick.pct > 0.5 && tick.pct < 99.5}>
                      <line
                        x1={xLogical(tick.t)}
                        y1={activityBaseY}
                        x2={xLogical(tick.t)}
                        y2={activityBaseY + X_TICK_LEN}
                        style={{ stroke: AXIS_STROKE, "stroke-width": "1" }}
                      />
                    </Show>
                  )}
                </For>
                <Show when={hover()}>
                  {(point) => (
                    <>
                      <line
                        data-scrub
                        x1={xLogical(point().t)}
                        y1={PAD_TOP}
                        x2={xLogical(point().t)}
                        y2={activityBaseY}
                        style={{
                          stroke: SCRUB_STROKE,
                          "stroke-width": "1.2",
                          "stroke-opacity": "0.4",
                        }}
                      />
                      <circle
                        cx={xLogical(point().t)}
                        cy={lengthY(point().length)}
                        r="3.6"
                        style={{ fill: LENGTH_LINE, stroke: SCRUB_RING, "stroke-width": "1.5" }}
                      />
                    </>
                  )}
                </Show>
              </svg>
              <Show when={hoverChart() === "activity" && hover()}>
                {(point) => (
                  <div
                    class="dr-sum-tip"
                    style={{ left: `${hoverPct()}%`, transform: labelTransform(hoverPct()) }}
                  >
                    <span class="dr-sum-tip-title">{formatSummaryStamp(point().t)}</span>
                    <span class="dr-sum-tip-detail">{summaryCharCount(point().length)}</span>
                    <Show when={point().pos >= 0}>
                      <span class="dr-sum-tip-detail">{summaryEditPosition(point().pos)}</span>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
          </div>
          <XAxis ticks={dayTicks()} />
        </section>

        {/* Where in the document were the changes: edit-position scatter. */}
        <section class="dr-card">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 class="dr-heading">{strings.summary.positionHeading}</h2>
            <div class="flex items-center gap-4">
              <LegendSwatch color={POSITION_FILL} label={strings.summary.legendPosition} />
            </div>
          </div>
          <div class="flex">
            <YAxis ticks={positionYTicks()} />
            <div
              class="relative min-w-0 flex-1"
              data-chart="position"
              onPointerMove={(e) =>
                moveHover("position", e.clientX, e.currentTarget.getBoundingClientRect())
              }
              onPointerLeave={clearHover}
            >
              <svg
                role="img"
                aria-label={strings.summary.positionAria}
                viewBox={`0 0 ${VB_W} ${POSITION_VB_H}`}
                style={{ width: "100%", height: "auto", display: "block" }}
              >
                {/* Horizontal position gridlines — the Y scale (start → end). */}
                <For each={POSITION_TICKS}>
                  {(p) => (
                    <line
                      x1={PAD_X}
                      y1={positionY(p)}
                      x2={VB_W - PAD_X}
                      y2={positionY(p)}
                      style={{
                        stroke: GRID_STROKE,
                        "stroke-width": "1",
                        "stroke-dasharray": "2 5",
                      }}
                    />
                  )}
                </For>
                {/* Vertical time gridlines. */}
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
                {/* X-axis baseline + tick marks. */}
                <line
                  x1={PAD_X}
                  y1={POSITION_VB_H - PAD_BOTTOM}
                  x2={VB_W - PAD_X}
                  y2={POSITION_VB_H - PAD_BOTTOM}
                  style={{ stroke: AXIS_STROKE, "stroke-width": "1" }}
                />
                <For each={dayTicks()}>
                  {(tick) => (
                    <Show when={tick.pct > 0.5 && tick.pct < 99.5}>
                      <line
                        x1={xLogical(tick.t)}
                        y1={POSITION_VB_H - PAD_BOTTOM}
                        x2={xLogical(tick.t)}
                        y2={POSITION_VB_H - PAD_BOTTOM + X_TICK_LEN}
                        style={{ stroke: AXIS_STROKE, "stroke-width": "1" }}
                      />
                    </Show>
                  )}
                </For>
                <Show when={hover()}>
                  {(point) => (
                    <>
                      <line
                        data-scrub
                        x1={xLogical(point().t)}
                        y1={PAD_TOP}
                        x2={xLogical(point().t)}
                        y2={POSITION_VB_H - PAD_BOTTOM}
                        style={{
                          stroke: SCRUB_STROKE,
                          "stroke-width": "1.2",
                          "stroke-opacity": "0.4",
                        }}
                      />
                      <Show when={point().pos >= 0}>
                        <circle
                          cx={xLogical(point().t)}
                          cy={positionY(point().pos)}
                          r="3.6"
                          style={{ fill: POSITION_LINE, stroke: SCRUB_RING, "stroke-width": "1.5" }}
                        />
                      </Show>
                    </>
                  )}
                </Show>
              </svg>
              <Show when={hoverChart() === "position" && hover()}>
                {(point) => (
                  <div
                    class="dr-sum-tip"
                    style={{ left: `${hoverPct()}%`, transform: labelTransform(hoverPct()) }}
                  >
                    <span class="dr-sum-tip-title">{formatSummaryStamp(point().t)}</span>
                    <span class="dr-sum-tip-detail">{summaryCharCount(point().length)}</span>
                    <Show when={point().pos >= 0}>
                      <span class="dr-sum-tip-detail">{summaryEditPosition(point().pos)}</span>
                    </Show>
                  </div>
                )}
              </Show>
            </div>
          </div>
          <XAxis ticks={dayTicks()} />
        </section>
      </div>
    </Show>
  );
};

/** The shared axis label row beneath a chart, aligned to its gridlines. Labels are
 *  precomputed per tick (a calendar day, or a clock time for short-span docs). */
const DayAxis: Component<{ readonly ticks: readonly DayTick[] }> = (props) => (
  <div class="relative" style={{ height: "1.25rem", "margin-top": "0.25rem", overflow: "hidden" }}>
    <For each={props.ticks}>
      {(tick) => (
        <span
          data-axis-tick
          class="text-ink-muted"
          style={{
            position: "absolute",
            left: `${Math.min(100, Math.max(0, tick.pct))}%`,
            transform: labelTransform(tick.pct),
            "white-space": "nowrap",
            "font-size": "0.6875rem",
          }}
        >
          {tick.label}
        </span>
      )}
    </For>
  </div>
);

/** The Y-axis label column to the LEFT of a chart. Each label is positioned by
 *  percent of the chart height so it lines up exactly with its in-SVG gridline; the
 *  fixed column width keeps both charts' plot areas aligned. */
const YAxis: Component<{ readonly ticks: readonly YTick[] }> = (props) => (
  <div class="relative shrink-0" style={{ width: Y_AXIS_W }}>
    <For each={props.ticks}>
      {(tick) => (
        <span
          data-yaxis-tick
          class="dr-sum-axis"
          style={{
            top: `${Math.min(100, Math.max(0, tick.pct))}%`,
            right: "0.5rem",
            transform: "translateY(-50%)",
            "font-variant-numeric": "tabular-nums",
          }}
        >
          {tick.label}
        </span>
      )}
    </For>
  </div>
);

/** The X-axis label row, indented by the Y-axis gutter so its day/time labels sit
 *  under the plot (not under the Y labels) and stay aligned with the gridlines. */
const XAxis: Component<{ readonly ticks: readonly DayTick[] }> = (props) => (
  <div class="flex">
    <div class="shrink-0" style={{ width: Y_AXIS_W }} aria-hidden="true" />
    <div class="relative min-w-0 flex-1">
      <DayAxis ticks={props.ticks} />
    </div>
  </div>
);

export default DocumentSummary;
