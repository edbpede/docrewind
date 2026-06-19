// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PopupApp — the toolbar action surface. Pinning the extension and clicking its
// icon opens THIS popup (WXT auto-wires `action.default_popup` from the
// `entrypoints/popup/` entrypoint; `action` needs no permission, so the privacy
// invariant — permissions:["storage"], host:docs.google.com — is untouched).
//
// It is a quiet, fixed-width archival card matching the replay/options surfaces:
// the same theme applier, BrandMark chip, and `btn-*`/`dr-*` tokens. Two views
// live in one popup — an overview (what DocRewind is + quick actions) and an
// About ledger (version/author/license/source) — toggled in place so the popup
// never needs a second page. "Options" hands off to the real options page via
// `runtime.openOptionsPage()` (no `tabs` permission required).
//
// Solid idioms: `props.x` (never destructured), `class` (never `className`).

import type { Component, JSX } from "solid-js";
import { createSignal, Show } from "solid-js";
import { browser } from "wxt/browser";
import BrandMark from "@/components/BrandMark";
import { useThemeSync } from "@/components/theme-sync";
import { strings } from "@/lib/i18n/strings";

const popup = strings.popup;

/** Read the manifest version, falling back to an em dash if unavailable. */
function appVersion(): string {
  try {
    return browser.runtime.getManifest().version ?? "—";
  } catch {
    return "—";
  }
}

/** An external link styled as a quiet, focusable inline action. */
const ExternalLink: Component<{ href: string; children: JSX.Element }> = (props) => (
  <a
    href={props.href}
    target="_blank"
    rel="noreferrer noopener"
    class="rounded text-revision underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-revision-ring"
  >
    {props.children}
  </a>
);

/** One label/value row in the About ledger. */
const DetailRow: Component<{ label: string; children: JSX.Element }> = (props) => (
  <div class="flex items-baseline justify-between gap-3 py-1">
    <dt class="dr-eyebrow shrink-0">{props.label}</dt>
    <dd class="text-right text-sm">{props.children}</dd>
  </div>
);

const PopupApp: Component = () => {
  useThemeSync();
  const [view, setView] = createSignal<"main" | "about">("main");
  const version = appVersion();

  function openOptions(): void {
    // Opens the extension's own options page in a tab; the popup auto-dismisses
    // as focus moves to it. No `tabs` permission needed for own-page navigation.
    void browser.runtime.openOptionsPage();
  }

  return (
    <div class="dr-surface w-80 max-w-full">
      <div class="flex flex-col gap-4 p-4">
        <Show
          when={view() === "about"}
          fallback={
            <>
              <header class="flex items-center gap-3">
                <BrandMark size={36} />
                <div class="flex min-w-0 flex-col gap-0.5">
                  <span class="truncate font-serif text-lg font-semibold leading-tight">
                    {strings.app.brandName}
                  </span>
                  <span class="dr-eyebrow">{strings.app.mastheadEyebrow}</span>
                </div>
                <span class="ml-auto inline-flex shrink-0 items-center rounded-full border border-stone-300 px-2 py-0.5 font-mono text-xs tabular-nums text-stone-600 dark:border-stone-600 dark:text-stone-400">
                  v{version}
                </span>
              </header>

              <p class="text-sm leading-relaxed text-stone-600 dark:text-stone-300">
                {popup.description}
              </p>

              <p class="dr-eyebrow flex items-center gap-1.5 text-stone-500 dark:text-stone-400">
                <span aria-hidden="true" class="text-revision">
                  ●
                </span>
                {popup.privacyNote}
              </p>

              <div class="flex gap-2 pt-1">
                <button type="button" class="btn-primary flex-1" onClick={openOptions}>
                  {popup.optionsButton}
                </button>
                <button type="button" class="btn-secondary" onClick={() => setView("about")}>
                  {popup.aboutButton}
                </button>
              </div>
            </>
          }
        >
          <header class="flex items-center gap-2">
            <button
              type="button"
              class="btn-ghost px-2 py-1"
              aria-label={popup.backHint}
              onClick={() => setView("main")}
            >
              <span aria-hidden="true">←</span> {popup.backButton}
            </button>
            <h2 class="ml-1 text-sm font-semibold">{popup.aboutHeading}</h2>
          </header>

          <div class="flex flex-col items-center gap-1.5 py-1 text-center">
            <BrandMark size={44} label={strings.app.brandName} />
            <span class="font-serif text-lg font-semibold">{strings.app.brandName}</span>
            <span class="text-xs text-stone-500 dark:text-stone-400">{popup.tagline}</span>
          </div>

          <dl class="dr-card flex flex-col divide-y divide-stone-200/70 py-1 dark:divide-stone-700/70">
            <DetailRow label={popup.versionLabel}>
              <span class="font-mono tabular-nums">{version}</span>
            </DetailRow>
            <DetailRow label={popup.authorLabel}>
              <ExternalLink href={popup.authorUrl}>{popup.authorHandle}</ExternalLink>
            </DetailRow>
            <DetailRow label={popup.licenseLabel}>
              <span class="font-mono text-xs">{popup.licenseValue}</span>
            </DetailRow>
            <DetailRow label={popup.sourceLabel}>
              <ExternalLink href={popup.sourceUrl}>{popup.sourceText}</ExternalLink>
            </DetailRow>
          </dl>
        </Show>
      </div>
    </div>
  );
};

export default PopupApp;
