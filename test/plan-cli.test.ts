// VI-33: plan and end weeks without UI through the developer command
// (docs/design-doc.md §6, §7, §9.2, §17.4, §18).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { canonicalJson, initializeCampaign, inspectCampaign } from "../src/app/campaign-app.ts";
import { runCampaignInit } from "../src/cli/campaign-init.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACK = "content/scenarios/gamma-three-companies.json";
const VALID = "fixtures/commands/week1-tracebench-customers.json";
const INVALID = "fixtures/commands/invalid-plan.json";
const REPEATED = "fixtures/commands/repeated-command.json";

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

const run = (commands: string, ...rest: string[]) => cli(["--seed", "demo-1", "--scenario", PACK, "--commands", commands, ...rest]);

function stateHashes(stdout: string): string[] {
  return [...stdout.matchAll(/state (sha256:[0-9a-f]{64})/g)].map((m) => m[1]!);
}

test("a Tracebench customer check in week 1 shows its result and the contradicted claim in week 2", () => {
  const result = run(VALID, "--view", "player");
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Command 1: cmd-week-1 · endWeek · expected revision 0$/m);
  assert.match(result.stdout, /^ {2}Plan for week 1: 1 of 5 slots, 4 left$/m);
  assert.match(result.stdout, /^ {4}1\. Research · Tracebench · Скільки команд справді оплатили рахунок за останній місяць\? · 1 slot · result readable in week 2$/m);
  assert.match(result.stdout, /^ {2}Unanswered deadlines: none$/m);
  assert.match(result.stdout, /^ {2}✔ Accepted as command #1: now planning week 2; 1 observation delivered$/m);
  assert.match(result.stdout, /^Player view: what you know in planning week 2$/m);
  assert.match(result.stdout, /· Paying customers: 19\n {7}received week 1 from Остап Гнатюк \(founder\) · week 0 \(before the campaign\) · ⚠ conflicting evidence/);
  assert.match(
    result.stdout,
    /· Paying customers: 7\n {7}received week 1 from Платіжні дані Tracebench за місяць \(your check\) · weeks -3 to 0 \(before the campaign\) · ✔ confirmed by this check/,
  );
  for (const hidden of ["truth", "counts-pilots", "Rampa", "co-rampa"]) assert.ok(!result.stdout.includes(hidden), hidden);
});

test("an invalid plan prints its reasons, exits 1 and leaves the state hash unchanged", () => {
  const result = run(INVALID);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^ {2}✖ Rejected \(rejected\):$/m);
  assert.match(result.stdout, /^ {4}action 2: "Скільки команд справді оплатили рахунок за останній місяць\?" is already planned as action 1$/m);
  assert.match(result.stdout, /^ {4}action 3: you do not know a company "co-rampa"$/m);
  assert.match(result.stdout, /^ {4}the plan needs 6 slots, but week 1 has 5; remove 1$/m);
  const initial = initializeCampaign({ seed: "demo-1", scenario: JSON.parse(readFileSync(new URL(`../${PACK}`, import.meta.url), "utf8")) });
  assert.ok(initial.ok);
  const hash = inspectCampaign(initial.campaign).stateHash;
  assert.match(result.stdout, new RegExp(`^ {2}Nothing changed: revision 0 · planning week 1 · state ${hash}$`, "m"));
  assert.match(result.stdout, new RegExp(`^State {6}${hash}$`, "m"));
  assert.match(result.stdout, /^Week {7}planning week 1; 0 of 156 completed$/m);
});

test("running the same commands twice gives the same state hash, across processes too", () => {
  const [first, second] = [run(VALID), run(VALID)];
  assert.equal(first.stdout, second.stdout);
  const argv = ["src/cli/campaign-init.ts", "--seed", "demo-1", "--scenario", PACK, "--commands", VALID];
  const a = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: "utf8", env: { ...process.env, TZ: "UTC" } });
  const b = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: "utf8", env: { ...process.env, TZ: "Pacific/Chatham" } });
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.equal(stateHashes(a.stdout).at(-1), stateHashes(first.stdout).at(-1));
});

test("a repeated command id does not spend twice", () => {
  const once = run(VALID);
  const twice = run(REPEATED);
  assert.equal(twice.code, 0, twice.stderr);
  assert.match(twice.stdout, /^ {2}↺ Already accepted as command #1; the earlier result is returned and nothing is spent again$/m);
  assert.match(twice.stdout, /^Week {7}planning week 2; 1 of 156 completed$/m);
  assert.match(twice.stdout, /^Revision {3}1 \(accepted commands\)$/m);
  assert.equal(stateHashes(twice.stdout).at(-1), stateHashes(once.stdout).at(-1));
});

test("the debug view shows the provenance of the delivered check", () => {
  const result = run(VALID, "--view", "debug");
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /Evidence {3}obs-co-tracebench-chk-tracebench-paying-teams-week-1: Paying customers 7 · matches the truth · shown as ✔ confirmed by this check/,
  );
  assert.match(result.stdout, /obs-co-tracebench-application-paying-customers: Paying customers 19 · truth 7 · counts-pilots-as-paying: .* · shown as ⚠ conflicting evidence/);
});

test("--json prints the command results and the view as one canonical line", () => {
  const result = run(VALID, "--view", "player", "--json");
  assert.equal(result.code, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as { commands: Array<Record<string, any>>; view: Record<string, any> };
  assert.equal(result.stdout, `${canonicalJson(parsed)}\n`);
  assert.equal(parsed.commands.length, 1);
  assert.equal(parsed.commands[0]?.["record"]["sequence"], 1);
  assert.equal(parsed.commands[0]?.["review"]["slotsUsed"], 1);
  assert.equal(parsed.view["planningWeek"], 2);
  const rejected = JSON.parse(run(INVALID, "--json").stdout) as { commands: Array<Record<string, any>> };
  assert.equal(rejected.commands[0]?.["rejection"]["code"], "rejected");
  assert.equal(rejected.commands[0]?.["revision"], 0);
});

test("a commands file that is not a list, or not JSON, is a usage error", () => {
  const notList = run("cmds.json");
  assert.equal(notList.code, 2);
  const files = { "cmds.json": '{"commandId":"x"}', "broken.json": "[" };
  const object = cli(["--seed", "demo-1", "--scenario", PACK, "--commands", "cmds.json"], files);
  assert.equal(object.code, 2);
  assert.match(object.stderr, /--commands cmds\.json: must be a JSON list of commands/);
  const broken = cli(["--seed", "demo-1", "--scenario", PACK, "--commands", "broken.json"], files);
  assert.equal(broken.code, 2);
  assert.match(broken.stderr, /--commands broken\.json: invalid JSON/);
  assert.equal(object.stdout + broken.stdout, "");
});

test("a malformed command is rejected with its reasons and later commands still run", () => {
  const files = {
    "mixed.json": JSON.stringify([
      { commandId: "x", expectedRevision: 0, type: "teleport", args: {} },
      { commandId: "w1", expectedRevision: 0, type: "endWeek", args: { week: 1, actions: [] } },
    ]),
  };
  const result = cli(["--seed", "demo-1", "--scenario", PACK, "--commands", "mixed.json"], files);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /✖ Rejected \(unknown-command\):\n {4}unknown command type "teleport"; known: endWeek/);
  assert.match(result.stdout, /^ {2}Plan for week 1: 0 of 5 slots, 5 left\n {4}\(no actions: the week passes\)$/m);
  assert.match(result.stdout, /^Week {7}planning week 2; 1 of 156 completed$/m);
});
