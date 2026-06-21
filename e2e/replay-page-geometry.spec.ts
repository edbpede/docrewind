// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 0 regression — page-geometry tokens. Locks the DESIGN.md page contract:
// the manuscript leaf is a US-Letter sheet driven by the `--dr-page-width` /
// `--dr-page-margin` custom properties (816px / 96px), centered, with a full 1in
// desktop margin that eases DOWN on narrow viewports (the sheet stays fluid —
// responsive width, never a scale transform). Guards the rendered geometry
// contract (computed 816px cap + 96px desktop margin, resolved from the tokens
// on :root) against regression — behavior, not stylesheet-string shape.
//
// When G001_EVIDENCE=1 it also emits the Ultragoal quality-gate GUI evidence
// (automation transcript + a non-uniform screenshot + an adversarial boundary
// report) under .gjc/ultragoal/artifacts/g001/. Normal CI runs only assert.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2E_SMOKE_DOC, expect, installGoogleFulfiller, test } from "./fixtures";

const EVIDENCE = process.env.G001_EVIDENCE === "1";
const ARTIFACT_DIR = path.join(process.cwd(), ".gjc/ultragoal/artifacts/g001");

interface Step {
  readonly type: string;
  readonly selector?: string | undefined;
  readonly detail?: string | undefined;
  readonly timestamp: number;
}

test("page leaf is a tokenized US-Letter sheet (816px) with a fluid 96px desktop margin", async ({
  context,
  extensionId,
}) => {
  const steps: Step[] = [];
  const mark = (type: string, selector?: string, detail?: string): void => {
    steps.push({ type, selector, detail, timestamp: Date.now() });
  };

  const fulfiller = await installGoogleFulfiller(context);
  mark("install-fulfiller");

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  mark("set-viewport", undefined, "1280x900 (desktop, >=64rem)");

  await page.goto(`chrome-extension://${extensionId}/replay.html?doc=${E2E_SMOKE_DOC}`);
  mark("navigate", `replay.html?doc=${E2E_SMOKE_DOC}`);

  // Render proof: the Play control only appears after retrieval+worker publish.
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 45_000 });
  mark("await", "role=button[name=Play]", "replay surface rendered");
  expect(fulfiller.discoveryCount()).toBeGreaterThan(0);
  expect(fulfiller.chunkCount()).toBeGreaterThan(0);

  const leaf = page.locator(".dr-leaf");
  await expect(leaf).toBeVisible();

  // The tokens resolve on the page root (:root = <html>).
  const vars = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      width: cs.getPropertyValue("--dr-page-width").trim(),
      margin: cs.getPropertyValue("--dr-page-margin").trim(),
    };
  });
  expect(vars.width).toBe("816px");
  expect(vars.margin).toBe("96px");
  mark("measure-tokens", ":root", `--dr-page-width=${vars.width} --dr-page-margin=${vars.margin}`);

  // The leaf consumes them: 816px cap + 96px padding at desktop width.
  const desktop = await leaf.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      maxWidth: cs.maxWidth,
      paddingLeft: cs.paddingLeft,
      paddingTop: cs.paddingTop,
      renderedWidth: el.getBoundingClientRect().width,
    };
  });
  expect(desktop.maxWidth).toBe("816px");
  expect(desktop.paddingLeft).toBe("96px");
  expect(desktop.paddingTop).toBe("96px");
  mark(
    "measure-leaf-desktop",
    ".dr-leaf",
    `max-width=${desktop.maxWidth} padding=${desktop.paddingLeft}/${desktop.paddingTop} rendered=${Math.round(desktop.renderedWidth)}px`,
  );

  if (EVIDENCE) {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    // Scrub to end-of-timeline so the leaf carries the reconstructed text, then
    // capture the whole replay <main> as JPEG. The airy light UI has large flat
    // regions, so a PNG's run-length-compressed scanlines read as near-uniform;
    // a JPEG entropy stream is high-variance and proves a real, non-blank render.
    const slider = page.getByRole("slider", { name: "Revision timeline" });
    await slider.focus();
    await page.keyboard.press("End");
    await expect(page.locator("article.doc-column")).toContainText("Probe");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("main").screenshot({
      path: path.join(ARTIFACT_DIR, "gui-screenshot.jpg"),
      type: "jpeg",
      quality: 90,
    });
    mark("screenshot", "main", "gui-screenshot.jpg (full replay <main> at end-of-timeline)");
  }

  // ── Adversarial boundary: narrow viewport. The sheet must stay FLUID (rendered
  // width <= viewport, never the 816px cap overflowing) and the 96px desktop
  // margin must EASE DOWN (smaller padding), per DESIGN.md. ──────────────────
  await page.setViewportSize({ width: 375, height: 800 });
  mark("set-viewport", undefined, "375x800 (narrow boundary)");
  const narrow = await leaf.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      paddingLeft: cs.paddingLeft,
      renderedWidth: el.getBoundingClientRect().width,
    };
  });
  const narrowPad = Number.parseFloat(narrow.paddingLeft);
  expect(narrowPad).toBeLessThan(96); // eased down from the desktop full margin
  expect(narrow.renderedWidth).toBeLessThanOrEqual(375); // fluid, no overflow
  mark(
    "measure-leaf-narrow",
    ".dr-leaf",
    `padding=${narrow.paddingLeft} rendered=${Math.round(narrow.renderedWidth)}px (<=375, eased down)`,
  );

  if (EVIDENCE) {
    const transcript = {
      schemaVersion: 1,
      kind: "browser-automation",
      tool: "playwright",
      surface: "web",
      target: `chrome-extension://<id>/replay.html?doc=${E2E_SMOKE_DOC}`,
      startedAt: steps[0]?.timestamp ?? Date.now(),
      finishedAt: Date.now(),
      results: {
        pageWidthVar: vars.width,
        pageMarginVar: vars.margin,
        desktop,
        narrow,
      },
      actions: steps,
    };
    writeFileSync(
      path.join(ARTIFACT_DIR, "browser-run.json"),
      `${JSON.stringify(transcript, null, 2)}\n`,
    );
    writeFileSync(
      path.join(ARTIFACT_DIR, "adversarial-report.txt"),
      [
        "G001 Phase 0 — adversarial / boundary report",
        "================================================",
        "Case: narrow viewport (375x800) margin ease-down + fluid sheet.",
        `Desktop (1280): max-width=${desktop.maxWidth}, padding=${desktop.paddingLeft}/${desktop.paddingTop}, rendered=${Math.round(desktop.renderedWidth)}px.`,
        `Narrow (375):   padding=${narrow.paddingLeft} (< 96px desktop margin, eased down), rendered=${Math.round(narrow.renderedWidth)}px (<= 375 viewport, fluid — no 816px overflow).`,
        "Expected: tokens drive a fluid sheet; the full 1in margin only applies at >=64rem. PASS.",
        "",
      ].join("\n"),
    );
    mark("write-evidence", ARTIFACT_DIR);
  }
});
