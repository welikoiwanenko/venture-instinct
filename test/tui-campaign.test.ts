import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { renderToString } from "ink";
import { createElement } from "react";

import { canonicalJson, inspectCampaign, type Campaign } from "../src/app/campaign-app.ts";
import { runCampaignInit } from "../src/cli/campaign-init.ts";
import { ScreenView } from "../src/tui/ink-app.ts";
import { screenKeyIntent, type Intent } from "../src/tui/keys.ts";
import { initialTuiState, inputMode, update, type TuiState } from "../src/tui/model.ts";
import { buildScreen, type ScreenContext } from "../src/tui/screen.ts";
import { startCampaign, type ScenarioSource } from "../src/tui/session.ts";
import { runTextMode } from "../src/tui/text-mode.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCENARIO_PATH = "fixtures/scenarios/technical-empty.json";
const SOURCE: ScenarioSource = { label: SCENARIO_PATH, read: () => readFileSync(new URL(`../${SCENARIO_PATH}`, import.meta.url), "utf8") };
const CONTEXT: ScreenContext = { scenarioLabel: SOURCE.label };

function frame(state: TuiState, columns = 100, rows = 30): string {
  return renderToString(createElement(ScreenView, { state, context: CONTEXT, columns, rows }), { columns });
}

function started(seed = "demo-1"): { state: TuiState; campaign: Campaign } {
  const result = startCampaign(seed, SOURCE);
  assert.ok(result.ok, result.ok ? "" : result.errors.join("\n"));
  return { state: update(initialTuiState(), { type: "start-result", result }), campaign: result.campaign };
}

