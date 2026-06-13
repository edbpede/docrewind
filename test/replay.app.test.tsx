// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import App from "@/entrypoints/replay/App";
import { createMemoryStore } from "@/lib/db.memory";
import { asDocId, asRevisionId } from "@/lib/domain/ids";
import type { DecodedRevision, RawPayload } from "@/lib/domain/model";
import type { RetrievalAck } from "@/lib/messaging";
import { createModel } from "@/lib/reconstruction/model";
import { retrievalError } from "@/lib/retrieval/errors";
import { keepRawData } from "@/lib/settings";

const { sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
}));

vi.mock("@/lib/messaging", () => ({
  sendMessage: sendMessageMock,
}));

const DOC = asDocId("docReplayRace");

function setReplayUrl(): void {
  window.history.replaceState(null, "", `/replay.html?doc=${DOC}`);
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

function decodedRevision(): DecodedRevision {
  return {
    revisionId: asRevisionId(1),
    userId: null,
    sessionId: null,
    time: null,
    operations: [],
  };
}

function installFakeWorker(
  makeMessage: (request: { readonly docId: string; readonly runId: number }) => unknown,
): void {
  class FakeWorker {
    #messageListener: ((event: MessageEvent) => void) | undefined;

    addEventListener(type: "message" | "error", listener: (event: MessageEvent) => void): void {
      if (type === "message") {
        this.#messageListener = listener;
      }
    }

    postMessage(request: { readonly docId: string; readonly runId: number }): void {
      queueMicrotask(() => {
        this.#messageListener?.({ data: makeMessage(request) } as MessageEvent);
      });
    }

    terminate(): void {}
  }

  vi.stubGlobal("Worker", FakeWorker);
}

describe("Replay App run gating", () => {
  beforeEach(() => {
    cleanup();
    fakeBrowser.reset();
    sendMessageMock.mockReset();
    setReplayUrl();
    installMatchMedia();
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not decode from a stale completed checkpoint before the active start ack", async () => {
    let resolveStart: (ack: RetrievalAck) => void = () => {};
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "startRetrieval") {
        return new Promise<RetrievalAck>((resolve) => {
          resolveStart = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const store = createMemoryStore();
    await store.writeCheckpoint({
      docId: DOC,
      upperBound: asRevisionId(1),
      nextStart: asRevisionId(2),
      completed: true,
      // Simulates an older background run that writes after this page run
      // starts. Timestamp freshness is not accepted as page-run proof.
      updatedAt: 11_000,
    });

    render(() => <App store={store} useWorker={false} />);
    await vi.advanceTimersByTimeAsync(800);

    expect(screen.getByText("Discovering revisions…")).toBeTruthy();
    expect(screen.queryByText("Settings & privacy")).toBeNull();

    resolveStart({ ok: true });
    await vi.waitFor(() => expect(screen.getByText("Settings & privacy")).toBeTruthy());
  });

  it("ignores a late error ack from an older retrieval run after retry starts a new run", async () => {
    const startResolvers: Array<(ack: RetrievalAck) => void> = [];
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "startRetrieval") {
        return new Promise<RetrievalAck>((resolve) => {
          startResolvers.push(resolve);
        });
      }
      if (type === "cancelRetrieval") {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });
    const store = createMemoryStore();

    render(() => <App store={store} useWorker={false} />);
    await vi.advanceTimersByTimeAsync(20_100);
    await vi.waitFor(() => expect(screen.getByText("Retrieval unavailable")).toBeTruthy());

    await fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(startResolvers).toHaveLength(2);
    expect(screen.getByText("Discovering revisions…")).toBeTruthy();

    startResolvers[0]?.({ ok: false, error: retrievalError("network-failure") });
    await Promise.resolve();

    expect(screen.queryByText("Network problem")).toBeNull();
    expect(screen.getByText("Discovering revisions…")).toBeTruthy();
  });

  it("does not run raw cleanup when decode produces no published derived data", async () => {
    await keepRawData.setValue(false);
    sendMessageMock.mockResolvedValue({ ok: true });
    const store = createMemoryStore();
    await store.saveRawChunk({
      docId: DOC,
      range: {
        requested: { start: asRevisionId(1), end: asRevisionId(1) },
        received: { start: asRevisionId(1), end: asRevisionId(1) },
      },
      receivedAt: 0,
      body: { not_a_changelog: true },
    } satisfies RawPayload);

    render(() => <App store={store} useWorker={false} />);
    await vi.waitFor(() => expect(screen.getByText("Settings & privacy")).toBeTruthy());

    expect(await store.getRawChunks(DOC)).toHaveLength(1);
  });

  it("publishes worker-derived data only when the worker result runId matches the active run", async () => {
    sendMessageMock.mockResolvedValue({ ok: true });
    installFakeWorker((request) => ({
      kind: "done",
      docId: request.docId,
      runId: request.runId + 1,
      revisionCount: 1,
      revisions: [decodedRevision()],
      snapshots: [{ appliedCount: 0, model: createModel() }],
      timeline: [],
    }));
    const store = createMemoryStore();

    render(() => <App store={store} />);
    await vi.waitFor(() => expect(screen.getByText("Settings & privacy")).toBeTruthy());

    expect(await store.getDecoded(DOC)).toEqual([]);
    cleanup();

    installMatchMedia();
    setReplayUrl();
    sendMessageMock.mockResolvedValue({ ok: true });
    installFakeWorker((request) => ({
      kind: "done",
      docId: request.docId,
      runId: request.runId,
      revisionCount: 1,
      revisions: [decodedRevision()],
      snapshots: [{ appliedCount: 0, model: createModel() }],
      timeline: [],
    }));
    const nextStore = createMemoryStore();

    render(() => <App store={nextStore} />);
    await vi.waitFor(() => expect(screen.getByText("Settings & privacy")).toBeTruthy());

    expect(await nextStore.getDecoded(DOC)).toHaveLength(1);
  });
});
