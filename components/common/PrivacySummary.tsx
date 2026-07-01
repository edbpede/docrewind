// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PrivacySummary (plan Phase 5 Step 8 / PRD §13). A static, plain-language privacy
// statement: local-first, no network, no telemetry. No state, no data access.
// Presented as a warm, OPEN-by-default reassurance card (brand-soft) led by a
// shield mark — privacy is a trust feature, shown calmly rather than as a warning.

import type { Component } from "solid-js";
import { IconShield } from "@/components/common/icons";
import { strings } from "@/lib/core/i18n/strings";

const PrivacySummary: Component = () => {
  return (
    <section class="banner-card" aria-labelledby="dr-privacy-heading">
      <IconShield size={20} class="banner-icon" />
      <div class="flex flex-col gap-1">
        <h2 id="dr-privacy-heading" class="banner-title">
          {strings.options.privacyHeading}
        </h2>
        <p class="banner-body">{strings.options.privacyBody}</p>
      </div>
    </section>
  );
};

export default PrivacySummary;
