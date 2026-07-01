// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PopupApp — the toolbar action surface. Pinning the extension and clicking its
// icon opens THIS popup (WXT auto-wires `action.default_popup` from the
// `entrypoints/popup/` entrypoint; `action` needs no permission, so the privacy
// invariant — permissions:["storage"], host:docs.google.com — is untouched).
//
// A friendly, fixed-width little app (360px) in the warm Apple-Settings register:
// the shared theme applier, BrandMark chip, and `btn-*`/`dr-*` tokens. Two views
// live in one popup — an overview (what DocRewind is, a calm privacy reassurance,
// and quick actions) and an About ledger (version/author/license/source as a
// grouped iOS row list) — toggled in place so the popup never needs a second page.
// "Options" hands off to the real options page via `runtime.openOptionsPage()`
// (no `tabs` permission required).
//
// Solid idioms: `props.x` (never destructured), `class` (never `className`).

import type { Component, JSX } from "solid-js";
import { createSignal, Show } from "solid-js";
import { browser } from "wxt/browser";
import BrandMark from "@/components/common/BrandMark";
import {
  IconArrowLeft,
  IconExternal,
  IconInfo,
  IconSettings,
  IconShield,
} from "@/components/common/icons";
import ThemeControl from "@/components/common/ThemeControl";
import { useThemeSync } from "@/components/common/theme-sync";
import { strings } from "@/lib/core/i18n/strings";

const popup = strings.popup;

/** Read the manifest version, falling back to an em dash if unavailable. */
function appVersion(): string {
  try {
    return browser.runtime.getManifest().version ?? "—";
  } catch {
    return "—";
  }
}

/** An external link styled as a quiet, focusable inline action with an icon. */
const ExternalLink: Component<{ href: string; children: JSX.Element }> = (props) => (
  <a
    href={props.href}
    target="_blank"
    rel="noreferrer noopener"
    class="dr-link inline-flex items-center gap-1"
  >
    {props.children}
    <IconExternal size={14} class="shrink-0 text-ink-faint" />
  </a>
);

/** One label/value row in the About ledger (the iOS grouped-row pattern). */
const DetailRow: Component<{ label: string; children: JSX.Element }> = (props) => (
  <div class="dr-row">
    <dt class="dr-row-label shrink-0">{props.label}</dt>
    <dd class="m-0 min-w-0 text-right text-[0.9375rem]">{props.children}</dd>
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
    <div class="dr-surface w-90 max-w-full">
      <Show
        when={view() === "about"}
        fallback={
          <div class="flex flex-col gap-5 p-5">
            <header class="flex items-center gap-3.5">
              <BrandMark size={40} />
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="dr-subheading truncate">{strings.app.brandName}</span>
                <span class="dr-muted text-pretty">{popup.tagline}</span>
              </div>
              <span class="dr-badge ml-auto shrink-0 self-start font-mono tabular-nums">
                v{version}
              </span>
            </header>

            <p class="dr-body text-pretty">{popup.description}</p>

            <div class="banner-card">
              <IconShield class="banner-icon" />
              <div class="flex flex-col">
                <span class="banner-title">{popup.privacyNote}</span>
              </div>
            </div>

            <section class="dr-group" aria-labelledby="dr-popup-appearance">
              <h2 id="dr-popup-appearance" class="dr-group-label">
                {strings.options.settingsHeading}
              </h2>
              <div class="dr-rows">
                <ThemeControl />
              </div>
            </section>

            <div class="flex flex-col gap-2.5">
              <button type="button" class="btn-primary btn-block btn-lg" onClick={openOptions}>
                <IconSettings size={18} />
                {popup.optionsButton}
              </button>
              <button
                type="button"
                class="btn-secondary btn-block"
                onClick={() => setView("about")}
              >
                <IconInfo size={18} />
                {popup.aboutButton}
              </button>
            </div>
          </div>
        }
      >
        <div class="flex flex-col gap-4 p-5">
          <header class="flex items-center gap-2">
            <button
              type="button"
              class="btn-ghost px-2.5"
              aria-label={popup.backHint}
              onClick={() => setView("main")}
            >
              <IconArrowLeft size={18} />
              {popup.backButton}
            </button>
            <h2 class="dr-subheading ml-1">{popup.aboutHeading}</h2>
          </header>

          <div class="flex flex-col items-center gap-2 py-1 text-center">
            <BrandMark size={48} label={strings.app.brandName} />
            <span class="dr-heading">{strings.app.brandName}</span>
            <span class="dr-muted">{popup.tagline}</span>
          </div>

          <dl class="dr-rows m-0">
            <DetailRow label={popup.versionLabel}>
              <span class="font-mono tabular-nums text-ink-secondary">{version}</span>
            </DetailRow>
            <DetailRow label={popup.authorLabel}>
              <ExternalLink href={popup.authorUrl}>{popup.authorHandle}</ExternalLink>
            </DetailRow>
            <DetailRow label={popup.licenseLabel}>
              <span class="font-mono text-[0.8125rem] text-ink-secondary">
                {popup.licenseValue}
              </span>
            </DetailRow>
            <DetailRow label={popup.sourceLabel}>
              <ExternalLink href={popup.sourceUrl}>{popup.sourceText}</ExternalLink>
            </DetailRow>
          </dl>
        </div>
      </Show>
    </div>
  );
};

export default PopupApp;
