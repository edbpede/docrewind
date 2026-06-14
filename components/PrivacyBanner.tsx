// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PrivacyBanner (plan Phase 5 Step 5a / PRD §9.6, §13). A persistent notice that
// the surface is a reconstruction, not the live document. No internal state — a
// pure view over the i18n catalog. Color is paired with a left border + icon so
// the warning never relies on hue alone (§9.11).

import type { Component } from "solid-js";
import { Show } from "solid-js";
import { strings } from "@/lib/i18n/strings";

export interface PrivacyBannerProps {
  /** Optional suggestion-approximation copy (rendered when present). */
  readonly approximationNote?: string;
}

const PrivacyBanner: Component<PrivacyBannerProps> = (props) => {
  return (
    <section class="banner-warning" role="note" aria-label={strings.privacy.bannerTitle}>
      <svg
        class="mt-0.5 size-4 shrink-0 text-caution"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8 1.5 15 14H1L8 1.5Zm0 4.25a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 8 5.75Zm0 6.75a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
      </svg>
      <div>
        <p class="font-medium">{strings.privacy.bannerTitle}</p>
        <p class="text-stone-700 dark:text-stone-300">{strings.privacy.bannerBody}</p>
        <Show when={props.approximationNote}>
          {(note) => <p class="mt-1 text-xs text-stone-600 dark:text-stone-400">{note()}</p>}
        </Show>
      </div>
    </section>
  );
};

export default PrivacyBanner;
