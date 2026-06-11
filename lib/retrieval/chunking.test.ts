// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { asRevisionId } from "../domain/ids";
import {
  BASE_BACKOFF_MS,
  backoffDelay,
  DEFAULT_CHUNK_SIZE,
  growChunkSize,
  MAX_BACKOFF_MS,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  nextChunkSpan,
  shrinkChunkSize,
} from "./chunking";

describe("adaptive chunk sizing", () => {
  test("grows by doubling, capped at MAX_CHUNK_SIZE", () => {
    expect(growChunkSize(DEFAULT_CHUNK_SIZE)).toBe(200);
    expect(growChunkSize(MAX_CHUNK_SIZE)).toBe(MAX_CHUNK_SIZE);
    expect(growChunkSize(800)).toBe(MAX_CHUNK_SIZE); // 1600 capped to 1000
  });

  test("shrinks by halving, floored at MIN_CHUNK_SIZE", () => {
    expect(shrinkChunkSize(100)).toBe(50);
    expect(shrinkChunkSize(MIN_CHUNK_SIZE)).toBe(MIN_CHUNK_SIZE);
    expect(shrinkChunkSize(11)).toBe(MIN_CHUNK_SIZE); // floor(5.5)=5 -> floored to 10
  });
});

describe("exponential backoff", () => {
  test("doubles per attempt from the base", () => {
    expect(backoffDelay(0)).toBe(BASE_BACKOFF_MS);
    expect(backoffDelay(1)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffDelay(2)).toBe(BASE_BACKOFF_MS * 4);
  });

  test("caps at MAX_BACKOFF_MS", () => {
    expect(backoffDelay(100)).toBe(MAX_BACKOFF_MS);
  });

  test("treats a negative attempt as the base delay", () => {
    expect(backoffDelay(-1)).toBe(BASE_BACKOFF_MS);
  });
});

describe("nextChunkSpan", () => {
  test("returns an inclusive span of the requested size", () => {
    const span = nextChunkSpan(asRevisionId(1), 100, asRevisionId(1000));
    expect(span).toEqual({ start: asRevisionId(1), end: asRevisionId(100) });
  });

  test("clamps the end to the upper bound", () => {
    const span = nextChunkSpan(asRevisionId(950), 100, asRevisionId(1000));
    expect(span).toEqual({ start: asRevisionId(950), end: asRevisionId(1000) });
  });

  test("returns null once nextStart passes the upper bound", () => {
    expect(nextChunkSpan(asRevisionId(1001), 100, asRevisionId(1000))).toBeNull();
  });

  test("handles a single-revision tail", () => {
    const span = nextChunkSpan(asRevisionId(1000), 100, asRevisionId(1000));
    expect(span).toEqual({ start: asRevisionId(1000), end: asRevisionId(1000) });
  });
});
