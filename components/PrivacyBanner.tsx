// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PrivacyBanner (PRD §9.6, §13). A calm, OPEN-by-default reassurance card
// answering "what am I looking at?" — the surface is a reconstruction, not the
// live document, and nothing leaves the device. Per the redesign this is shown,
// not hidden behind a disclosure (Design Principle "show, don't make them dig"):
// trust is a first-impression, so the key line is always visible. Orientation,
// not a hazard — a friendly shield mark on a soft brand surface, never an alarm.
// Meaning never relies on hue alone (§9.11): the shield icon is a non-color cue.

import type { Component } from "solid-js";
import { Show } from "solid-js";
import { IconShield } from "@/components/icons";
import { strings } from "@/lib/i18n/strings";

export interface PrivacyBannerProps {
  /** Optional suggestion-approximation copy (rendered when present). */
  readonly approximationNote?: string;
}

const PrivacyBanner: Component<PrivacyBannerProps> = (props) => {
  return (
    <section class="banner-card" aria-label={strings.privacy.bannerSummary}>
      <IconShield class="banner-icon" />
      <div class="flex min-w-0 flex-col gap-1">
        <p class="banner-title">{strings.privacy.bannerTitle}</p>
        <p class="banner-body">{strings.privacy.bannerBody}</p>
        <Show when={props.approximationNote}>
          {(note) => (
            <p class="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">
              {note()}
            </p>
          )}
        </Show>
      </div>
    </section>
  );
};

export default PrivacyBanner;
