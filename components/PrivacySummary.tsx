// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PrivacySummary (plan Phase 5 Step 8 / PRD §13). A static, plain-language privacy
// statement: local-first, no network, no telemetry. No state, no data access.

import type { Component } from "solid-js";
import { strings } from "@/lib/i18n/strings";

const PrivacySummary: Component = () => {
  return (
    <section class="dr-section" aria-labelledby="dr-privacy-heading">
      <h2 id="dr-privacy-heading" class="dr-section-title">
        {strings.options.privacyHeading}
      </h2>
      <p class="max-w-[68ch] text-sm leading-relaxed text-stone-700 dark:text-stone-300">
        {strings.options.privacyBody}
      </p>
    </section>
  );
};

export default PrivacySummary;
