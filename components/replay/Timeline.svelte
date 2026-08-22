<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Timeline scrubber (plan Phase 5 Step 5c) — the surface's signature element: a
  // writing-activity stratum with a vertical playhead caret. An ARIA slider with
  // full keyboard scrub (Arrow ±1, Home/End to bounds).
  //
  // Positioning note (scale-safety): the slider domain is APPLIED-COUNT [0, max]
  // — the same scale as `currentIndex` (which drives `modelAtRevisionIndex`). Event
  // markers therefore carry a precomputed applied-count `index`, mapped UPSTREAM in
  // the App from each event's wire `RevisionId` anchor (the App holds the revisions
  // array). The leaf never sees a `RevisionId`, so it cannot mix the two scales.
  //
  // Density note (collision stacking): seals are ~16px and many bursts anchor a
  // handful of events within a few revisions, so at the page's real width they
  // would pile into an unreadable clump. Marks whose pixel positions would collide
  // fuse into one STACKED SEAL bearing a count (see `clusterMarkers`); the burst
  // becomes legible signal instead of a pile. Stacking is measurement-driven — with
  // no measured width (jsdom / first paint) every mark renders on its own.
  //
  // The pure half of this file — clustering, tone classes, kind ordering, the seal's
  // accessible name and the two edge constants — lives in `./timeline-markers.ts` so
  // it stays unit-testable without the Svelte compiler; the kind→icon switch, which
  // returns markup, lives in `./MarkerIcon.svelte`.

  import { IconClose } from "@/components/common/icons";
  import { revisionOf, strings } from "@/lib/core/i18n/strings";
  import MarkerIcon from "./MarkerIcon.svelte";
  import {
    CLUSTER_KIND_LABEL,
    clusterAriaLabel,
    clusterBreakdownRows,
    clusterMarkers,
    clusterToneClass,
    EDGE_INSET_PX,
    markerToneClass,
    PLAYHEAD_REST_PX,
    summarizeCluster,
    type TimelineMarker,
  } from "./timeline-markers";

  export interface TimelineProps {
    readonly currentIndex: number;
    readonly max: number;
    readonly events: readonly TimelineMarker[];
    readonly onScrub: (index: number) => void;
  }

  const { currentIndex, max, events, onScrub }: TimelineProps = $props();

  // The track element. `$state` because `bind:this` writes it and an `$effect`
  // reads it to attach the ResizeObserver; a plain `let` would draw a
  // `non_reactive_update` warning. It is assigned once, during mount.
  let track: HTMLDivElement | undefined = $state();
  // NOT reactive: an in-flight pointer id, read and written only inside pointer
  // handlers. Making it `$state` would schedule renders on every drag frame.
  let activePointerId: number | null = null;

  const fraction = $derived(max > 0 ? currentIndex / max : 0);

  // Map an applied-count `index` to its physical left offset on the markers axis,
  // interpolating across the inset interior: index 0 lands at `EDGE_INSET_PX`,
  // index `max` at `100% − EDGE_INSET_PX`. Expressed as a `calc` so the safe area
  // is a fixed pixel width at any track size (rather than a width-relative %).
  const posPct = (index: number): string => {
    const frac = max > 0 ? Math.max(0, Math.min(1, index / max)) : 0;
    return `calc(${EDGE_INSET_PX}px + (100% - ${EDGE_INSET_PX * 2}px) * ${frac.toFixed(4)})`;
  };

  // The playhead nib's left offset. It rides the markers axis (`posPct`) for every
  // interior revision so a scrub lands it exactly on its marker, but RESTS in the
  // end margin at the two endpoints — parked before the first marker at revision 0,
  // after the last marker at `max` — so the nib never sits on top of a boundary seal.
  const thumbLeft = (index: number): string => {
    if (max <= 0 || index <= 0) {
      return `${PLAYHEAD_REST_PX}px`;
    }
    if (index >= max) {
      return `calc(100% - ${PLAYHEAD_REST_PX}px)`;
    }
    return posPct(index);
  };

  // The progress ramp begins at the index-0 axis anchor (left = EDGE_INSET_PX) and
  // its leading edge stays glued to the nib: across the interior it spans the usable
  // band; at `max` it extends the extra end margin out to the parked nib so the
  // filled ramp still meets it; at revision 0 it is empty.
  const fillWidth = $derived.by(() => {
    if (max <= 0 || currentIndex <= 0) {
      return "0px";
    }
    if (currentIndex >= max) {
      return `calc(100% - ${EDGE_INSET_PX + PLAYHEAD_REST_PX}px)`;
    }
    return `calc((100% - ${EDGE_INSET_PX * 2}px) * ${fraction.toFixed(4)})`;
  });

  // Measured track width feeds collision stacking. It stays 0 until layout is
  // observed (jsdom keeps it 0 unless a test mocks ResizeObserver), so stacking is
  // inert until there is a real width to collide against — clustering never fires
  // on a guessed geometry.
  let trackWidth = $state(0);
  $effect(() => {
    const el = track;
    if (el === undefined) {
      return;
    }
    trackWidth = el.getBoundingClientRect().width;
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      trackWidth = measured !== undefined && measured > 0 ? measured : el.getBoundingClientRect().width;
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  // Collision stacking runs in the SAME inset band the seals render into, so it
  // measures against the usable interior width, not the raw track width.
  const clusters = $derived(clusterMarkers(events, max, Math.max(0, trackWidth - EDGE_INSET_PX * 2)));

  // Hover/focus tooltip: a single popover, driven by the active cluster id, so the
  // seal itself stays a thin jump-to button. Set on enter/focus, cleared on
  // leave/blur — making the revision data reachable by pointer AND keyboard.
  let activeId = $state<string | null>(null);
  const activeCluster = $derived(
    activeId === null ? undefined : clusters.find((cluster) => cluster.id === activeId),
  );

  // Pinned expansion: clicking a stacked seal opens an interactive panel listing
  // every mark in the burst as a jump-row. The hover peek is a glance; this is the
  // reading. Only one panel is open at a time (the active stack's id), and the seal
  // is remembered so Escape can return focus to it after dismissal.
  let pinnedId = $state<string | null>(null);
  const pinnedCluster = $derived(
    pinnedId === null ? undefined : clusters.find((cluster) => cluster.id === pinnedId),
  );
  // `$state` because `bind:this` nulls it when the panel unmounts; it is read only
  // from event handlers, so it adds no reactive dependency.
  let panelEl: HTMLDivElement | undefined = $state();
  // NOT reactive: a plain remembered element, assigned from `event.currentTarget`
  // and read only when returning focus.
  let pinnedSealEl: HTMLButtonElement | undefined;

  function closePanel(refocus = false): void {
    pinnedId = null;
    if (refocus) {
      pinnedSealEl?.focus();
    }
  }

  // While a panel is pinned, a click anywhere outside it (and outside any seal) or
  // an Escape press dismisses it — the manuscript-margin equivalent of closing a
  // pulled card. Seal targets are spared so the seal's own click can toggle/switch.
  $effect(() => {
    if (pinnedId === null || typeof document === "undefined") {
      return;
    }
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Element | null;
      if (target && (target.closest("[data-tl-seal]") || panelEl?.contains(target))) {
        return;
      }
      closePanel();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closePanel(true);
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  });

  // Edge-aware horizontal anchoring: a centered popover near a track end would
  // spill off the page, so clamp to the seal's left/right edge in the margins.
  function tipTransform(index: number): string {
    const frac = max > 0 ? index / max : 0;
    if (frac <= 0.12) {
      return "translateX(0)";
    }
    if (frac >= 0.88) {
      return "translateX(-100%)";
    }
    return "translateX(-50%)";
  }

  function scrubFromClientX(clientX: number): void {
    if (track === undefined || max <= 0) {
      onScrub(0);
      return;
    }
    const rect = track.getBoundingClientRect();
    // Invert `posPct`: the usable band runs from EDGE_INSET_PX to width −
    // EDGE_INSET_PX, so a click anywhere in either safe-area margin clamps to the
    // nearest bound (index 0 / max) rather than reading as a fractional position.
    const usable = rect.width - EDGE_INSET_PX * 2;
    const ratio = usable > 0 ? (clientX - rect.left - EDGE_INSET_PX) / usable : 0;
    const next = Math.round(Math.max(0, Math.min(1, ratio)) * max);
    onScrub(next);
  }

  function onPointerDown(event: PointerEvent): void {
    closePanel(); // a scrub on the bare track dismisses any open detail panel
    activePointerId = event.pointerId;
    const target = event.currentTarget as HTMLDivElement;
    target.setPointerCapture(event.pointerId);
    scrubFromClientX(event.clientX);
  }

  function onPointerMove(event: PointerEvent): void {
    if (activePointerId !== event.pointerId) {
      return;
    }
    scrubFromClientX(event.clientX);
  }

  function endPointer(event: PointerEvent): void {
    if (activePointerId !== event.pointerId) {
      return;
    }
    activePointerId = null;
    const target = event.currentTarget as HTMLDivElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    let next: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        next = currentIndex - 1;
        break;
      case "ArrowRight":
      case "ArrowUp":
        next = currentIndex + 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    onScrub(Math.max(0, Math.min(next, max)));
  }
</script>

<div
  bind:this={track}
  class="tl-track"
  role="slider"
  tabindex="0"
  aria-label={strings.timeline.label}
  aria-valuemin={0}
  aria-valuemax={max}
  aria-valuenow={currentIndex}
  aria-valuetext={revisionOf(currentIndex, max)}
  onkeydown={onKeyDown}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={endPointer}
  onpointercancel={endPointer}
>
  <div class="tl-fill" style:left="{EDGE_INSET_PX}px" style:width={fillWidth}></div>
  <!-- Clusters partition a position-sorted list, so the joined member-id string is
       distinct per cluster and safe as a key. (The MEMBER ids inside a cluster are
       NOT — see the panel list below.) -->
  {#each clusters as cluster (cluster.id)}
    {@const single = cluster.members.length === 1 ? cluster.members[0] : undefined}
    {@const ariaLabel = clusterAriaLabel(cluster, max)}
    {@const count = cluster.members.length}
    <button
      type="button"
      class={single === undefined
        ? `tl-cluster ${clusterToneClass(cluster)}`
        : `tl-marker ${markerToneClass(single.kind)} p-0`}
      style:left={posPct(cluster.index)}
      aria-label={ariaLabel}
      aria-describedby={activeId === cluster.id ? "tl-tip" : undefined}
      aria-haspopup={single === undefined ? "dialog" : undefined}
      aria-expanded={single === undefined ? pinnedId === cluster.id : undefined}
      data-tl-seal=""
      onpointerdown={(event) => event.stopPropagation()}
      onpointerenter={() => {
        activeId = cluster.id;
      }}
      onpointerleave={() => {
        activeId = activeId === cluster.id ? null : activeId;
      }}
      onfocus={() => {
        activeId = cluster.id;
      }}
      onblur={() => {
        activeId = activeId === cluster.id ? null : activeId;
      }}
      onclick={(event) => {
        event.stopPropagation();
        // A singleton is its own detail — a click is a quick jump to it.
        if (single !== undefined) {
          closePanel();
          onScrub(cluster.jumpIndex);
          return;
        }
        // A stacked seal opens (or toggles) its expanded jump-list instead
        // of guessing one target; the rows inside scrub to a chosen frame.
        pinnedSealEl = event.currentTarget;
        pinnedId = pinnedId === cluster.id ? null : cluster.id;
      }}
    >
      {#if single === undefined}
        {count > 99 ? "99+" : String(count)}
      {:else}
        <MarkerIcon kind={single.kind} />
      {/if}
    </button>
  {/each}
  <!-- Hover/focus peek — a glance. Suppressed while a panel is pinned so the
       two surfaces never overlap. A stack shows a per-kind ledger (no more
       cramped wrapping `·`-run) and hints that a click opens the full list. -->
  {#if pinnedId === null && activeCluster}
    {@const cluster = activeCluster}
    {@const summary = summarizeCluster(cluster, max)}
    {@const isStack = cluster.members.length > 1}
    <div
      id="tl-tip"
      class="tl-tip"
      role="tooltip"
      style:left={posPct(cluster.index)}
      style:transform={tipTransform(cluster.index)}
    >
      <span class="tl-tip-title">{summary.title}</span>
      {#if isStack}
        <ul class="tl-tip-breakdown">
          <!-- `CLUSTER_KIND_ORDER.filter(has)` — one row per kind, unique by construction. -->
          {#each clusterBreakdownRows(cluster.members) as row (row.kind)}
            <li class="tl-tip-row">
              <span class={`tl-chip ${markerToneClass(row.kind)}`} aria-hidden="true">
                <MarkerIcon kind={row.kind} />
              </span>
              <span class="tl-tip-count">{row.count}</span>
              <span>{row.label}</span>
            </li>
          {/each}
        </ul>
      {:else if summary.detail}
        {@const detail = summary.detail}
        <span class="tl-tip-detail">{detail}</span>
      {/if}
      <span class="tl-tip-rev">{summary.rev}</span>
      {#if isStack}
        <span class="tl-tip-hint">{strings.timeline.inspectHint}</span>
      {/if}
    </div>
  {/if}
  <!-- Pinned panel — the reading. Each member is its own jump-row, so a dense
       burst becomes a navigable index instead of one guessed scrub target. -->
  {#if pinnedCluster}
    {@const cluster = pinnedCluster}
    {@const summary = summarizeCluster(cluster, max)}
    <div
      bind:this={panelEl}
      class="tl-panel"
      role="dialog"
      aria-label={summary.title}
      style:left={posPct(cluster.index)}
      style:transform={tipTransform(cluster.index)}
    >
      <div class="tl-panel-head">
        <div class="tl-panel-heading">
          <span class="tl-panel-title">{summary.title}</span>
          <span class="tl-panel-rev">{summary.rev}</span>
        </div>
        <button
          type="button"
          class="tl-panel-close"
          aria-label={strings.timeline.closeDetails}
          onclick={() => closePanel(true)}
        >
          <IconClose size={16} />
        </button>
      </div>
      <ul class="tl-panel-list">
        <!-- KEYED BY INDEX, DELIBERATELY — never by `member.id`. Marker ids are
             built upstream as `${kind}-${anchor}` (entrypoints/replay/App), so two
             events of the same kind anchored at the same revision produce the SAME
             id. Solid's `<For>` tolerated the collision silently; Svelte's keyed
             `{#each}` throws `each_key_duplicate` and takes the whole replay down on
             a real user's document. The member list is rebuilt wholesale and never
             reorders in place, so an index key is exactly right here.
             DO NOT "IMPROVE" THIS TO `(member.id)`. -->
        {#each cluster.members as member, i (i)}
          {@const rev = revisionOf(member.index, max)}
          {@const jumpLabel = `${strings.timeline.jumpTo} ${member.label}${
            member.detail ? ` — ${member.detail}` : ""
          } — ${rev}`}
          <li>
            <button
              type="button"
              class="tl-panel-row"
              aria-label={jumpLabel}
              onclick={() => {
                onScrub(member.index);
                closePanel(true);
              }}
            >
              <span class={`tl-chip ${markerToneClass(member.kind)}`} aria-hidden="true">
                <MarkerIcon kind={member.kind} />
              </span>
              <span class="tl-panel-row-main">
                <span class="tl-panel-row-kind">{CLUSTER_KIND_LABEL[member.kind]}</span>
                {#if member.detail}
                  {@const detail = member.detail}
                  <span class="tl-panel-row-detail">{detail}</span>
                {/if}
              </span>
              <span class="tl-panel-row-rev" aria-hidden="true">→ {member.index}</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  <div class="tl-thumb" style:left={thumbLeft(currentIndex)}></div>
</div>
