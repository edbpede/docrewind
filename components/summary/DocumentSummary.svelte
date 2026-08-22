<script module lang="ts">
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
  // Svelte idioms: runes (`$props`/`$state`/`$derived`), `class` (never
  // `className`), `{#each}`/`{#if}` over `.map()`/ternaries. Svelte's `style`
  // attribute takes a STRING, not the object Solid accepted, so every inline style
  // here — including the ~25 on SVG elements — is written as `style:` directives,
  // which work in the SVG namespace exactly as they do in HTML.
  //
  // Svelte allows one component per file, so the legend swatch and the two axis
  // gutters are siblings; the X-axis row, used only here and only twice, stays a
  // local snippet.

  // ── Logical chart geometry (a fixed viewBox; CSS scales it to the container) ──
  const VB_W = 1000;
  const PAD_X = 18;
  const PAD_TOP = 14;
  const PAD_BOTTOM = 16;
  const ACTIVITY_VB_H = 200;
  const POSITION_VB_H = 360;
  const MIN_LABEL_GAP_PCT = 7;
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

  // ── Activity chart geometry (length area + activity strip) ──────────────────
  const activityBaseY = ACTIVITY_VB_H - PAD_BOTTOM;
  const activityInnerH = ACTIVITY_VB_H - PAD_TOP - PAD_BOTTOM;
  const activityDotY = activityBaseY - 6;

  // ── Position chart geometry (edit position scatter) ─────────────────────────
  const positionInnerH = POSITION_VB_H - PAD_TOP - PAD_BOTTOM;
  const positionY = (pos: number): number => PAD_TOP + pos * positionInnerH;

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
</script>

