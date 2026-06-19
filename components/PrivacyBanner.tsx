// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PrivacyBanner (plan Phase 5 Step 5a / PRD §9.6, §13). A calm, collapsed-by-
// default disclosure answering "what am I looking at?" — the surface is a
// reconstruction, not the live document. This is orientation, not a hazard, so
// it reads as information rather than a warning. No internal state: a native
// `<details>` owns open/closed, and the body is a pure view over the i18n
// catalog. Meaning never relies on hue alone (§9.11) — the info mark and the
// rotating chevron are non-color affordances.

import type { Component } from "solid-js";
import { Show } from "solid-js";
import { strings } from "@/lib/i18n/strings";

export interface PrivacyBannerProps {
  /** Optional suggestion-approximation copy (rendered when present). */
  readonly approximationNote?: string;
}

const PrivacyBanner: Component<PrivacyBannerProps> = (props) => {
  return (
    <details class="banner-note group">
      <summary class="banner-note-summary">
        <svg
          class="size-4 shrink-0 text-revision"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="11" x2="12" y2="16" />
          <line x1="12" y1="8" x2="12" y2="8" />
        </svg>
        <span class="flex-1">{strings.privacy.bannerSummary}</span>
        <svg
          class="banner-note-chevron"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
      </summary>
      <div class="banner-note-body">
        <p class="font-medium text-stone-700 dark:text-stone-200">{strings.privacy.bannerTitle}</p>
        <p>{strings.privacy.bannerBody}</p>
        <Show when={props.approximationNote}>
          {(note) => <p class="text-xs text-stone-500 dark:text-stone-500">{note()}</p>}
        </Show>
      </div>
    </details>
  );
};

export default PrivacyBanner;
