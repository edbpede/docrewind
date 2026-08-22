<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // LegendSwatch — a small colored legend swatch + label, color set inline so it
  // theme-switches with the page and never depends on an on-demand color utility
  // being generated. Split out of `DocumentSummary.svelte` because Svelte allows
  // one component per file; it is only ever used by the two chart headers there.

  export interface LegendSwatchProps {
    readonly color: string;
    readonly label: string;
  }

  let { color, label }: LegendSwatchProps = $props();
</script>

<span class="inline-flex items-center gap-1.5 text-ink-muted" style:font-size="0.8125rem">
  <span
    aria-hidden="true"
    style:width="0.75rem"
    style:height="0.75rem"
    style:border-radius="3px"
    style:background-color={color}
    style:display="inline-block"
  ></span>{label}
</span>
