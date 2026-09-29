// TUI launcher: `npm run tui` (full screen) or `npm run tui -- --text` (linear text).
// `--scenario <file.json>` replaces the baseline scenario fixture for new campaigns.
// Adapter code: it talks to the terminal and, through src/app/, to the domain; it
// never imports domain internals (enforced by test/tui-boundary.test.ts).

import { render } from "ink";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { App, type ScreenExit } from "./ink-app.ts";
import { initialTuiState } from "./model.ts";
import type { ScenarioSource } from "./session.ts";
import { runTextMode } from "./text-mode.ts";

export const USAGE = "usage: tui [--text] [--scenario <file.json>]";

/** The Gamma pack the VI-18 command documents, resolved from the repository root. */
const BASELINE_SCENARIO = fileURLToPath(new URL("../../content/scenarios/gamma-three-companies.json", import.meta.url));

export async function main(argv: readonly string[]): Promise<number> {
  let text: boolean;
  let scenarioPath: string;
  try {
    ({ values: { text = false, scenario: scenarioPath = BASELINE_SCENARIO } } = parseArgs({
      args: [...argv],
      options: { text: { type: "boolean" }, scenario: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }

  const source: ScenarioSource = {
    label: relative(process.cwd(), scenarioPath) || scenarioPath,
    read: () => readFileSync(scenarioPath, "utf8"),
  };
  let state = initialTuiState();
  // Full screen needs a keyboard in raw mode and a terminal to draw on; anything else
  // (pipes, CI, screen readers that prefer it) gets the linear mode.
  if (!text && process.stdin.isTTY && process.stdout.isTTY) {
    const app = render(createElement(App, { initial: state, source }), { alternateScreen: true });
    const result = (await app.waitUntilExit()) as ScreenExit | undefined;
    if (result?.next !== "text-mode") return 0;
    state = result.state;
    // Ink unrefs stdin on unmount; without this the process exits before reading a line.
    process.stdin.ref();
  }
  await runTextMode(state, { input: process.stdin, write: (t) => process.stdout.write(t) }, source);
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
