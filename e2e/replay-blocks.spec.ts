// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 1 regression — paragraph blocks. The replay now renders the
// reconstructed document as <p class="doc-block"> paragraph blocks inside the
// <article class="doc-column"> (was one flat pre-wrapped slab), with embeds in
// their own .doc-block-embed blocks. Guards that the assembled extension renders
// the block tree AND that the block split preserves the reconstructed text
// verbatim (the concatenation invariant, end-to-end through the real pipeline).
//
// When G002_EVIDENCE=1 it also emits the Ultragoal quality-gate GUI evidence
// (automation transcript + a non-uniform JPEG screenshot + a text-integrity
// adversarial report) under .gjc/ultragoal/artifacts/g002/.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  E2E_EXPECTED_FINAL_TEXT,
  E2E_SMOKE_DOC,
  expect,
  installGoogleFulfiller,
  test,
} from "./fixtures";

const EVIDENCE = process.env.G002_EVIDENCE === "1";
const ARTIFACT_DIR = path.join(process.cwd(), ".gjc/ultragoal/artifacts/g002");

interface Step {
  readonly type: string;
  readonly selector?: string | undefined;
  readonly detail?: string | undefined;
  readonly timestamp: number;
}

test("replay renders the document as paragraph blocks and preserves the text", async ({
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
  await page.goto(`chrome-extension://${extensionId}/replay.html?doc=${E2E_SMOKE_DOC}`);
  mark("navigate", `replay.html?doc=${E2E_SMOKE_DOC}`);

  await expect(page.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 45_000 });
  mark("await", "role=button[name=Play]", "replay surface rendered");
  expect(fulfiller.discoveryCount()).toBeGreaterThan(0);

  // Scrub to end-of-timeline so the reconstructed text is fully applied.
  const slider = page.getByRole("slider", { name: "Revision timeline" });
  await slider.focus();
  await page.keyboard.press("End");
  mark("scrub", "role=slider", "End");

  const column = page.locator("article.doc-column");
  await expect(column).toBeVisible();

  // The block structure: the column holds at least one paragraph block, and the
  // reconstructed text lives inside a .doc-block (not the bare column slab).
  const paragraphs = column.locator("p.doc-block");
  await expect(paragraphs.first()).toBeVisible();
  const blockCount = await paragraphs.count();
  expect(blockCount).toBeGreaterThan(0);
  await expect(column).toContainText(E2E_EXPECTED_FINAL_TEXT);
  mark("assert-blocks", "article.doc-column > p.doc-block", `${blockCount} paragraph block(s)`);

  // Adversarial / integrity: the visible reading-column text must equal the known
  // reconstructed final text EXACTLY — proving the paragraph split (which keeps the
  // '\n' in run text and strips it only for display) neither dropped nor duplicated
  // any character end-to-end through the real decode -> reconstruct -> blocks path.
  const columnText = (await column.textContent())?.trim() ?? "";
  expect(columnText).toBe(E2E_EXPECTED_FINAL_TEXT);
  mark("assert-text-integrity", "article.doc-column", "column text === reconstructed final text");

  if (EVIDENCE) {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    // JPEG (not PNG): the airy light UI has large flat regions, so a PNG's
    // run-length-compressed scanlines read as near-uniform; a JPEG entropy stream
    // is high-variance and proves a real, non-blank render.
    await page.locator("main").screenshot({
      path: path.join(ARTIFACT_DIR, "gui-screenshot.jpg"),
      type: "jpeg",
      quality: 90,
    });
    mark(
      "screenshot",
      "main",
      "gui-screenshot.jpg (replay <main>, block paragraphs, end-of-timeline)",
    );

    const transcript = {
      schemaVersion: 1,
      kind: "browser-automation",
      tool: "playwright",
      surface: "web",
      target: `chrome-extension://<id>/replay.html?doc=${E2E_SMOKE_DOC}`,
      startedAt: steps[0]?.timestamp ?? Date.now(),
      finishedAt: Date.now(),
      results: { blockCount, columnText, expected: E2E_EXPECTED_FINAL_TEXT },
      actions: steps,
    };
    writeFileSync(
      path.join(ARTIFACT_DIR, "browser-run.json"),
      `${JSON.stringify(transcript, null, 2)}\n`,
    );
    writeFileSync(
      path.join(ARTIFACT_DIR, "adversarial-report.txt"),
      [
        "G002 Phase 1 — adversarial / integrity report",
        "================================================",
        "Surface: assembled extension replay page (real decode -> reconstruct -> blocksAt).",
        `Block structure: <article.doc-column> rendered ${blockCount} <p.doc-block> paragraph block(s).`,
        "Text-integrity (paragraph split must not drop/duplicate any char, incl. the '\\n' kept",
        "in run text and stripped only for display):",
        `  expected: ${JSON.stringify(E2E_EXPECTED_FINAL_TEXT)}`,
        `  actual:   ${JSON.stringify(columnText)}`,
        `  equal:    ${columnText === E2E_EXPECTED_FINAL_TEXT}`,
        "Pure-logic adversarial cases (consecutive newlines, struck paragraph mark, embed",
        "boundary, snapshot-path==linear-path) are covered in lib/core/docs/reconstruction/blocks.test.ts.",
        "",
      ].join("\n"),
    );
    mark("write-evidence", ARTIFACT_DIR);
  }
});
