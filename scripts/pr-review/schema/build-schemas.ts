// SPDX-License-Identifier: AGPL-3.0-or-later
//
// build-schemas.ts — derive two schema variants from the single canonical base
// (plan §5/§7, Critic M-B). One base, two derivations:
//
//   loose  — optionals stay optional. Injected into the Goose recipe's
//            `response.json_schema` and imported by the ajv validator
//            (lib/schema.ts). This is the variant the LLM is asked to satisfy.
//   strict — every property listed in `required`, optionals typed nullable,
//            `additionalProperties:false`. Drives NanoGPT-direct
//            `response_format` (lib/nanogpt-direct.ts), whose strict JSON-schema
//            mode wants a closed, fully-required shape.
//
// The build is deterministic and idempotent: running it twice leaves the
// generated files byte-identical, so CI can `git diff --exit-code` to prove the
// recipe, validator, and direct path never silently drift apart.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// scripts/pr-review/schema -> repo root is three directories up.
const repoRoot = join(here, "..", "..", "..");
const schemaDir = join(repoRoot, "schema");

const BASE_PATH = join(schemaDir, "review-output.base.schema.json");
const LOOSE_PATH = join(schemaDir, "review-output.loose.schema.json");
const STRICT_PATH = join(schemaDir, "review-output.strict.schema.json");

/** A minimal JSON-schema node shape — only the keywords this builder touches. */
type JsonSchemaNode = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  $id?: string;
  title?: string;
  [key: string]: unknown;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Stable serialization: 2-space indent + trailing newline (matches Biome JSON). */
function serialize(schema: JsonSchemaNode): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

/**
 * Recursively make every object node fully-required with nullable optionals.
 *
 * For each node carrying `properties`, the strict transform (a) lists every
 * property in `required`, and (b) for properties that were NOT already required,
 * widens their declared `type` to also permit `null` (e.g. integer -> integer|null).
 * `const`/`enum`-only optionals have no `type` to widen and are left as-is but
 * still listed in `required`. Recurses into `properties` and array `items`.
 */
function toStrict(node: JsonSchemaNode): void {
  if (node.properties) {
    const keys = Object.keys(node.properties);
    const wasRequired = new Set(node.required ?? []);
    for (const key of keys) {
      // biome-ignore lint/style/noNonNullAssertion: key comes from Object.keys(node.properties).
      const child = node.properties[key]!;
      if (!wasRequired.has(key) && child.type !== undefined) {
        child.type = Array.isArray(child.type)
          ? Array.from(new Set([...child.type, "null"]))
          : [child.type, "null"];
      }
      toStrict(child);
    }
    node.required = keys;
  }
  if (node.items) toStrict(node.items);
}

function build(): void {
  const base = JSON.parse(readFileSync(BASE_PATH, "utf8")) as JsonSchemaNode;

  // Loose: the base, re-identified so ajv never collides $id with the base file.
  const loose = clone(base);
  loose.$id = "https://docrewind/schema/review-output.loose.schema.json";
  loose.title = "PR review output (loose — Goose recipe + ajv validator)";

  // Strict: closed + fully-required + nullable optionals for NanoGPT-direct.
  const strict = clone(base);
  strict.$id = "https://docrewind/schema/review-output.strict.schema.json";
  strict.title = "PR review output (strict — NanoGPT-direct response_format)";
  toStrict(strict);

  writeFileSync(LOOSE_PATH, serialize(loose));
  writeFileSync(STRICT_PATH, serialize(strict));
}

build();
console.log("[build-schemas] wrote loose + strict variants to schema/");
