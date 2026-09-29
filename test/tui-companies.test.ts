// VI-21: the Companies section and the company card, built only from the player view.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { renderToString } from "ink";
import { createElement } from "react";

import { canonicalJson, type Campaign } from "../src/app/campaign-app.ts";
import { appendObservation } from "../src/knowledge/observation.ts";
import { ScreenView } from "../src/tui/ink-app.ts";
import { screenKeyIntent, textCommand } from "../src/tui/keys.ts";
import { initialTuiState, inputMode, SECTIONS, update, type TuiState } from "../src/tui/model.ts";
import { buildScreen, helpLines, renderLinear, type ScreenContext } from "../src/tui/screen.ts";
import { startCampaign, type ScenarioSource } from "../src/tui/session.ts";
import { runTextMode } from "../src/tui/text-mode.ts";

const PACK_PATH = "content/scenarios/gamma-three-companies.json";
const SOURCE: ScenarioSource = { label: PACK_PATH, read: () => readFileSync(new URL(`../${PACK_PATH}`, import.meta.url), "utf8") };
const CONTEXT: ScreenContext = { scenarioLabel: SOURCE.label };

/** Things only the debug view may show: hidden values, reasons, notes and the unknown company. */
const HIDDEN = [
  "Rampa",
  "co-rampa",
  "Савчук",
  "розвантаження",
  "fit ",
  "$210,000",
  "$380,000",
  "7 paying",
  "47%",
  "$20,600",
  "truth",
  "counts-pilots",
  "optimistic",
  "excludes-contractor",
  "free extended pilot",
  "Trade-off",
  "open-core",
  "alignment",
  "lifecycle",
  "operating",
  "score",
  "rank",
];

function frame(state: TuiState, columns = 100, rows = 60): string {
  return renderToString(createElement(ScreenView, { state, context: CONTEXT, columns, rows }), { columns });
}

function started(): { state: TuiState; campaign: Campaign } {
  const result = startCampaign("demo-1", SOURCE);
  assert.ok(result.ok, result.ok ? "" : result.errors.join("\n"));
  const state = update(update(initialTuiState(), { type: "start-result", result }), { type: "select", section: "companies" });
  return { state: update(state, { type: "focus", pane: "content" }), campaign: result.campaign };
}

function open(state: TuiState, index: number): TuiState {
  return update(state, { type: "open-company", count: 2, index });
}

test("the Companies list shows exactly the two known companies with sector and description", () => {
  const { state } = started();
  assert.equal(inputMode(state), "company-list");
  const screen = buildScreen(state, CONTEXT);
  assert.equal(screen.companyCount, 2);
  const out = frame(state);
  assert.match(out, /2 companies you know, in no particular order\./);
  assert.match(out, /▸ 1 {2}Tracebench · developer-tools/);
  assert.match(out, / {3}2 {2}Papirflow · business-process-automation/);
  assert.match(out, /Інструмент для інженерних команд/);
  assert.match(out, /\[Company list\] · ↑↓ j\/k choose · Enter\/→ open · Esc\/← back/);
});

test("the unknown company is absent from every section, card, count and text", () => {
  const { state } = started();
  const views: TuiState[] = [];
  for (const section of SECTIONS) views.push(update(state, { type: "select", section: section.id }));
  views.push(open(state, 0), open(state, 1), update(open(state, 1), { type: "expand" }), update(state, { type: "toggle-help" }));
  for (const view of views) {
    const texts = [frame(view), renderLinear(buildScreen(view, { ...CONTEXT, linear: true }))];
    for (const text of texts) {
      for (const hidden of HIDDEN) assert.ok(!text.includes(hidden), `${hidden} shown in ${view.section}\n${text}`);
      assert.ok(!/\b3 (companies|known)/.test(text), `a count includes the unknown company\n${text}`);
    }
  }
  assert.match(frame(update(state, { type: "select", section: "overview" })), /Companies {2}2 known: see 4 Companies/);
});

