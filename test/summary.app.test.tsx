// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import App from "@/entrypoints/summary/App";
import type { Operation } from "@/lib/core/docs/decoder/types";
import { PARSER_VERSION } from "@/lib/core/docs/decoder/version";
import { asDocId, asRevisionId } from "@/lib/core/domain/ids";
import type { DocumentKind } from "@/lib/core/domain/kind";
import type { DecodedRevision } from "@/lib/core/domain/model";
import { errorTitle, strings } from "@/lib/core/i18n/strings";
import { SHEETS_PARSER_VERSION } from "@/lib/core/sheets/decoder/version";
import { SLIDES_PARSER_VERSION } from "@/lib/core/slides/decoder/version";
import type {
  ReplayPublication,
  RevisionStore,
  SheetReplayPublication,
  SlideReplayPublication,
} from "@/lib/core/store";
import { createMemoryStore } from "@/lib/platform/db.memory";

const DOC = asDocId("docSummaryTest");

function setSummaryUrl(doc = DOC, kind: DocumentKind = "doc"): void {
  const suffix = kind === "doc" ? "" : `&kind=${kind}`;
  window.history.replaceState(null, "", `/summary.html?doc=${doc}${suffix}`);
}

function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function rev(id: number, time: number | null, operations: readonly Operation[]): DecodedRevision {
  return { revisionId: asRevisionId(id), userId: null, sessionId: null, time, operations };
}

function insert(s: string, ibi: number): Operation {
  return { ty: "is", s, ibi };
}

function publication(revisions: readonly DecodedRevision[]): ReplayPublication {
  return {
    publicationId: "pub-1",
    parserVersion: PARSER_VERSION,
    revisions,
    snapshots: [],
    timeline: [],
    publishedAt: 1000,
  };
}

async function seed(store: RevisionStore, revisions: readonly DecodedRevision[]): Promise<void> {
  await store.saveReplayPublication(DOC, publication(revisions));
  await store.setActiveReplayPublication(DOC, "pub-1");
}

async function seedSlides(store: RevisionStore): Promise<void> {
  const pub: SlideReplayPublication = {
    kind: "slides",
    publicationId: "pub-1",
    slidesParserVersion: SLIDES_PARSER_VERSION,
    revisions: [],
    snapshots: [],
    timeline: [],
    publishedAt: 1000,
  };
  await store.saveReplayPublication(DOC, pub);
  await store.setActiveReplayPublication(DOC, "pub-1", "slides");
}

async function seedSheet(store: RevisionStore): Promise<void> {
  const pub: SheetReplayPublication = {
    kind: "sheet",
    publicationId: "pub-1",
    sheetsParserVersion: SHEETS_PARSER_VERSION,
    revisions: [],
    snapshots: [],
    timeline: [],
    publishedAt: 1000,
  };
  await store.saveReplayPublication(DOC, pub);
  await store.setActiveReplayPublication(DOC, "pub-1", "sheet");
}

describe("Summary App", () => {
  beforeEach(() => {
    cleanup();
    fakeBrowser.reset();
    installMatchMedia();
    setSummaryUrl();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a missing-doc error when no ?doc is present", async () => {
    window.history.replaceState(null, "", "/summary.html");
    const store = createMemoryStore();
    render(() => <App store={store} />);
    expect(await screen.findByText(errorTitle("missing-doc-id"))).toBeTruthy();
  });

  it("points back to the replay when no publication exists yet", async () => {
    const store = createMemoryStore();
    render(() => <App store={store} />);
    expect(await screen.findByText(strings.summary.missingTitle)).toBeTruthy();
    const openReplay = screen.getByText(strings.summary.openReplay).closest("a");
    expect(openReplay?.getAttribute("href")).toBe(`replay.html?doc=${DOC}`);
  });

  it("preserves the URL kind=slides in the back-link when no publication exists yet", async () => {
    setSummaryUrl(DOC, "slides");
    const store = createMemoryStore();
    render(() => <App store={store} />);
    expect(await screen.findByText(strings.summary.missingTitle)).toBeTruthy();
    const openReplay = screen.getByText(strings.summary.openReplay).closest("a");
    expect(openReplay?.getAttribute("href")).toBe(`replay.html?doc=${DOC}&kind=slides`);
  });

  it("preserves the URL kind=sheet in the back-link when no publication exists yet", async () => {
    setSummaryUrl(DOC, "sheet");
    const store = createMemoryStore();
    render(() => <App store={store} />);
    expect(await screen.findByText(strings.summary.missingTitle)).toBeTruthy();
    const openReplay = screen.getByText(strings.summary.openReplay).closest("a");
    expect(openReplay?.getAttribute("href")).toBe(`replay.html?doc=${DOC}&kind=sheet`);
  });

  it("renders both charts and the stat row for a timed publication", async () => {
    const store = createMemoryStore();
    await seed(store, [
      rev(1, 1_000, [insert("hello", 1)]),
      rev(2, 60_000, [insert(" world", 6)]),
      rev(3, 120_000, [insert("!", 12)]),
    ]);
    const { container } = render(() => <App store={store} />);

    expect(await screen.findByText(strings.summary.activityHeading)).toBeTruthy();
    expect(screen.getByText(strings.summary.positionHeading)).toBeTruthy();

    // Both charts render as accessible images.
    const charts = screen.getAllByRole("img");
    expect(charts.length).toBeGreaterThanOrEqual(2);

    // The scatter drew a circle per positioned edit.
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);

    // The at-a-glance stats include the edit count and characters added.
    expect(screen.getByText(strings.summary.statEdits)).toBeTruthy();
    expect(screen.getByText(strings.summary.statAdded)).toBeTruthy();

    // Back-to-replay navigation is present.
    const back = screen.getByText(strings.summary.backToReplay).closest("a");
    expect(back?.getAttribute("href")).toBe(`replay.html?doc=${DOC}`);
  });

  it("back-to-replay carries kind=slides for a Slides publication", async () => {
    const store = createMemoryStore();
    await seedSlides(store);
    render(() => <App store={store} />);
    // The href starts bare while the publication loads, then resolves to carry the
    // kind so the replay route retries against the /presentation/ endpoint.
    await vi.waitFor(() => {
      const back = screen.getByText(strings.summary.backToReplay).closest("a");
      expect(back?.getAttribute("href")).toBe(`replay.html?doc=${DOC}&kind=slides`);
    });
  });

  it("back-to-replay carries kind=sheet for a Sheets publication", async () => {
    const store = createMemoryStore();
    await seedSheet(store);
    render(() => <App store={store} />);
    await vi.waitFor(() => {
      const back = screen.getByText(strings.summary.backToReplay).closest("a");
      expect(back?.getAttribute("href")).toBe(`replay.html?doc=${DOC}&kind=sheet`);
    });
  });

  it("shows a friendly empty state when timing is insufficient", async () => {
    const store = createMemoryStore();
    await seed(store, [rev(1, null, [insert("hello", 1)])]);
    render(() => <App store={store} />);
    expect(await screen.findByText(strings.summary.unavailableTitle)).toBeTruthy();
  });
});
