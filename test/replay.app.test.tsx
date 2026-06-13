// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import App, { parseUserIndex } from "@/entrypoints/replay/App";
import { createMemoryStore } from "@/lib/db.memory";
import { PARSER_VERSION } from "@/lib/decoder/version";
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

describe("parseUserIndex", () => {
  it.each([
    ["0", 0],
    ["1", 1],
    ["42", 42],
    [null, null],
    ["", null],
    ["-1", null],
    ["1.2", null],
    ["1abc", null],
    ["abc1", null],
    [" 1", null],
    ["01", null],
  ] as const)("parses %s as %s", (raw, expected) => {
    expect(parseUserIndex(raw)).toBe(expected);
  });
});

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
    await vi.waitFor(() => expect(screen.getByText("No replay data")).toBeTruthy());
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

  it("surfaces checkpoint read rejection as a bounded content-free error", async () => {
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "startRetrieval") {
        return new Promise<RetrievalAck>(() => {});
      }
      if (type === "endDecodeLease" || type === "requestStorageMaintenance") {
        return Promise.resolve({ status: "completed", reclaimedBytes: 0 });
      }
      return Promise.resolve(undefined);
    });
    const store = createMemoryStore();
    store.readCheckpoint = vi.fn(async () => {
      throw new Error("idb unavailable");
    });

    render(() => <App store={store} useWorker={false} />);
    await vi.advanceTimersByTimeAsync(800);

    await vi.waitFor(() => expect(screen.getByText("Network problem")).toBeTruthy());
    expect(screen.queryByText("Settings & privacy")).toBeNull();
  });

  it("uses an overall run timeout even when checkpoint reads hang", async () => {
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "startRetrieval") {
        return new Promise<RetrievalAck>(() => {});
      }
      if (type === "endDecodeLease" || type === "requestStorageMaintenance") {
        return Promise.resolve({ status: "completed", reclaimedBytes: 0 });
      }
      return Promise.resolve(undefined);
    });
    const store = createMemoryStore();
    store.readCheckpoint = vi.fn(() => new Promise<never>(() => {}));

    render(() => <App store={store} useWorker={false} />);
    await vi.advanceTimersByTimeAsync(45_100);

    await vi.waitFor(() => expect(screen.getByText("Retrieval unavailable")).toBeTruthy());
    expect(screen.queryByText("Settings & privacy")).toBeNull();
  });

  it("keeps a timed-out run terminal when its start ack arrives late", async () => {
    let resolveStart: (ack: RetrievalAck) => void = () => {};
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "startRetrieval") {
        return new Promise<RetrievalAck>((resolve) => {
          resolveStart = resolve;
        });
      }
      if (type === "endDecodeLease" || type === "requestStorageMaintenance") {
        return Promise.resolve({ status: "completed", reclaimedBytes: 0 });
      }
      return Promise.resolve(undefined);
    });
    const store = createMemoryStore();
    store.readCheckpoint = vi.fn(() => new Promise<never>(() => {}));

    render(() => <App store={store} useWorker={false} />);
    await vi.advanceTimersByTimeAsync(45_100);
    await vi.waitFor(() => expect(screen.getByText("Retrieval unavailable")).toBeTruthy());

    resolveStart({ ok: true });
    await Promise.resolve();

    expect(screen.getByText("Retrieval unavailable")).toBeTruthy();
    expect(screen.queryByText("Settings & privacy")).toBeNull();
  });

  it("does not let a stale completed checkpoint bypass the current run timeout", async () => {
    sendMessageMock.mockImplementation((type: string) => {
      if (type === "startRetrieval") {
        return new Promise<RetrievalAck>(() => {});
      }
      if (type === "endDecodeLease" || type === "requestStorageMaintenance") {
        return Promise.resolve({ status: "completed", reclaimedBytes: 0 });
      }
      return Promise.resolve(undefined);
    });
    const store = createMemoryStore();
    await store.writeCheckpoint({
      docId: DOC,
      upperBound: asRevisionId(1),
      nextStart: asRevisionId(2),
      completed: true,
      updatedAt: 11_000,
    });

    render(() => <App store={store} useWorker={false} />);
    await vi.advanceTimersByTimeAsync(45_100);

    await vi.waitFor(() => expect(screen.getByText("Retrieval unavailable")).toBeTruthy());
    expect(screen.queryByText("Settings & privacy")).toBeNull();
  });

  it("does not run raw cleanup or replay UI when decode produces unsupported data", async () => {
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
    await vi.waitFor(() => expect(screen.getByText("Unrecognized format")).toBeTruthy());

    expect(await store.getRawChunks(DOC)).toHaveLength(1);
    expect(screen.queryByText("Settings & privacy")).toBeNull();
  });

  it("does not load a stale publication whose id matches a bare remounted run counter", async () => {
    sendMessageMock.mockResolvedValue({ ok: true });
    const store = createMemoryStore();
    await store.saveReplayPublication(DOC, {
      publicationId: "1",
      parserVersion: PARSER_VERSION,
      revisions: [
        {
          revisionId: asRevisionId(1),
          userId: null,
          sessionId: null,
          time: null,
          operations: [{ ty: "is", s: "old", ibi: 1 }],
        },
      ],
      snapshots: [{ appliedCount: 0, model: createModel() }],
      timeline: [],
      publishedAt: 1,
    });

    render(() => <App store={store} useWorker={false} />);
    await vi.waitFor(() => expect(screen.getByText("No replay data")).toBeTruthy());

    expect(screen.queryByText("old")).toBeNull();
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
    const stalePublicationIds: string[] = [];
    const saveStalePublication = store.saveReplayPublication.bind(store);
    store.saveReplayPublication = async (docId, publication) => {
      stalePublicationIds.push(publication.publicationId);
      await saveStalePublication(docId, publication);
    };

    render(() => <App store={store} />);
    await vi.waitFor(() => expect(screen.getByText("Couldn't reconstruct")).toBeTruthy());

    expect(stalePublicationIds).toEqual([]);
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
    const freshPublicationIds: string[] = [];
    const saveFreshPublication = nextStore.saveReplayPublication.bind(nextStore);
    nextStore.saveReplayPublication = async (docId, publication) => {
      freshPublicationIds.push(publication.publicationId);
      await saveFreshPublication(docId, publication);
    };

    render(() => <App store={nextStore} />);
    await vi.waitFor(() => expect(screen.getByText("Settings & privacy")).toBeTruthy());

    expect(freshPublicationIds).toHaveLength(1);
    expect(freshPublicationIds[0]).not.toBe("1");
    expect(await nextStore.getReplayPublication(DOC, freshPublicationIds[0] ?? "")).not.toBeNull();
  });

  it("classifies worker unsupported and failed messages as non-replay states", async () => {
    sendMessageMock.mockResolvedValue({ ok: true });
    installFakeWorker((request) => ({
      kind: "unsupported",
      docId: request.docId,
      runId: request.runId,
      revisionCount: 0,
    }));

    render(() => <App store={createMemoryStore()} />);
    await vi.waitFor(() => expect(screen.getByText("Unrecognized format")).toBeTruthy());
    expect(screen.queryByText("Settings & privacy")).toBeNull();
    cleanup();

    installMatchMedia();
    setReplayUrl();
    sendMessageMock.mockResolvedValue({ ok: true });
    installFakeWorker((request) => ({
      kind: "failed",
      docId: request.docId,
      runId: request.runId,
      revisionCount: 0,
    }));

    render(() => <App store={createMemoryStore()} />);
    await vi.waitFor(() => expect(screen.getByText("Couldn't reconstruct")).toBeTruthy());
    expect(screen.queryByText("Settings & privacy")).toBeNull();
  });

  it("generates distinct publicationIds across remounts", async () => {
    sendMessageMock.mockResolvedValue({ ok: true });
    const store = createMemoryStore();
    const publicationIds: string[] = [];
    const savePublication = store.saveReplayPublication.bind(store);
    store.saveReplayPublication = async (docId, publication) => {
      publicationIds.push(publication.publicationId);
      await savePublication(docId, publication);
    };
    installFakeWorker((request) => ({
      kind: "done",
      docId: request.docId,
      runId: request.runId,
      revisionCount: 1,
      revisions: [decodedRevision()],
      snapshots: [{ appliedCount: 0, model: createModel() }],
      timeline: [],
    }));

    render(() => <App store={store} />);
    await vi.waitFor(() => expect(publicationIds).toHaveLength(1));
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

    render(() => <App store={store} />);
    await vi.waitFor(() => expect(publicationIds).toHaveLength(2));

    expect(new Set(publicationIds).size).toBe(2);
    expect(publicationIds).not.toContain("1");
  });
});
