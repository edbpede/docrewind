// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PrivacySummary (plan Phase 5 Step 8 / PRD §13). A static, plain-language privacy
// statement: local-first, no network, no telemetry. No state, no data access.

import type { Component } from "solid-js";
import { strings } from "@/lib/i18n/strings";

const PrivacySummary: Component = () => {
  return (
    <section class="dr-card" aria-labelledby="dr-privacy-heading">
      <h2 id="dr-privacy-heading" class="mb-1 font-medium">
        {strings.options.privacyHeading}
      </h2>
      <p class="text-sm text-stone-700 dark:text-stone-300">{strings.options.privacyBody}</p>
    </section>
  );
};

export default PrivacySummary;
