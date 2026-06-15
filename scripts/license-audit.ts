// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Dependency license audit (PRD §11.6): DocRewind is AGPL-3.0-or-later, so every
// bundled/transitive dependency must be AGPL-compatible. This walks node_modules,
// reads each package root's `license` field, evaluates SPDX expressions (AND/OR),
// and exits non-zero if any package's license is not on the compatible allowlist.
//
// Bun runs this directly (`bun run audit:licenses`); it is wired into CI. It scans
// only true package roots (immediate children of a node_modules dir, descending
// into scopes and nested node_modules) so subpath package.json files and test
// fixtures are not mistaken for dependencies.
//
// Compatibility model: permissive (MIT/ISC/BSD/Apache/…) and weak-copyleft
// (MPL-2.0) licenses can be incorporated into an AGPL-3.0-or-later work; strong
// copyleft other than AGPL/GPL-3.0-compatible (and anything proprietary or
// unlicensed) is rejected. Dual-licensed `A OR B` passes if EITHER side is
// allowed; `A AND B` requires BOTH.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// SPDX identifiers that may be incorporated into an AGPL-3.0-or-later codebase.
const ALLOWED = new Set<string>([
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MPL-2.0",
  "Apache-2.0",
  "MIT",
  "MIT-0",
  "ISC",
  "BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
  "Python-2.0",
]);

// Per-package exceptions: name -> reason. Kept empty by design; add an entry only
// after a human confirms the license is compatible despite missing/odd metadata.
const EXCEPTIONS = new Map<string, string>();

interface Pkg {
  name: string;
  version: string | undefined;
  dir: string;
  license: string;
}

function readLicense(pkgJsonPath: string): {
  name: string | undefined;
  version: string | undefined;
  license: string;
} {
  const raw = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name : undefined;
  const version = typeof raw.version === "string" ? raw.version : undefined;
  let license = "";
  if (typeof raw.license === "string") {
    license = raw.license;
  } else if (raw.license && typeof raw.license === "object") {
    // Legacy { type, url } form.
    const t = (raw.license as Record<string, unknown>).type;
    if (typeof t === "string") license = t;
  } else if (typeof raw.licenses === "string") {
    // Malformed legacy form: `licenses` (plural) carrying a single SPDX string.
    license = raw.licenses;
  } else if (Array.isArray(raw.licenses)) {
    // Legacy [{ type }, …] form -> treat as an OR expression.
    const types = (raw.licenses as Array<Record<string, unknown> | string>)
      .map((l) => (typeof l === "string" ? l : typeof l.type === "string" ? l.type : ""))
      .filter(Boolean);
    if (types.length > 0) license = `(${types.join(" OR ")})`;
  }
  return { name, version, license };
}

function normalizeId(id: string): string {
  return id
    .trim()
    .replace(/^\(+|\)+$/g, "")
    .replace(/\+$/, "-or-later")
    .trim();
}

// Evaluate an SPDX license expression against ALLOWED, honoring parentheses and
// SPDX operator precedence (AND binds tighter than OR, so `A OR B AND C` parses
// as `A OR (B AND C)`).
//   - OR: pass if ANY operand passes
//   - AND: pass only if ALL operands pass
//
// Implemented as a tiny recursive-descent parser over the token stream rather
// than flat string splitting, which mis-handled nesting and precedence.
function isCompatible(expr: string): boolean {
  // Tokenize into parens, AND/OR operators, and license-id atoms.
  const tokens = expr.match(/\(|\)|\bAND\b|\bOR\b|[^()\s]+/gi);
  if (!tokens || tokens.length === 0) return false;

  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const isOp = (t: string | undefined, op: string): boolean =>
    t !== undefined && t.toUpperCase() === op;

  // orExpr := andExpr (OR andExpr)*
  function parseOr(): boolean {
    let result = parseAnd();
    while (isOp(peek(), "OR")) {
      pos++; // consume OR
      const right = parseAnd();
      result = result || right;
    }
    return result;
  }

  // andExpr := atom (AND atom)*
  function parseAnd(): boolean {
    let result = parseAtom();
    while (isOp(peek(), "AND")) {
      pos++; // consume AND
      const right = parseAtom();
      result = result && right;
    }
    return result;
  }

  // atom := '(' orExpr ')' | license-id
  function parseAtom(): boolean {
    const t = peek();
    if (t === undefined) return false;
    if (t === "(") {
      pos++; // consume (
      const inner = parseOr();
      if (peek() === ")") pos++; // consume matching )
      return inner;
    }
    pos++; // consume the license id
    return ALLOWED.has(normalizeId(t));
  }

  const value = parseOr();
  // Reject malformed expressions with leftover tokens (e.g. unbalanced parens).
  return pos === tokens.length && value;
}