test("↑/↓ choose a company, Enter opens its card, Esc goes back to the list and then to the sections", () => {
  let { state } = started();
  const press = (input: string, key = {}) => {
    const intent = screenKeyIntent(input, key, inputMode(state));
    assert.ok(intent !== undefined, `no intent for ${input} ${JSON.stringify(key)} in ${inputMode(state)}`);
    const count = buildScreen(state, CONTEXT).companyCount;
    if (intent.type === "move-company") state = update(state, { ...intent, count });
    else if (intent.type === "open-company") state = update(state, { type: "open-company", count });
    else if (intent.type === "scroll") state = update(state, { type: "scroll", delta: intent.lines, max: 20 });
    else state = update(state, intent as never);
  };
  press("", { downArrow: true });
  press("j");
  assert.equal(state.companyCursor, 1, "the cursor stops at the last company");
  press("k");
  press("", { upArrow: true });
  assert.equal(state.companyCursor, 0, "and at the first");
  press("j");
  press("", { return: true });
  assert.equal(inputMode(state), "company-card");
  assert.match(frame(state), /▸ Companies › Papirflow \(4 of 7\)/);
  assert.match(frame(state), /\[Company card\] · ↑↓ j\/k scroll · e short\/full · Esc\/← back/);
  press("j");
  assert.equal(state.scroll.companies, 1, "on a card ↑/↓ scroll");
  press("e");
  assert.equal(state.messagesExpanded, true);
  press("", { escape: true });
  assert.equal(inputMode(state), "company-list");
  assert.equal(state.companyCursor, 1, "the list keeps its position");
  assert.equal(state.scroll.companies, 0);
  press("", { leftArrow: true });
  assert.equal(inputMode(state), "sections");
});

test("opening a card starts at its top in the short form; bad indexes do nothing", () => {
  const { state } = started();
  const scrolled = update(open(state, 0), { type: "scroll", delta: 5, max: 20 });
  const expanded = update(scrolled, { type: "expand" });
  const reopened = open(update(expanded, { type: "close-company" }), 1);
  assert.equal(reopened.scroll.companies, 0);
  assert.equal(reopened.messagesExpanded, false);
  assert.equal(update(state, { type: "open-company", count: 2, index: 2 }), state);
  assert.equal(update(state, { type: "open-company", count: 0 }), state);
  assert.equal(update(state, { type: "expand" }), state, "nothing to expand without a card");
  assert.equal(update(open(state, 0), { type: "move-company", delta: 1, count: 2 }).companyCursor, 0, "the cursor stays while a card is open");
});

test("the card shows founders and every figure with its period, source, week received and status", () => {
  const { state } = started();
  const out = frame(open(state, 0), 100, 80);
  for (const text of [
    "Tracebench · developer-tools · b2b-recurring-software",
    "Founders",
    "Остап Гнатюк · engineering",
    "Ірина Мельник · engineering",
    "You: decision undecided · contact none · opportunity unavailable",
    "Week 0 and earlier are before the campaign started.",
  ]) {
    assert.ok(out.includes(text), `missing ${text}\n${out}`);
  }
  const lines = frame(open(state, 1), 120, 80).split("\n").map((l) => l.replace(/^.*│ /, "").replace(/\s*│$/, "").trimEnd());
  const figures = lines.slice(lines.indexOf("Figures") + 1).filter((l) => l.startsWith("  ") && !l.startsWith("    "));
  assert.deepEqual(figures, [
    "  Paying customers: 23",
    "  Weekly revenue: $9,660/week",
    "  Largest customer's share of revenue: 18%",
    "  Weekly costs: $9,200/week",
  ]);
  for (const figure of figures) {
    const evidence = lines[lines.indexOf(figure) + 1];
    assert.equal(evidence, "    week 0 · Тарас Коваленко (founder) · received week 1 · ◇ founder claim", figure);
  }
});

test("an application reads in short form or in full", () => {
  const { state } = started();
  const card = open(state, 0);
  const short = frame(card, 100, 80);
  assert.match(short, /Messages \(short form; e: read in full\)/);
  assert.match(short, /✉ Пошук нестабільних тестів у CI: 19 платних команд/);
  assert.doesNotMatch(short, /утомилися перезапускати/);
  const full = frame(update(card, { type: "expand" }), 100, 80);
  assert.match(full, /Messages \(full; e: short form\)/);
  assert.match(full, /✉ Пошук нестабільних тестів у CI/);
  assert.match(full, /утомилися перезапускати/);
});