<script lang="ts">
  import { IconChart } from "@/components/common/icons";
  import DayAxis, { type DayTick, labelTransform } from "./DayAxis.svelte";
  import LegendSwatch from "./LegendSwatch.svelte";
  import YAxis, { Y_AXIS_W, type YTick } from "./YAxis.svelte";

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

  let { summary }: DocumentSummaryProps = $props();

  const stats = $derived.by(() => {
    const s = summary;
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
    const s = summary;
    const span = s.endTime - s.startTime;
    if (span <= 0) return PAD_X;
    return PAD_X + ((t - s.startTime) / span) * (VB_W - 2 * PAD_X);
  };

  // Day-boundary ticks normally; hour-boundary ticks for a short single-session
  // span so the axis isn't one undivided band. Labels are precomputed — a granular
  // tick shows a clock time and re-shows the calendar day whenever it rolls over.
  const dayTicks: readonly DayTick[] = $derived.by(() => {
    const s = summary;
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

  // Length axis: a tidy rounded ceiling (≥ peak length, with a little headroom) and
  // the gridline values from 0 up to it — so the chart shows a readable SCALE, not
  // only its peak. `lengthY` scales against that ceiling.
  const lengthAxis = $derived(linearTicks(summary.maxLength, 4));
  const lengthY = (length: number): number => {
    const denom = Math.max(lengthAxis.axisMax, 1);
    return activityBaseY - (length / denom) * activityInnerH;
  };
  const activityYTicks: readonly YTick[] = $derived(
    lengthAxis.ticks.map((v) => ({
      pct: (lengthY(v) / ACTIVITY_VB_H) * 100,
      label: formatCompactCount(v),
    })),
  );

  const areaPath = $derived.by(() => {
    const series = summary.series;
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

  const topLinePath = $derived.by(() =>
    summary.series
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"} ${xLogical(p.t).toFixed(2)} ${lengthY(p.length).toFixed(2)}`,
      )
      .join(" "),
  );

  const scatter: readonly SummaryPoint[] = $derived(summary.series.filter((p) => p.pos >= 0));
  // Position axis: a 0–100% scale read top→bottom (doc start → doc end). The two
  // ends keep their plain-language captions; the interior quartiles read as percent.
  const positionYTicks: readonly YTick[] = $derived(
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
  // One piece of state feeds the scrub line on BOTH charts; `hoverChart` only
  // decides which chart floats the tooltip. The pointer handlers live on the chart
  // wrappers (not per-point), so the cost is independent of the revision count —
  // even a few thousand revisions stay one cheap binary search per pointer move.
  let hover = $state<SummaryPoint | null>(null);
  let hoverChart = $state<"activity" | "position" | null>(null);
  const hoverPct = (): number => (hover === null ? 0 : (xLogical(hover.t) / VB_W) * 100);
  const moveHover = (chart: "activity" | "position", clientX: number, rect: DOMRect): void => {
    const s = summary;
    if (!s.available || rect.width <= 0) return;
    const fx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const targetT = s.startTime + fx * (s.endTime - s.startTime);
    const point = nearestPoint(s.series, targetT);
    if (point !== null) {
      hover = point;
      hoverChart = chart;
    }
  };
  const clearHover = (): void => {
    hover = null;
    hoverChart = null;
  };
</script>

<!-- The X-axis label row, indented by the Y-axis gutter so its day/time labels sit
     under the plot (not under the Y labels) and stay aligned with the gridlines.
     A local snippet rather than a sibling component: it is pure layout, used only
     here and only by the two charts below. -->
{#snippet xAxis(ticks: readonly DayTick[])}
  <div class="flex">
    <div class="shrink-0" style:width={Y_AXIS_W} aria-hidden="true"></div>
    <div class="relative min-w-0 flex-1">
      <DayAxis {ticks} />
    </div>
  </div>
{/snippet}

{#if summary.available}
  <div class="flex flex-col gap-6">
    <!-- At-a-glance figures. -->
    <section class="dr-card">
      <dl class="flex flex-wrap gap-x-10 gap-y-5">
        <!-- Keyed by `stat.key`: four hand-written literals ("edits" / "added" /
             "removed" / "span"), verified unique by inspection. -->
        {#each stats as stat (stat.key)}
          <!-- <dt> before <dd> for valid definition-list semantics; the
               flex-col-reverse keeps the big value visually on top (matching
               SummaryInsights). Avoids the shared `dr-stat` shortcut, which is
               plain flex-col and would render value-below. -->
          <div class="flex flex-col-reverse gap-0.5">
            <dt class="dr-stat-label">{stat.label}</dt>
            <dd class="dr-stat-value">{stat.value}</dd>
          </div>
        {/each}
      </dl>
    </section>

    <!-- Timeline of activity: document length area + activity strip. -->
    <section class="dr-card">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 class="dr-heading">{strings.summary.activityHeading}</h2>
        <div class="flex items-center gap-4">
          <LegendSwatch color={LENGTH_FILL} label={strings.summary.legendLength} />
          <LegendSwatch color={ACTIVITY_FILL} label={strings.summary.legendActivity} />
        </div>
      </div>
      <div class="flex">
        <YAxis ticks={activityYTicks} />
        <!-- The pointer handlers drive a purely decorative hover scrub: the chart
             itself is the named, non-interactive element (`role="img"` + `aria-label`
             on the <svg> inside), and every number the tooltip surfaces is already
             in the axis gutters, so there is no keyboard-reachable affordance to
             add here and no information available only on hover. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="relative min-w-0 flex-1"
          data-chart="activity"
          onpointermove={(e) =>
            moveHover("activity", e.clientX, e.currentTarget.getBoundingClientRect())}
          onpointerleave={clearHover}
        >
          <svg
            role="img"
            aria-label={strings.summary.activityAria}
            viewBox={`0 0 ${VB_W} ${ACTIVITY_VB_H}`}
            style:width="100%"
            style:height="auto"
            style:display="block"
          >
            <!-- Horizontal length gridlines — the Y scale. -->
            <!-- Keyed by INDEX: tick values can repeat after rounding (§6.1b). -->
            {#each lengthAxis.ticks as v, i (i)}
              <line
                x1={PAD_X}
                y1={lengthY(v)}
                x2={VB_W - PAD_X}
                y2={lengthY(v)}
                style:stroke={GRID_STROKE}
                style:stroke-width="1"
                style:stroke-dasharray="2 5"
              />
            {/each}
            <!-- Vertical time gridlines. -->
            <!-- Keyed by INDEX: `spaceTicks()` can emit two ticks with equal `pct`. -->
            {#each dayTicks as tick, i (i)}
              {#if tick.pct > 0.5 && tick.pct < 99.5}
                <line
                  x1={xLogical(tick.t)}
                  y1={PAD_TOP}
                  x2={xLogical(tick.t)}
                  y2={activityBaseY}
                  style:stroke={GRID_STROKE}
                  style:stroke-width="1"
                  style:stroke-dasharray="2 5"
                />
              {/if}
            {/each}
            <path d={areaPath} style:fill={LENGTH_FILL} style:fill-opacity="0.9" />
            <path
              d={topLinePath}
              style:fill="none"
              style:stroke={LENGTH_LINE}
              style:stroke-width="1.5"
              style:stroke-opacity="0.5"
              style:stroke-linejoin="round"
            />
            <!-- Keyed by INDEX: chart points routinely repeat values (§6.1b). -->
            {#each summary.series as p, i (i)}
              <circle
                cx={xLogical(p.t)}
                cy={activityDotY}
                r="2.8"
                style:fill={ACTIVITY_FILL}
                style:fill-opacity="0.7"
              />
            {/each}
            <!-- X-axis baseline + tick marks. -->
            <line
              x1={PAD_X}
              y1={activityBaseY}
              x2={VB_W - PAD_X}
              y2={activityBaseY}
              style:stroke={AXIS_STROKE}
              style:stroke-width="1"
            />
            <!-- Keyed by INDEX: `spaceTicks()` can emit two ticks with equal `pct`. -->
            {#each dayTicks as tick, i (i)}
              {#if tick.pct > 0.5 && tick.pct < 99.5}
                <line
                  x1={xLogical(tick.t)}
                  y1={activityBaseY}
                  x2={xLogical(tick.t)}
                  y2={activityBaseY + X_TICK_LEN}
                  style:stroke={AXIS_STROKE}
                  style:stroke-width="1"
                />
              {/if}
            {/each}
            {#if hover !== null}
              {@const point = hover}
              <line
                data-scrub
                x1={xLogical(point.t)}
                y1={PAD_TOP}
                x2={xLogical(point.t)}
                y2={activityBaseY}
                style:stroke={SCRUB_STROKE}
                style:stroke-width="1.2"
                style:stroke-opacity="0.4"
              />
              <circle
                cx={xLogical(point.t)}
                cy={lengthY(point.length)}
                r="3.6"
                style:fill={LENGTH_LINE}
                style:stroke={SCRUB_RING}
                style:stroke-width="1.5"
              />
            {/if}
          </svg>
          {#if hoverChart === "activity" && hover !== null}
            {@const point = hover}
            <div
              class="dr-sum-tip"
              style:left={`${hoverPct()}%`}
              style:transform={labelTransform(hoverPct())}
            >
              <span class="dr-sum-tip-title">{formatSummaryStamp(point.t)}</span>
              <span class="dr-sum-tip-detail">{summaryCharCount(point.length)}</span>
              {#if point.pos >= 0}
                <span class="dr-sum-tip-detail">{summaryEditPosition(point.pos)}</span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
      {@render xAxis(dayTicks)}
    </section>

    <!-- Where in the document were the changes: edit-position scatter. -->
    <section class="dr-card">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 class="dr-heading">{strings.summary.positionHeading}</h2>
        <div class="flex items-center gap-4">
          <LegendSwatch color={POSITION_FILL} label={strings.summary.legendPosition} />
        </div>
      </div>
      <div class="flex">
        <YAxis ticks={positionYTicks} />
        <!-- The pointer handlers drive a purely decorative hover scrub: the chart
             itself is the named, non-interactive element (`role="img"` + `aria-label`
             on the <svg> inside), and every number the tooltip surfaces is already
             in the axis gutters, so there is no keyboard-reachable affordance to
             add here and no information available only on hover. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="relative min-w-0 flex-1"
          data-chart="position"
          onpointermove={(e) =>
            moveHover("position", e.clientX, e.currentTarget.getBoundingClientRect())}
          onpointerleave={clearHover}
        >
          <svg
            role="img"
            aria-label={strings.summary.positionAria}
            viewBox={`0 0 ${VB_W} ${POSITION_VB_H}`}
            style:width="100%"
            style:height="auto"
            style:display="block"
          >
            <!-- Horizontal position gridlines — the Y scale (start → end). -->
            <!-- Keyed by INDEX: a fixed tuple of numbers, no unique id (§6.1b). -->
            {#each POSITION_TICKS as p, i (i)}
              <line
                x1={PAD_X}
                y1={positionY(p)}
                x2={VB_W - PAD_X}
                y2={positionY(p)}
                style:stroke={GRID_STROKE}
                style:stroke-width="1"
                style:stroke-dasharray="2 5"
              />
            {/each}
            <!-- Vertical time gridlines. -->
            <!-- Keyed by INDEX: `spaceTicks()` can emit two ticks with equal `pct`. -->
            {#each dayTicks as tick, i (i)}
              {#if tick.pct > 0.5 && tick.pct < 99.5}
                <line
                  x1={xLogical(tick.t)}
                  y1={PAD_TOP}
                  x2={xLogical(tick.t)}
                  y2={POSITION_VB_H - PAD_BOTTOM}
                  style:stroke={GRID_STROKE}
                  style:stroke-width="1"
                  style:stroke-dasharray="2 5"
                />
              {/if}
            {/each}
            <!-- Keyed by INDEX: chart points routinely repeat values (§6.1b). -->
            {#each scatter as p, i (i)}
              <circle
                cx={xLogical(p.t)}
                cy={positionY(p.pos)}
                r="2.8"
                style:fill={POSITION_FILL}
                style:fill-opacity="0.5"
              />
            {/each}
            <!-- X-axis baseline + tick marks. -->
            <line
              x1={PAD_X}
              y1={POSITION_VB_H - PAD_BOTTOM}
              x2={VB_W - PAD_X}
              y2={POSITION_VB_H - PAD_BOTTOM}
              style:stroke={AXIS_STROKE}
              style:stroke-width="1"
            />
            <!-- Keyed by INDEX: `spaceTicks()` can emit two ticks with equal `pct`. -->
            {#each dayTicks as tick, i (i)}
              {#if tick.pct > 0.5 && tick.pct < 99.5}
                <line
                  x1={xLogical(tick.t)}
                  y1={POSITION_VB_H - PAD_BOTTOM}
                  x2={xLogical(tick.t)}
                  y2={POSITION_VB_H - PAD_BOTTOM + X_TICK_LEN}
                  style:stroke={AXIS_STROKE}
                  style:stroke-width="1"
                />
              {/if}
            {/each}
            {#if hover !== null}
              {@const point = hover}
              <line
                data-scrub
                x1={xLogical(point.t)}
                y1={PAD_TOP}
                x2={xLogical(point.t)}
                y2={POSITION_VB_H - PAD_BOTTOM}
                style:stroke={SCRUB_STROKE}
                style:stroke-width="1.2"
                style:stroke-opacity="0.4"
              />
              {#if point.pos >= 0}
                <circle
                  cx={xLogical(point.t)}
                  cy={positionY(point.pos)}
                  r="3.6"
                  style:fill={POSITION_LINE}
                  style:stroke={SCRUB_RING}
                  style:stroke-width="1.5"
                />
              {/if}
            {/if}
          </svg>
          {#if hoverChart === "position" && hover !== null}
            {@const point = hover}
            <div
              class="dr-sum-tip"
              style:left={`${hoverPct()}%`}
              style:transform={labelTransform(hoverPct())}
            >
              <span class="dr-sum-tip-title">{formatSummaryStamp(point.t)}</span>
              <span class="dr-sum-tip-detail">{summaryCharCount(point.length)}</span>
              {#if point.pos >= 0}
                <span class="dr-sum-tip-detail">{summaryEditPosition(point.pos)}</span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
      {@render xAxis(dayTicks)}
    </section>
  </div>
{:else}
  <section class="dr-card flex flex-col items-center gap-3 py-10 text-center">
    <span class="text-ink-muted">
      <IconChart size={32} />
    </span>
    <h2 class="dr-heading">{strings.summary.unavailableTitle}</h2>
    <p class="text-ink-muted" style:max-width="32rem">
      {strings.summary.unavailableHint}
    </p>
  </section>
{/if}
