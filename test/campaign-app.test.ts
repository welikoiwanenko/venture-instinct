import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { formatCentsAsUsd, initializeCampaign, inspectCampaign, type Campaign } from "../src/app/campaign-app.ts";
import { runCampaignInit } from "../src/cli/campaign-init.ts";
import { POC_BASELINE_CONFIG } from "../src/config/baseline.ts";
import { canonicalJson } from "../src/manifest/canonical-json.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCENARIO_PATH = "fixtures/scenarios/technical-empty.json";
const INVALID_CONFIG_PATH = "fixtures/configs/invalid-over-budget.json";

function fixtureScenario(): unknown {
  return JSON.parse(readFileSync(new URL(`../${SCENARIO_PATH}`, import.meta.url), "utf8"));
}

function baselineCampaign(seed = "demo-1"): Campaign {
  const result = initializeCampaign({ seed, scenario: fixtureScenario() });
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues));
  return result.campaign;
}

function runCli(argv: string[]): { code: number; stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const code = runCampaignInit(argv, {
    readFile: (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr };
}

test("baseline campaign starts in planning week 1 with the §5 resources", () => {
  const summary = inspectCampaign(baselineCampaign());
  assert.equal(summary.planningWeek, 1);
  assert.equal(summary.completedWeeks, 0);
  assert.equal(summary.slotsAvailable, 5);
  assert.equal(summary.capitalAvailableCents, 100_000_000);
  assert.equal(summary.initialInvestmentsMade, 0);
  assert.equal(summary.checkSizeCents, 20_000_000);
  assert.equal(summary.portfolioSize, 0);
  assert.equal(summary.investmentWindowOpen, true);
  assert.equal(summary.scenarioId, "technical-fixture-empty");
});

test("the campaign keeps its configuration snapshot and manifest", () => {
  const campaign = baselineCampaign();
  assert.deepEqual(campaign.config, POC_BASELINE_CONFIG);
  assert.ok(Object.isFrozen(campaign.config));
  assert.equal(campaign.config, campaign.manifest.config);
  assert.equal(campaign.id, campaign.manifest.campaignId);
  assert.equal(campaign.state, campaign.manifest.initialState);
  assert.equal(inspectCampaign(campaign).stateHash, campaign.manifest.initialStateHash);
});

test("an explicit config is snapshotted, not referenced", () => {
  const config = { ...structuredClone(POC_BASELINE_CONFIG), slotsPerWeek: 4 };
  const result = initializeCampaign({ seed: "demo-1", scenario: fixtureScenario(), config });
  assert.ok(result.ok);
  config.slotsPerWeek = 9;
  assert.equal(result.campaign.config.slotsPerWeek, 4);
  assert.equal(inspectCampaign(result.campaign).slotsAvailable, 4);
});

test("repeated inspection leaves state and output unchanged", () => {
  const campaign = baselineCampaign();
  const before = canonicalJson(campaign);
  const first = canonicalJson(inspectCampaign(campaign));
  for (let i = 0; i < 3; i++) {
    assert.equal(canonicalJson(inspectCampaign(campaign)), first);
  }
  assert.equal(canonicalJson(campaign), before);
  assert.ok(Object.isFrozen(campaign));
  assert.ok(Object.isFrozen(campaign.state.budget));
});

test("identical inputs reproduce the same campaign", () => {
  assert.equal(canonicalJson(baselineCampaign()), canonicalJson(baselineCampaign()));
  assert.notEqual(baselineCampaign("demo-2").id, baselineCampaign().id);
});

test("invalid input returns every issue and no campaign", () => {
  const config = JSON.parse(readFileSync(new URL(`../${INVALID_CONFIG_PATH}`, import.meta.url), "utf8")) as unknown;
  const result = initializeCampaign({ seed: "has space", scenario: { id: "x" }, config });
  assert.equal(result.ok, false);
  assert.ok(!("campaign" in result));
  const paths = result.ok ? [] : result.issues.map((issue) => issue.path);
  for (const path of ["seed", "scenario.contentVersion", "scenario.content", "config.slotsPerWeek", "config.maxInitialInvestments"]) {
    assert.ok(paths.includes(path), `${path} missing from ${JSON.stringify(paths)}`);
  }
});

test("CLI prints the summary and manifest; repeated runs are identical", () => {
  const first = runCli(["--seed", "demo-1", "--scenario", SCENARIO_PATH]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stderr, "");
  assert.match(first.stdout, /^Campaign {3}cmp-[0-9a-f]{16}$/m);
  assert.match(first.stdout, /^Week {7}planning week 1; 0 of 156 completed$/m);
  assert.match(first.stdout, /^Slots {6}5 available$/m);
  assert.match(first.stdout, /^Capital {4}\$1,000,000 available$/m);
  assert.match(first.stdout, /^Invested {3}0 of 5 initial checks of \$200,000$/m);
  assert.match(first.stdout, /^Portfolio {2}empty$/m);
  assert.match(first.stdout, /^Companies {2}0 known$/m);
  assert.match(first.stdout, /^Manifest:\n\{/m);
  assert.equal(runCli(["--seed", "demo-1", "--scenario", SCENARIO_PATH]).stdout, first.stdout);
});

test("CLI --json output is the canonical summary and manifest", () => {
  const run = runCli(["--seed", "demo-1", "--scenario", SCENARIO_PATH, "--json"]);
  assert.equal(run.code, 0, run.stderr);
  const campaign = baselineCampaign();
  assert.equal(run.stdout, `${canonicalJson({ summary: inspectCampaign(campaign), manifest: campaign.manifest })}\n`);
});

test("CLI rejects invalid input on stderr with nothing on stdout", () => {
  const table: Array<[string[], number, RegExp]> = [
    [["--seed", "demo-1", "--scenario", SCENARIO_PATH, "--config", INVALID_CONFIG_PATH], 1, /config\.maxInitialInvestments: 6 checks/],
    [["--scenario", SCENARIO_PATH], 2, /--seed is required/],
    [["--seed", "demo-1"], 2, /--scenario is required/],
    [["--seed", "demo-1", "--scenario", "fixtures/missing.json"], 2, /cannot read file \(ENOENT\)/],
    [["--seed", "demo-1", "--scenario", "README.md"], 2, /--scenario README\.md: invalid JSON/],
    [["--seed", "demo-1", "--scenario", SCENARIO_PATH, "--bogus"], 2, /Unknown option '--bogus'/],
  ];
  for (const [argv, code, message] of table) {
    const run = runCli(argv);
    assert.equal(run.code, code, argv.join(" "));
    assert.equal(run.stdout, "", argv.join(" "));
    assert.match(run.stderr, message, argv.join(" "));
  }
});

test("CLI entry point prints identical output across processes, time zones and locales", () => {
  const outputs = [
    { TZ: "UTC", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
    { TZ: "Asia/Kathmandu", LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8" },
  ].map((env) => {
    const run = spawnSync(process.execPath, ["src/cli/campaign-init.ts", "--seed", "demo-1", "--scenario", SCENARIO_PATH], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  });
  assert.equal(outputs[1], outputs[0]);
  assert.equal(outputs[0], runCli(["--seed", "demo-1", "--scenario", SCENARIO_PATH]).stdout);
});

test("cents are shown as US dollars independently of locale", () => {
  assert.equal(formatCentsAsUsd(100_000_000), "$1,000,000");
  assert.equal(formatCentsAsUsd(99_900), "$999");
  assert.equal(formatCentsAsUsd(1250), "$12.50");
  assert.equal(formatCentsAsUsd(5), "$0.05");
  assert.equal(formatCentsAsUsd(0), "$0");
  assert.equal(formatCentsAsUsd(-120_000_000), "-$1,200,000");
  assert.equal(formatCentsAsUsd(-1), "-$0.01");
  assert.equal(formatCentsAsUsd(Number.MAX_SAFE_INTEGER), "$90,071,992,547,409.91");
});

test("the CLI imports only the application layer", () => {
  const source = readFileSync(new URL("../src/cli/campaign-init.ts", import.meta.url), "utf8");
  const local = [...source.matchAll(/from "(\.[^"]*)"/g)].map((match) => match[1]);
  // The developer CLI may use the debug API; player-facing adapters may not.
  assert.deepEqual(local, ["../app/campaign-app.ts", "../app/debug.ts"]);
});