test("figures of the same metric are shown side by side with their difference", () => {
  const { campaign } = started();
  // A check is not deliverable yet (research comes with Delta); append one directly.
  const appended = appendObservation(campaign.state.observations, {
    observation: {
      observationId: "obs-test-check-customers",
      companyId: "co-tracebench",
      source: { kind: "check", author: "customer research" },
      receivedWeek: 1,
      period: { fromWeek: -1, toWeek: 0 },
      content: { kind: "metric", metric: "payingCustomers", value: 7 },
      references: [],
    },
    provenance: { fact: { value: 7 } },
  });
  assert.ok(appended.ok);
  const withCheck = Object.freeze({ ...campaign, state: Object.freeze({ ...campaign.state, observations: appended.log }) });
  const { state } = started();
  const out = frame(open({ ...state, campaign: withCheck }, 0), 120, 80);
  assert.match(out, /Paying customers: 2 figures side by side/);
  assert.match(out, /19 · week 0 · Остап Гнатюк \(founder\) · received week 1 · ⚠ conflicting evidence/);
  assert.match(out, /7 · weeks -1 to 0 · customer research \(your check\) · received week 1 · ✔ confirmed by this check/);
  assert.match(out, /They differ by 12 for overlapping periods\./);
});

test("navigating and reading never change the campaign", () => {
  const { state, campaign } = started();
  const before = canonicalJson(campaign);
  let s = state;
  for (const action of [
    { type: "move-company", delta: 1, count: 2 },
    { type: "open-company", count: 2 },
    { type: "expand" },
    { type: "scroll", delta: 3, max: 10 },
    { type: "close-company" },
    { type: "select", section: "overview" },
    { type: "select", section: "companies" },
  ] as const) {
    s = update(s, action);
    frame(s);
    buildScreen(s, { ...CONTEXT, linear: true });
  }
  assert.equal(s.campaign, campaign);
  assert.equal(canonicalJson(campaign), before);
});

test("the card fits narrow windows", () => {
  const { state } = started();
  for (const [columns, rows] of [[80, 24], [60, 24], [40, 20]] as const) {
    const out = frame(update(open(state, 1), { type: "expand" }), columns, rows);
    const lines = out.split("\n");
    assert.ok(lines.length <= rows, `${columns}x${rows}: ${lines.length} rows`);
    for (const line of lines) {
      assert.ok([...line.replace(/\x1b\[[0-9;]*m/g, "")].length <= columns, `${columns}x${rows}: ${JSON.stringify(line)}`);
    }
  }
});

test("help and text commands cover the Companies section", () => {
  assert.ok(helpLines().includes("In Companies:"));
  assert.deepEqual(textCommand("open 2"), { type: "open-company", index: 1 });
  assert.deepEqual(textCommand("OPEN 1"), { type: "open-company", index: 0 });
  assert.deepEqual(textCommand("expand"), { type: "expand", expanded: true });
  assert.deepEqual(textCommand("short"), { type: "expand", expanded: false });
  assert.deepEqual(textCommand("back"), { type: "close-company" });
  assert.deepEqual(textCommand("open"), { unknown: "open" });
});

test("text mode opens cards by number, expands them and goes back", async () => {
  const input = new PassThrough();
  let output = "";
  const done = runTextMode(initialTuiState(), { input, write: (t) => (output += t) }, SOURCE);
  input.end("open 1\nstart demo-1\n4\nopen 3\nopen 2\nexpand\nback\nquit\n");
  await done;
  assert.match(output, /No companies to open yet\./);
  assert.match(output, /Type open and a number to read a card, e\.g\. open 1\./);
  assert.match(output, /Choose a company from 1 to 2\./);
  assert.match(output, /== Companies › Papirflow \(section 4 of 7\) ==/);
  assert.match(output, /Messages \(short form; type expand to read in full\)/);
  assert.match(output, /Messages \(full; type short for the short form\)\n[\s\S]*Papirflow автоматизує погодження/);
  assert.match(output, /== Companies \(section 4 of 7\) ==\n[\s\S]*2 companies you know[\s\S]*Bye\.\n$/);
  for (const hidden of HIDDEN) assert.ok(!output.includes(hidden), hidden);
});