// Collect package roots: immediate children of each node_modules dir (descending
// one level into @scopes), plus nested node_modules. Subpaths and fixtures inside
// a package are NOT package roots and are skipped.
function collectPackages(nodeModulesDir: string, out: Pkg[]): void {
  let entries: string[];
  try {
    entries = readdirSync(nodeModulesDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === ".bin" || entry === ".cache") continue;
    const entryPath = join(nodeModulesDir, entry);
    if (!safeIsDir(entryPath)) continue;

    if (entry.startsWith("@")) {
      // Scope dir: each child is a package root.
      for (const sub of safeReaddir(entryPath)) {
        const pkgDir = join(entryPath, sub);
        if (safeIsDir(pkgDir)) recordAndRecurse(pkgDir, out);
      }
      continue;
    }
    recordAndRecurse(entryPath, out);
  }
}

function recordAndRecurse(pkgDir: string, out: Pkg[]): void {
  const pkgJson = join(pkgDir, "package.json");
  if (existsSync(pkgJson)) {
    try {
      const { name, version, license } = readLicense(pkgJson);
      if (name) out.push({ name, version, dir: pkgDir, license });
    } catch {
      out.push({ name: pkgDir, version: undefined, dir: pkgDir, license: "" });
    }
  }
  const nested = join(pkgDir, "node_modules");
  if (safeIsDir(nested)) collectPackages(nested, out);
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeReaddir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

function main(): void {
  const root = join(process.cwd(), "node_modules");
  if (!existsSync(root)) {
    console.error("license-audit: node_modules not found — run `bun install` first.");
    process.exit(2);
  }

  const pkgs: Pkg[] = [];
  collectPackages(root, pkgs);

  // De-duplicate by name@version (the same dep can appear at multiple depths).
  const seen = new Set<string>();
  const unique = pkgs.filter((p) => {
    const key = `${p.name}@${p.version ?? "?"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const violations: Pkg[] = [];
  const byLicense = new Map<string, number>();
  for (const p of unique) {
    const expr = p.license || "(none)";
    byLicense.set(expr, (byLicense.get(expr) ?? 0) + 1);
    if (EXCEPTIONS.has(p.name)) continue;
    if (!p.license || !isCompatible(p.license)) violations.push(p);
  }

  console.log(`license-audit: scanned ${unique.length} packages`);
  for (const [lic, n] of [...byLicense.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${lic}`);
  }

  if (violations.length > 0) {
    console.error(`\nlicense-audit: ${violations.length} incompatible/unknown license(s):`);
    for (const v of violations) {
      console.error(`  ✗ ${v.name}@${v.version ?? "?"} — ${v.license || "(no license field)"}`);
    }
    console.error(
      "\nAGPL-3.0-or-later requires AGPL-compatible dependencies (PRD §11.6).\n" +
        "If a flagged package is actually compatible, add it to EXCEPTIONS with a reason,\n" +
        "or add its SPDX id to ALLOWED if it belongs on the allowlist.",
    );
    process.exit(1);
  }

  console.log("\nlicense-audit: OK — all dependency licenses are AGPL-compatible.");
}

main();