function cli(argv: string[]): string {
  let stdout = "";
  const code = runCampaignInit(argv, {
    readFile: (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
    stdout: (text) => (stdout += text),
    stderr: () => {},
  });
  assert.equal(code, 0);
  return stdout;
}

test("starting in the TUI yields the same campaign as the VI-10 command", () => {
  for (const seed of ["demo-1", "Another~Seed_42"]) {
    const { campaign } = started(seed);
    const fromCli = cli(["--seed", seed, "--scenario", SCENARIO_PATH, "--json"]);
    assert.equal(`${canonicalJson({ summary: inspectCampaign(campaign), manifest: campaign.manifest })}\n`, fromCli);
  }
});

test("the overview shows the §5 starting state and a manifest summary matching the CLI", () => {
  const { state } = started();
  const out = frame(update(state, { type: "focus", pane: "content" }));
  const cliText = cli(["--seed", "demo-1", "--scenario", SCENARIO_PATH]);
  const campaignId = /^Campaign {3}(cmp-[0-9a-f]{16})$/m.exec(cliText)?.[1];
  const config = /^Config {5}(.+)$/m.exec(cliText)?.[1];
  const stateHash = /^State {6}(sha256:[0-9a-f]{12})[0-9a-f]{52}$/m.exec(cliText)?.[1];
  assert.ok(campaignId && config && stateHash, cliText);
  for (const text of [
    "Week: 1 (0/156 done) · Slots: 5 left · Budget: $1,000,000",
    "✔ Campaign started.",
    "Week       planning week 1; 0 of 156 completed",
    "Window     initial investments open",
    "Slots      5 available this week",
    "Capital    $1,000,000 available",
    "Invested   0 of 5 initial checks of $200,000",
    "Portfolio  empty",
    `Campaign   ${campaignId}`,
    "Seed       demo-1",
    "Scenario   technical-fixture-empty",
    `Config     ${config}`,
    `State      ${stateHash}…`,
  ]) {
    assert.ok(out.includes(text), `missing ${text}\n${out}`);
  }
});

test("opening and re-reading the overview does not change the campaign", () => {
  const { state, campaign } = started();
  const before = canonicalJson(campaign);
  const first = frame(state);
  for (let i = 0; i < 3; i++) {
    assert.equal(frame(state), first);
    buildScreen(state, CONTEXT);
    buildScreen(update(state, { type: "select", section: "plan" }), CONTEXT);
  }
  assert.equal(canonicalJson(campaign), before);
  assert.equal(inspectCampaign(campaign).stateHash, campaign.manifest.initialStateHash);
  assert.equal(state.campaign, campaign);
});

test("an invalid start shows readable errors and leaves no campaign", () => {
  const cases: Array<[string, ScenarioSource, RegExp]> = [
    ["has space", SOURCE, /seed: must be 1-128 printable ASCII characters without spaces, got "has space"/],
    ["", SOURCE, /seed: must be 1-128 printable ASCII characters/],
    ["demo-1", { label: "missing.json", read: () => readFileSync("fixtures/missing.json", "utf8") }, /scenario missing\.json: cannot read file \(ENOENT\)/],
    ["demo-1", { label: "bad.json", read: () => "{" }, /scenario bad\.json: invalid JSON/],
    ["demo-1", { label: "empty.json", read: () => "{}" }, /scenario\.id: /],
  ];
  for (const [seed, source, message] of cases) {
    const result = startCampaign(seed, source);
    assert.equal(result.ok, false, seed);
    const state = update(update(initialTuiState(), { type: "focus", pane: "content" }), { type: "start-result", result });
    assert.equal(state.campaign, undefined);
    const out = frame(state);
    assert.match(out, /✖ Campaign not started:/);
    assert.match(out, message);
    assert.ok(out.includes("Week: — no campaign"));
  }
});

test("a failed start can be corrected; after a start, further start results are ignored", () => {
  let state = update(initialTuiState(), { type: "start-result", result: startCampaign("has space", SOURCE) });
  assert.equal(state.startErrors.length, 1);
  const ok = startCampaign("demo-1", SOURCE);
  state = update(state, { type: "start-result", result: ok });
  assert.ok(ok.ok);
  assert.equal(state.campaign, ok.campaign);
  assert.deepEqual(state.startErrors, []);
  assert.equal(update(state, { type: "start-result", result: startCampaign("demo-2", SOURCE) }), state);
  assert.equal(update(state, { type: "type-seed", text: "x" }), state);
});

test("the seed field takes typed text, including keys that are commands elsewhere", () => {
  let state = initialTuiState();
  assert.equal(state.section, "overview");
  assert.equal(inputMode(state), "sections");
  const press = (input: string, key = {}) => {
    const intent = screenKeyIntent(input, key, inputMode(state));
    assert.ok(intent !== undefined, `no intent for ${JSON.stringify(input)}`);
    if (intent.type === "start") return intent;
    state = update(state, intent as Exclude<Intent, { type: "start" | "quit" | "text-mode" | "scroll" | "move-company" | "open-company" | "move-plan" | "toggle-plan" | "end-week" }>);
    return intent;
  };
  press("", { return: true });
  assert.equal(inputMode(state), "seed");
  for (const c of ["q", "t", "?", "1", "j"]) press(c);
  press("", { delete: true });
  press("", { backspace: true });
  press("demo-1");
  assert.equal(state.seedDraft, "qt?demo-1", "Delete and Backspace each erase one character");
  assert.equal(screenKeyIntent("\x1b[A", {}, "seed"), undefined, "control sequences are not text");
  assert.equal(screenKeyIntent("c", { ctrl: true }, "seed"), undefined);
  assert.deepEqual(press("", { return: true }), { type: "start" });
  assert.deepEqual(screenKeyIntent("", { tab: true }, "seed"), { type: "next" });

  const out = frame(state);
  assert.match(out, /Seed {7}\[qt\?demo-1_\]/);
  assert.match(out, /\[Seed field\] · Enter start · Bksp erase · Esc\/← back/);
  press("", { escape: true });
  assert.equal(inputMode(state), "sections");
  assert.equal(state.seedDraft, "qt?demo-1", "the draft survives leaving the field");
});

test("once a campaign exists, the Overview content scrolls instead of taking text", () => {
  const { state } = started();
  const inContent = update(state, { type: "focus", pane: "content" });
  assert.equal(inputMode(inContent), "content");
  assert.deepEqual(screenKeyIntent("q", {}, inputMode(inContent)), { type: "quit" });
});

test("text mode starts a campaign with start <seed>", async () => {
  const input = new PassThrough();
  let output = "";
  const done = runTextMode(initialTuiState(), { input, write: (t) => (output += t) }, SOURCE);
  input.end("3\nstart has space\nstart demo-1\nstart demo-2\nquit\n");
  await done;
  assert.match(output, /Type start and a seed/);
  assert.match(output, /✖ Campaign not started:\n {2}seed: must be/);
  assert.match(output, /Week: 1 \(0\/156 done\)/);
  assert.match(output, /== Overview \(section 1 of 7\) ==\nWeek: 1/);
  assert.match(output, /Seed {7}demo-1/);
  assert.match(output, /A campaign is already running in this session\./);
  assert.doesNotMatch(output, /Seed {7}demo-2/);
});

test("the launch command starts a campaign from the Gamma pack by default", () => {
  const run = spawnSync(process.execPath, ["src/tui/main.ts", "--text"], { cwd: ROOT, input: "start demo-1\nq\n", encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Scenario {3}content\/scenarios\/gamma-three-companies\.json/);
  const campaignId = /^Campaign {3}(cmp-[0-9a-f]{16})$/m.exec(cli(["--seed", "demo-1", "--scenario", "content/scenarios/gamma-three-companies.json"]))?.[1];
  assert.ok(campaignId !== undefined && run.stdout.includes(`Campaign   ${campaignId}`));

  const missing = spawnSync(process.execPath, ["src/tui/main.ts", "--text", "--scenario", "nope.json"], { cwd: ROOT, input: "start demo-1\nq\n", encoding: "utf8" });
  assert.equal(missing.status, 0);
  assert.match(missing.stdout, /scenario nope\.json: cannot read file \(ENOENT\)/);
});

// Below about 40 columns the fixed rows alone fill a small window; that is out of scope.
test("the started campaign fits the window from 40 columns up", () => {
  const { state } = started();
  const content = update(state, { type: "focus", pane: "content" });
  for (const [columns, rows] of [[80, 24], [72, 24], [100, 12], [60, 24], [40, 20], [40, 14]] as const) {
    const out = frame(content, columns, rows);
    const lines = out.split("\n");
    assert.ok(lines.length <= rows, `${columns}x${rows}: ${lines.length} rows\n${out}`);
    for (const line of lines) {
      assert.ok([...line.replace(/\x1b\[[0-9;]*m/g, "")].length <= columns, `${columns}x${rows}: ${JSON.stringify(line)}`);
    }
    assert.ok(out.includes("Budget: $1,000,000"), `${columns}x${rows}: status is not truncated\n${out}`);
  }
});
