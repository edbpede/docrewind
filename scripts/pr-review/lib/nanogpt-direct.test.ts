// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { type ChatMessage, callNanoGptDirect } from "./nanogpt-direct";

const messages: ChatMessage[] = [
  { role: "system", content: "be precise" },
  { role: "user", content: "review this" },
];

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("callNanoGptDirect", () => {
  test("sends strict json_schema response_format and parses content", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      captured = { url, body: JSON.parse(String(init?.body)) };
      return jsonResponse({
        choices: [{ message: { content: '{"summary":"x"}', reasoning: "thinking..." } }],
      });
    }) as unknown as typeof fetch;

    const r = await callNanoGptDirect(messages, { apiKey: "k", model: "m1", fetchImpl });
    expect(r).toEqual({ ok: true, output: { summary: "x" }, reasoning: "thinking..." });
    expect(captured).not.toBeNull();
    const body = captured as { url: string; body: Record<string, unknown> } | null;
    expect(body?.url).toContain("/chat/completions");
    const rf = body?.body.response_format as { type: string; json_schema: { strict: boolean } };
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.strict).toBe(true);
  });

  test("maps a non-2xx status to http_<status>", async () => {
    const fetchImpl = (async () => jsonResponse({ error: "nope" }, 429)) as unknown as typeof fetch;
    const r = await callNanoGptDirect(messages, { apiKey: "k", model: "m", fetchImpl });
    expect(r).toEqual({ ok: false, reason: "http_429" });
  });

  test("reports content_not_json when the model returns prose", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        choices: [{ message: { content: "I found nothing." } }],
      })) as unknown as typeof fetch;
    const r = await callNanoGptDirect(messages, { apiKey: "k", model: "m", fetchImpl });
    expect(r).toEqual({ ok: false, reason: "content_not_json" });
  });

  test("reports empty_content when content is missing", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ choices: [{ message: {} }] })) as unknown as typeof fetch;
    const r = await callNanoGptDirect(messages, { apiKey: "k", model: "m", fetchImpl });
    expect(r).toEqual({ ok: false, reason: "empty_content" });
  });

  test("reports network_error when fetch throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r = await callNanoGptDirect(messages, { apiKey: "k", model: "m", fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("network_error");
  });
});
