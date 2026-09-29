// docs/design-doc.md §17.1: the TUI is an adapter without its own rules. It may import
// other TUI modules, the application API (src/app/), its UI libraries and node:*; a
// direct import of domain internals or hidden state fails this test.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TUI_DIR = join(ROOT, "src", "tui");
const APP_DIR = join(ROOT, "src", "app");
const ALLOWED_PACKAGES = new Set(["ink", "react"]);

const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

export function forbiddenImports(file: string, source: string): string[] {
  const problems: string[] = [];
  for (const [, specifier] of source.matchAll(IMPORT_PATTERN)) {
    if (specifier === undefined || specifier.startsWith("node:")) continue;
    if (!specifier.startsWith(".")) {
      if (!ALLOWED_PACKAGES.has(specifier.split("/")[0] ?? "")) problems.push(`${specifier} (package not allowed)`);
      continue;
    }
    const target = resolve(dirname(file), specifier);
    const inside = (dir: string) => target === dir || target.startsWith(`${dir}${sep}`);
    if (!inside(TUI_DIR) && !inside(APP_DIR)) problems.push(`${specifier} (resolves to ${relative(ROOT, target)})`);
  }
  return problems;
}

function tuiFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? tuiFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("TUI code imports only the application API, TUI modules and its UI libraries", () => {
  const files = tuiFiles(TUI_DIR);
  assert.ok(files.length > 0);
  const problems = files.flatMap((file) =>
    forbiddenImports(file, readFileSync(file, "utf8")).map((p) => `${relative(ROOT, file)}: ${p}`),
  );
  assert.deepEqual(problems, []);
});

test("the boundary check rejects domain internals, hidden state and other adapters", () => {
  const file = join(TUI_DIR, "example.ts");
  const source = [
    `import { x } from "../campaign/initial-state.ts";`,
    `import type { y } from "../config/baseline.ts";`,
    `export { z } from "../manifest/canonical-json.ts";`,
    `const w = await import("../cli/campaign-init.ts");`,
    `import "../data/plain-data.ts";`,
    `import chalk from "chalk";`,
    `import { ok } from "../app/campaign-app.ts";`,
    `import { Box } from "ink";`,
    `import { readFileSync } from "node:fs";`,
    `import { SECTIONS } from "./model.ts";`,
  ].join("\n");
  assert.deepEqual(forbiddenImports(file, source), [
    "../campaign/initial-state.ts (resolves to src/campaign/initial-state.ts)",
    "../config/baseline.ts (resolves to src/config/baseline.ts)",
    "../manifest/canonical-json.ts (resolves to src/manifest/canonical-json.ts)",
    "../cli/campaign-init.ts (resolves to src/cli/campaign-init.ts)",
    "../data/plain-data.ts (resolves to src/data/plain-data.ts)",
    "chalk (package not allowed)",
  ]);
});
