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
const promptDir = join(repoRoot, "prompt");
const RECIPE_PATH = join(repoRoot, ".goose", "recipes", "pr-review.yaml");

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

/** Indent every line by two spaces for a YAML block scalar; keep blanks empty. */
function blockScalar(text: string): string {
  return text
    .replace(/\s+$/, "")
    .split("\n")
    .map((line) => (line.length === 0 ? "" : `  ${line}`))
    .join("\n");
}

/**
 * Generate the Goose recipe from the prompt fragments + the loose schema, so the
 * recipe is never hand-edited and CI can git-diff-gate it (plan §5/§8, M3). The
 * `instructions` (system) come from 00-system + 70-injection-boundary; the
 * `prompt` (user) concatenates the task fragments and ends with the untrusted PR
 * context/diff placeholders Goose fills from the file params. `response.json_schema`
 * is the loose variant inlined as YAML flow (JSON is valid YAML).
 */
function buildRecipe(loose: JsonSchemaNode): string {
  const frag = (name: string): string => readFileSync(join(promptDir, name), "utf8").trimEnd();

  const instructions = `${frag("00-system.md")}\n\n${frag("70-injection-boundary.md")}`;
  const prompt = [
    frag("20-review-task.md"),
    frag("30-review-philosophy.md"),
    frag("40-inline-comment-rules.md"),
    frag("50-output-contract.md"),
    frag("60-self-check.md"),
    frag("10-pr-context.md.jinja"),
  ].join("\n\n");

  // Embed the loose schema without the JSON-Schema meta keys Goose does not need.
  const embedded = clone(loose) as Record<string, unknown>;
  delete embedded.$schema;
  delete embedded.$id;
  delete embedded.title;
  delete embedded.description;
  const schemaFlow = JSON.stringify(embedded);

  return [
    "# GENERATED FILE — do not edit by hand.",
    "# Source: prompt/*.md fragments + schema/review-output.base.schema.json.",
    "# Regenerate with `bun run schemas:build`; CI git-diff-gates this file.",
    'version: "1.0.0"',
    'title: "DocRewind PR reviewer"',
    'description: "Low-noise inline PR reviewer. Emits a single COMMENT review as structured JSON; deterministic code validates, anchors, and posts."',
    "settings:",
    "  goose_provider: openai",
    '  goose_model: "deepseek/deepseek-v4-pro-cheaper:thinking"',
    "  temperature: 0.1",
    "parameters:",
    "  - key: pr_context_file",
    "    input_type: file",
    "    requirement: required",
    '    description: "Path to pr-context.json (PR meta, anchorable file set, existing comments)."',
    "  - key: diff_file",
    "    input_type: file",
    "    requirement: required",
    '    description: "Path to pr.diff (the reconstructed unified diff)."',
    "# Extensions disabled: the model gets no shell, no GitHub, no file mutation —",
    "# only the internal final_output tool that delivers response.json_schema.",
    "extensions: []",
    "instructions: |",
    blockScalar(instructions),
    "prompt: |",
    blockScalar(prompt),
    "response:",
    `  json_schema: ${schemaFlow}`,
    "",
  ].join("\n");
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
  writeFileSync(RECIPE_PATH, buildRecipe(loose));
}

build();
console.log("[build-schemas] wrote loose + strict variants + Goose recipe");
