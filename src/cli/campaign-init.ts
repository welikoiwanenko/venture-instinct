// Developer command: initialize a campaign and print a read-only inspection.
// This is an adapter, not domain code: it reads input files and writes to the
// terminal, then delegates everything else to the application API.
//
//   node src/cli/campaign-init.ts --seed <seed> --scenario <file> [--config <file>] [--json]

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  canonicalJson,
  formatManifestIssue,
  initializeCampaign,
  inspectCampaign,
  type CampaignSummary,
} from "../app/campaign-app.ts";

export const USAGE = "usage: campaign-init --seed <seed> --scenario <file.json> [--config <file.json>] [--json]";

export interface CliIo {
  readonly readFile: (path: string) => string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** Returns the process exit code. Nothing is written to stdout unless initialization succeeds. */
export function runCampaignInit(argv: readonly string[], io: CliIo): number {
  let values: { seed?: string; scenario?: string; config?: string; json?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        seed: { type: "string" },
        scenario: { type: "string" },
        config: { type: "string" },
        json: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    io.stderr(`${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }

  const problems: string[] = [];
  if (values.seed === undefined) problems.push("--seed is required");
  if (values.scenario === undefined) problems.push("--scenario is required");
  const scenario = values.scenario === undefined ? undefined : readJson(values.scenario, "scenario", io, problems);
  const config = values.config === undefined ? undefined : readJson(values.config, "config", io, problems);
  if (problems.length > 0) {
    io.stderr(`${problems.join("\n")}\n${USAGE}\n`);
    return 2;
  }

  const result = initializeCampaign({ seed: values.seed, scenario, config });
  if (!result.ok) {
    io.stderr(`Campaign not initialized:\n${result.issues.map((issue) => `  ${formatManifestIssue(issue)}`).join("\n")}\n`);
    return 1;
  }

  const summary = inspectCampaign(result.campaign);
  const { manifest } = result.campaign;
  if (values.json === true) {
    io.stdout(`${canonicalJson({ summary, manifest })}\n`);
  } else {
    io.stdout(`${formatSummary(summary)}\n\nManifest:\n${JSON.stringify(JSON.parse(canonicalJson(manifest)), null, 2)}\n`);
  }
  return 0;
}

export function formatSummary(s: CampaignSummary): string {
  const rows: Array<[string, string]> = [
    ["Campaign", s.campaignId],
    ["Seed", s.seed],
    ["Scenario", s.scenarioId],
    ["Config", `${s.configId} v${s.configVersion}`],
    ["Week", `planning week ${s.planningWeek}; ${s.completedWeeks} of ${s.horizonWeeks} completed`],
    ["Window", s.investmentWindowOpen ? "initial investments open" : "initial investments closed"],
    ["Slots", `${s.slotsAvailable} available`],
    ["Capital", `${formatCentsAsUsd(s.capitalAvailableCents)} available`],
    ["Invested", `${s.initialInvestmentsMade} of ${s.maxInitialInvestments} initial checks of ${formatCentsAsUsd(s.checkSizeCents)}`],
    ["Portfolio", s.portfolioSize === 0 ? "empty" : `${s.portfolioSize} companies`],
    ["State", s.stateHash],
  ];
  return rows.map(([label, value]) => `${label.padEnd(10)} ${value}`).join("\n");
}

/**
 * Fixed `$1,000,000` / `$12.50` style, independent of the host locale. Cents are
 * shown only when the amount is not a whole number of dollars.
 */
export function formatCentsAsUsd(cents: number): string {
  const absolute = Math.abs(cents);
  const remainder = absolute % 100;
  // Subtract first so the division is exact even near Number.MAX_SAFE_INTEGER.
  const dollars = String((absolute - remainder) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`;
  return `${cents < 0 ? "-" : ""}$${dollars}${fraction}`;
}

function readJson(path: string, label: string, io: CliIo, problems: string[]): unknown {
  let text: string;
  try {
    text = io.readFile(path);
  } catch (error) {
    problems.push(`--${label} ${path}: cannot read file (${(error as NodeJS.ErrnoException).code ?? (error as Error).message})`);
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    problems.push(`--${label} ${path}: invalid JSON (${(error as Error).message})`);
    return undefined;
  }
}

if (import.meta.main) {
  process.exitCode = runCampaignInit(process.argv.slice(2), {
    readFile: (path) => readFileSync(path, "utf8"),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
