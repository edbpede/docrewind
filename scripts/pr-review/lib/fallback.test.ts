// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import {
  extractFinalOutput,
  type FallbackDeps,
  type GooseRunner,
  isDegenerate,
  runFallback,
  type SchemaValidate,
} from "./fallback";
import type { ReviewOutput } from "./types";

function output(over: Partial<ReviewOutput> = {}): ReviewOutput {
  return {
    schema_version: "1.0",
    summary: "A substantive summary that comfortably exceeds the minimum length threshold.",
    should_post_review: true,
    review_event: "COMMENT",
    comments: [],
    dropped_or_uncertain_findings: [],
    ...over,
  };
}

const passValidate: SchemaValidate = (v) => ({ ok: true, value: v as ReviewOutput });

function deps(over: Partial<FallbackDeps>): FallbackDeps {
  return {
    models: ["m1", "m2", "m3"],
    runner: async () => ({ kind: "completed", stdout: JSON.stringify(output()) }),
    validate: passValidate,
    now: () => 0,
    perAttemptTimeoutMs: 1000,
    globalBudgetMs: 60_000,
    retriesPerModel: 0,
    minSubstantiveSummary: 40,
    ...over,
  };
}

describe("extractFinalOutput", () => {
  test("parses whole-output JSON", () => {
    expect(extractFinalOutput('{"a":1}')).toEqual({ a: 1 });
  });
  test("parses the last line after log noise", () => {
    const stdout = ["INFO starting", "INFO calling model", JSON.stringify({ ok: true })].join("\n");
    expect(extractFinalOutput(stdout)).toEqual({ ok: true });
  });
  test("recovers a trailing brace block embedded in text", () => {
    const stdout = 'noise before {"x":2} and trailing words';
    expect(extractFinalOutput(stdout)).toEqual({ x: 2 });
  });
  test("returns null for prose with no JSON (prose-instead-of-tool-call)", () => {
    expect(extractFinalOutput("I reviewed the code and found nothing.")).toBeNull();
  });
  test("returns null for empty output", () => {
    expect(extractFinalOutput("   \n  ")).toBeNull();
  });
});

describe("isDegenerate", () => {
  test("empty comments + thin summary + empty dropped = degenerate", () => {
    expect(isDegenerate(output({ summary: "ok" }), 40)).toBe(true);
  });
  test("substantive summary rescues an empty review", () => {
    expect(isDegenerate(output(), 40)).toBe(false);
  });
  test("a non-empty dropped list rescues an empty review", () => {
    expect(
      isDegenerate(
        output({ summary: "x", dropped_or_uncertain_findings: [{ path: "a", reason: "r" }] }),
        40,
      ),
    ).toBe(false);
  });
});

describe("runFallback", () => {
  test("first model succeeds -> fallback_attempts 0, model_used ground truth", async () => {
    const r = await runFallback(deps({}));
    expect(r.ok).toBe(true);
    expect(r.model_used).toBe("m1");
    expect(r.fallback_attempts).toBe(0);
    expect(r.output?.model_used).toBe("m1");
  });

  test("transport error on m1 advances to m2", async () => {
    let call = 0;
    const runner: GooseRunner = async (model) => {
      call += 1;
      if (model === "m1") return { kind: "transport_error" };
      return { kind: "completed", stdout: JSON.stringify(output()) };
    };
    const r = await runFallback(deps({ runner }));
    expect(r.model_used).toBe("m2");
    expect(r.fallback_attempts).toBe(1);
    expect(call).toBe(2);
  });

  test("schema-invalid output advances", async () => {
    const validate: SchemaValidate = (v) =>
      (v as ReviewOutput).model_used === "good"
        ? { ok: true, value: v as ReviewOutput }
        : { ok: false, errors: ["bad"] };
    const runner: GooseRunner = async (model) => ({
      kind: "completed",
      stdout: JSON.stringify(output({ model_used: model === "m3" ? "good" : "bad" })),
    });
    const r = await runFallback(deps({ runner, validate }));
    expect(r.model_used).toBe("m3");
    expect(r.fallback_attempts).toBe(2);
  });

  test("degenerate-empty advances; legitimate-empty does not", async () => {
    const runner: GooseRunner = async (model) => ({
      kind: "completed",
      // m1 degenerate (thin summary), m2 legitimate empty (substantive summary).
      stdout: JSON.stringify(model === "m1" ? output({ summary: "no" }) : output()),
    });
    const r = await runFallback(deps({ runner }));
    expect(r.ok).toBe(true);
    expect(r.model_used).toBe("m2");
  });

  test("all models fail -> ok:false all_models_failed", async () => {
    const r = await runFallback(deps({ runner: async () => ({ kind: "transport_error" }) }));
    expect(r).toEqual({
      ok: false,
      reason: "all_models_failed",
      model_used: null,
      fallback_attempts: 3,
    });
  });

  test("global budget guard stops before overrun (clock-mocked)", async () => {
    let t = 0;
    // Each now() advances time; budget only fits one attempt.
    const r = await runFallback(
      deps({
        now: () => {
          t += 600;
          return t;
        },
        perAttemptTimeoutMs: 500,
        globalBudgetMs: 700,
        runner: async () => ({ kind: "transport_error" }),
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("budget_exhausted");
  });
});
