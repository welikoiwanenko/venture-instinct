// VI-18: a campaign initialized from the Gamma pack, inspected as the player and as a
// developer through the documented command.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { canonicalJson, formatBasisPoints, initializeCampaign, inspectCampaign, viewAsPlayer, type Campaign } from "../src/app/campaign-app.ts";
import { viewForDebug } from "../src/app/debug.ts";
import { runCampaignInit } from "../src/cli/campaign-init.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACK_PATH = "content/scenarios/gamma-three-companies.json";

type Json = Record<string, any>;

function pack(): Json {
  return JSON.parse(readFileSync(new URL(`../${PACK_PATH}`, import.meta.url), "utf8")) as Json;
}

function campaign(seed = "demo-1", scenario: unknown = pack()): Campaign {
  const result = initializeCampaign({ seed, scenario });
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues));
  return result.campaign;
}

/** Runs the command; `files` overrides what a path reads as. */
function cli(argv: string[], files: Record<string, string> = {}): { code: number; stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const code = runCampaignInit(argv, {
    readFile: (path) => files[path] ?? readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr };
}

test("initialization delivers the week 1 applications of the two inbound companies", () => {
  const { state } = campaign();
  assert.deepEqual(
    state.observations.observations.map((o) => o.observationId),
    [
      "obs-co-tracebench-application",
      "obs-co-tracebench-application-paying-customers",
      "obs-co-tracebench-application-weekly-revenue-cents",
      "obs-co-tracebench-application-team-size",
      "obs-co-papirflow-application",
      "obs-co-papirflow-application-paying-customers",
      "obs-co-papirflow-application-weekly-revenue-cents",
      "obs-co-papirflow-application-largest-customer-share-bps",
      "obs-co-papirflow-application-weekly-burn-cents",
    ],
  );
  for (const o of state.observations.observations) {
    assert.equal(o.receivedWeek, 1);
    assert.equal(o.source.kind, "founder");
    if (o.content.kind === "metric") assert.deepEqual(o.references, [`obs-${o.companyId}-application`]);
  }
  assert.equal(state.observations.provenance.length, state.observations.observations.length);
  assert.ok(!state.observations.observations.some((o) => o.companyId === "co-rampa"));
  assert.equal(inspectCampaign(campaign()).knownCompanies, 2);
});

test("the player view lists exactly the two inbound companies with their applications", () => {
  const view = viewAsPlayer(campaign());
  assert.deepEqual(
    view.companies.map((c) => c.companyId),
    ["co-tracebench", "co-papirflow"],
  );
  for (const company of view.companies) {
    const application = company.observations.find((o) => o.content.kind === "text");
    assert.ok(application?.content.kind === "text" && application.content.text.length > 200, company.companyId);
  }
  const run = cli(["--seed", "demo-1", "--scenario", PACK_PATH, "--view", "player"]);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /^2 known companies$/m);
  assert.match(run.stdout, /^1\. Tracebench \(co-tracebench\)$/m);
  assert.match(run.stdout, /^2\. Papirflow \(co-papirflow\)$/m);
  assert.match(run.stdout, /· Paying customers: 19\n {7}received week 1 from Остап Гнатюк \(founder\) · week 0 \(before the campaign\) · ◇ founder claim/);
  assert.match(run.stdout, /· Largest customer's share of revenue: 18%/);
  assert.match(run.stdout, /Tracebench знаходить нестабільні тести в CI/);
  for (const hidden of ["Rampa", "co-rampa", "Савчук", "truth", "Trade-off", "counts-pilots", "lifecycle", "fit "]) {
    assert.ok(!run.stdout.includes(hidden), `${hidden} is in the player view`);
  }
  const json = cli(["--seed", "demo-1", "--scenario", PACK_PATH, "--view", "player", "--json"]);
  assert.equal(json.stdout, `${canonicalJson(view)}\n`);
});

test("the debug view shows all three companies with hidden state", () => {
  const debug = viewForDebug(campaign());
  assert.deepEqual(
    debug.companies.map((c) => c.profile.id),
    ["co-tracebench", "co-papirflow", "co-rampa"],
  );
  const run = cli(["--seed", "demo-1", "--scenario", PACK_PATH, "--view", "debug"]);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /^DEBUG VIEW \(developer only/);
  assert.match(run.stdout, /^co-rampa {2}Rampa · logistics-software · starts unknown$/m);
  assert.match(run.stdout, /^ {2}State {6}knowledge unknown · .* · lifecycle operating$/m);
  assert.match(run.stdout, /cash \$210,000 · price \$180\/week · 7 paying customers · largest 26% · 9 leads\/week · fit 71\/100/);
  assert.match(run.stdout, /Paying customers 19 · truth 7 · counts-pilots-as-paying: Only 7 teams pay/);
  assert.match(run.stdout, /Weekly costs \$9,200\/week · truth \$20,600\/week · excludes-contractor-costs/);
  assert.match(run.stdout, /^ {2}Evidence {3}none delivered$/m);
  const json = cli(["--seed", "demo-1", "--scenario", PACK_PATH, "--view", "debug", "--json"]);
  assert.equal(json.stdout, `${canonicalJson(debug)}\n`);
});

test("the same inputs give identical state and output; a changed pack changes the manifest hash", () => {
  assert.equal(canonicalJson(campaign()), canonicalJson(campaign()));
  for (const view of ["summary", "player", "debug"]) {
    const argv = ["--seed", "demo-1", "--scenario", PACK_PATH, "--view", view];
    assert.equal(cli(argv).stdout, cli(argv).stdout, view);
  }
  const edited = pack();
  edited["content"]["companies"][2]["hidden"]["productFit"] = 63;
  const changed = campaign("demo-1", edited);
  assert.notEqual(changed.manifest.scenario.contentHash, campaign().manifest.scenario.contentHash);
  assert.notEqual(changed.id, campaign().id);
});

test("the documented command gives identical output across processes", () => {
  const argv = ["src/cli/campaign-init.ts", "--seed", "demo-1", "--scenario", PACK_PATH, "--view", "player"];
  const first = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: "utf8", env: { ...process.env, TZ: "UTC", LC_ALL: "en_US.UTF-8" } });
  const second = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: "utf8", env: { ...process.env, TZ: "Asia/Kathmandu", LC_ALL: "uk_UA.UTF-8" } });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.stdout, first.stdout);
});

