<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // PrivacyBanner (PRD §9.6, §13). A calm reassurance row answering "what am I
  // looking at?" — the surface is a reconstruction, not the live document, and
  // nothing leaves the device. The key trust line is ALWAYS shown: the headline
  // doubles as a compact disclosure trigger, so reassurance is never hidden. The
  // supplementary detail is collapsed by default (it reads as quiet orientation,
  // not a warning the reader must dismiss) and expands on demand. Orientation, not
  // a hazard — a friendly shield mark on a soft brand surface, never an alarm.
  // Meaning never relies on hue alone (§9.11): the shield icon and the chevron
  // affordance are non-color cues, and the state is announced via aria-expanded.

  import { IconChevronDown, IconShield } from "@/components/common/icons";
  import { strings } from "@/lib/core/i18n/strings";

  export interface PrivacyBannerProps {
    /** Optional suggestion-approximation copy (rendered when present). */
    readonly approximationNote?: string | undefined;
  }

  let { approximationNote }: PrivacyBannerProps = $props();

  // Collapsed by default: the headline trust line stays visible as the trigger,
  // and the reader opens the detail only if they want the fuller explanation.
  let expanded = $state(false);
  const detailId = $props.id();
</script>

<section class="banner-card" aria-label={strings.privacy.bannerSummary}>
  <button
    type="button"
    class="banner-toggle"
    aria-expanded={expanded}
    aria-controls={detailId}
    onclick={() => {
      expanded = !expanded;
    }}
  >
    <IconShield class="banner-icon" />
    <span class="banner-title">{strings.privacy.bannerTitle}</span>
    <!--
      The Solid original also passed `data-expanded={expanded ? "true" : "false"}` here,
      but the icon set's shared `Svg` frame renders a FIXED attribute list and never
      spread its props onto the `<svg>`, so the attribute never reached the DOM and
      `banner-chevron`'s `data-[expanded=false]:-rotate-90` rule has always been inert.
      Dropping the dead prop keeps the rendered DOM byte-identical; reviving the
      rotation means teaching `icons/Icon.svelte` to forward rest props, which is a
      behaviour change in a component this batch does not own.
    -->
    <IconChevronDown class="banner-chevron" />
  </button>
  <div
    class="banner-collapse"
    data-collapsed={expanded ? "false" : "true"}
    aria-hidden={!expanded}
  >
    <div class="banner-clip">
      <div id={detailId} class="banner-detail">
        <p class="banner-body">{strings.privacy.bannerBody}</p>
        {#if approximationNote}
          {@const note = approximationNote}
          <p class="banner-note">{note}</p>
        {/if}
      </div>
    </div>
  </div>
</section>
