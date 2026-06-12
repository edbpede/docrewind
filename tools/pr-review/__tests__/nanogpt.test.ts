// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import {
  type ChatTransport,
  type CompletionResult,
  NanoGptAuthError,
  NanoGptExhaustedError,
  type NanoGptOptions,
  requestReview,
  resolveModels,
} from "../nanogpt";
import { silentLogger } from "./helpers";

const VALID = JSON.stringify({
  summary: "ok",
  risk_level: "low",
  review_decision: "no_comment",
  comments: [],
});

type Responder = (model: string, callIndex: number) => CompletionResult;

interface Fake extends ChatTransport {
  callsFor(model: string): number;
}

function fakeTransport(responder: Responder, modelIds: string[] = []): Fake {
  const counts = new Map<string, number>();
  return {
    async listModelIds(): Promise<string[]> {
      return modelIds;
    },
    async complete(req): Promise<CompletionResult> {
      const n = (counts.get(req.model) ?? 0) + 1;
      counts.set(req.model, n);
      return responder(req.model, n);
    },
    callsFor: (model) => counts.get(model) ?? 0,
  };
}

function opts(transport: ChatTransport): NanoGptOptions {
  return {
    transport,
    logger: silentLogger,
    backoffBaseMs: 1,
    maxRetries: 2,
    sleep: async () => {},
  };
}

function statusErr(status: number): never {
  throw { status };
}

describe("requestReview", () => {
  it("returns a validated review on first success", async () => {
    const t = fakeTransport(() => ({ content: VALID }));
    const { review, model } = await requestReview(["m1"], [], opts(t));
    expect(review.summary).toBe("ok");
    expect(model).toBe("m1");
  });

  it("retries a transient 429 then succeeds", async () => {
    const t = fakeTransport((_m, call) => (call === 1 ? statusErr(429) : { content: VALID }));
    const { model } = await requestReview(["m1"], [], opts(t));
    expect(model).toBe("m1");
    expect(t.callsFor("m1")).toBe(2);
  });

  it("fails fast on a 401 auth error", async () => {
    const t = fakeTransport(() => statusErr(401));
    await expect(requestReview(["m1"], [], opts(t))).rejects.toBeInstanceOf(NanoGptAuthError);
  });

  it("falls back to the next model on context-length errors", async () => {
    const t = fakeTransport((model) => {
      if (model === "m1") {
        throw { code: "context_length_exceeded" };
      }
      return { content: VALID };
    });
    const { model } = await requestReview(["m1", "m2"], [], opts(t));
    expect(model).toBe("m2");
  });

  it("re-asks once on invalid JSON, then moves to the next model", async () => {
    const t = fakeTransport((model) =>
      model === "m1" ? { content: "{ not json" } : { content: VALID },
    );
    const { model } = await requestReview(["m1", "m2"], [], opts(t));
    expect(model).toBe("m2");
    expect(t.callsFor("m1")).toBe(2); // initial + one re-ask
  });

  it("strips chain-of-thought wrappers before parsing", async () => {
    const t = fakeTransport(() => ({ content: `<think>secret reasoning</think>${VALID}` }));
    const { review } = await requestReview(["m1"], [], opts(t));
    expect(review.summary).toBe("ok");
  });

  it("accepts content that is already a parsed object", async () => {
    const t = fakeTransport(() => ({ content: JSON.parse(VALID) }));
    const { review } = await requestReview(["m1"], [], opts(t));
    expect(review.summary).toBe("ok");
  });

  it("throws NanoGptExhaustedError when every model fails", async () => {
    const t = fakeTransport(() => statusErr(500));
    await expect(requestReview(["m1"], [], { ...opts(t), maxRetries: 1 })).rejects.toBeInstanceOf(
      NanoGptExhaustedError,
    );
  });
});

describe("resolveModels", () => {
  it("returns the full tiered list unchanged when all models are listed", async () => {
    const t = fakeTransport(() => ({ content: VALID }), ["a", "b"]);
    const resolved = await resolveModels(t, ["a", "b"], silentLogger);
    expect(resolved).toEqual(["a", "b"]);
  });

  it("keeps unlisted models in the list (verification is observability-only)", async () => {
    const t = fakeTransport(() => ({ content: VALID }), ["a"]);
    const resolved = await resolveModels(t, ["a", "b"], silentLogger);
    expect(resolved).toEqual(["a", "b"]);
  });

  it("never substitutes a different model when none are listed", async () => {
    const t = fakeTransport(() => ({ content: VALID }), ["x"]);
    const resolved = await resolveModels(t, ["a", "b"], silentLogger);
    expect(resolved).toEqual(["a", "b"]);
  });

  it("proceeds with the configured list when the models endpoint fails", async () => {
    const t: ChatTransport = {
      async listModelIds(): Promise<string[]> {
        throw new Error("network down");
      },
      async complete(): Promise<CompletionResult> {
        return { content: VALID };
      },
    };
    const resolved = await resolveModels(t, ["a", "b"], silentLogger);
    expect(resolved).toEqual(["a", "b"]);
  });
});