test("an invalid pack fails with a useful error and no campaign", () => {
  const broken = pack();
  broken["content"]["companies"][2]["application"] = structuredClone(broken["content"]["companies"][0]["application"]);
  broken["content"]["companies"][1]["hidden"]["weeklyPriceCents"] = 0;
  const run = cli(["--seed", "demo-1", "--scenario", "broken.json", "--view", "player"], { "broken.json": JSON.stringify(broken) });
  assert.equal(run.code, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /^Campaign not initialized:$/m);
  assert.match(run.stderr, /scenario\.content\.companies\[1\]\.hidden\.weeklyPriceCents: must be at least 1 cents, got 0/);
  assert.match(run.stderr, /scenario\.content\.companies\[2\]\.application: must be absent: the player has not heard of a company that starts unknown/);
  assert.equal(initializeCampaign({ seed: "demo-1", scenario: broken }).ok, false);
});

test("an unknown --view is a usage error", () => {
  const run = cli(["--seed", "demo-1", "--scenario", PACK_PATH, "--view", "world"]);
  assert.equal(run.code, 2);
  assert.match(run.stderr, /--view must be one of summary, player, debug, got "world"/);
});

test("an inbound company with the longest allowed id still delivers its application", () => {
  const longest = pack();
  const id = `co-${"x".repeat(61)}`;
  assert.equal(id.length, 64);
  longest["content"]["companies"][1]["id"] = id;
  const { state } = campaign("demo-1", longest);
  const ids = state.observations.observations.filter((o) => o.companyId === id).map((o) => o.observationId);
  assert.equal(ids.length, 5);
  assert.ok(ids.includes(`obs-${id}-application-largest-customer-share-bps`));
  assert.equal(Math.max(...ids.map((i) => i.length)), 107);
});

test("basis points keep their sign, including changes below one percent", () => {
  const table: Array<[number, string]> = [
    [0, "0%"],
    [2600, "26%"],
    [1250, "12.5%"],
    [1205, "12.05%"],
    [-1, "-0.01%"],
    [-50, "-0.5%"],
    [-99, "-0.99%"],
    [-2600, "-26%"],
    [-1250, "-12.5%"],
  ];
  for (const [bps, text] of table) assert.equal(formatBasisPoints(bps), text, String(bps));
});
