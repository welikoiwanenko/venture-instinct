// VI-22: the weekly plan editor, the plan review and End Week in the TUI, and the Inbox
// that shows what End Week delivered (docs/design-doc.md §6, §7, §9.2, §15).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { renderToString } from "ink";
import { createElement } from "react";

import { canonicalJson, inspectCampaign } from "../src/app/campaign-app.ts";
import { ScreenView } from "../src/tui/ink-app.ts";
import { screenKeyIntent, textCommand } from "../src/tui/keys.ts";
import { initialTuiState, inputMode, update, type TuiState } from "../src/tui/model.ts";
import { buildScreen, helpLines, type ScreenContext } from "../src/tui/screen.ts";
import { startCampaign, submitEndWeek, type ScenarioSource } from "../src/tui/session.ts";
import { runTextMode } from "../src/tui/text-mode.ts";

const PACK_PATH = "content/scenarios/gamma-three-companies.json";
const SOURCE: ScenarioSource = { label: PACK_PATH, read: () => readFileSync(new URL(`../${PACK_PATH}`, import.meta.url), "utf8") };
const CONTEXT: ScreenContext = { scenarioLabel: SOURCE.label };

// Wide enough that no body line wraps, so assertions read whole lines.
/** Results and hidden values the player has not been delivered. */
const UNDELIVERED = ["Rampa", "co-rampa", "47%", "$20,600", "truth", "counts-pilots", "Ірина Мельник автор", "Платіжний сервіс Tracebench показує"];

function frame(state: TuiState, columns = 220, rows = 80): string {
  return renderToString(createElement(ScreenView, { state, context: CONTEXT, columns, rows }), { columns });
}

/** A started campaign with the Plan content focused. */
function atPlan(): TuiState {
  const result = startCampaign("demo-1", SOURCE);
  assert.ok(result.ok);
  const state = update(update(initialTuiState(), { type: "start-result", result }), { type: "select", section: "plan" });
  return update(state, { type: "focus", pane: "content" });
}

/** Toggles the action under the cursor, as the Ink renderer does. */
function toggle(state: TuiState): TuiState {
  const screen = buildScreen(state, CONTEXT);
  const row = screen.planRows[state.planCursor];
  assert.ok(row !== undefined);
  return update(state, { type: "toggle-plan", item: row.item, cost: row.cost, slotsLeft: screen.slotsLeft });
}

/** The section body as plain lines, for assertions that span lines. */
function body(state: TuiState): string {
  return buildScreen(state, CONTEXT).body.join("\n");
}

function move(state: TuiState, delta: number): TuiState {
  return update(state, { type: "move-plan", delta, count: buildScreen(state, CONTEXT).planRows.length });
}

function endWeek(state: TuiState): TuiState {
  assert.ok(state.campaign !== undefined);
  return update(state, { type: "end-week-result", result: submitEndWeek(state.campaign, state.planDraft) });
}

test("the Plan section lists each check with its cost, prerequisites and arrival before it is added", () => {
  const state = atPlan();
  assert.equal(inputMode(state), "plan-list");
  const out = frame(state);
  assert.match(out, /Week 1 plan · 0 of 5 slots planned · 5 left/);
  assert.match(out, /Research: 1 slot each; needs a company you know and a check available for it\. Results arrive at the end of week 1; read them in week 2\./);
  assert.match(out, /▸ 1 {2}\[ \] Скільки команд справді оплатили рахунок за останній місяць\?/);
  assert.match(out, /customers · reads Платіжні дані Tracebench за місяць · 1 slot · result readable in week 2/);
  assert.match(out, /\[Plan\] · ↑↓ j\/k choose · Enter\/Space add\/remove · r review · Esc\/← back/);
  assert.equal(buildScreen(state, CONTEXT).planRows.length, 8);
  for (const hidden of UNDELIVERED) assert.ok(!out.includes(hidden), hidden);
});

test("slot usage is visible and the editor cannot exceed the week's 5 slots", () => {
  let state = atPlan();
  for (let i = 0; i < 5; i++) state = move(toggle(state), 1);
  assert.equal(state.planDraft.length, 5);
  assert.match(frame(state), /Week 1 plan · 5 of 5 slots planned · 0 left/);
  const refused = toggle(state);
  assert.equal(refused.planDraft.length, 5, "a sixth action is refused");
  assert.match(frame(refused), /No slots are left this week; remove an action to add this one\./);
  // Removing one frees its slot.
  const removed = toggle(move(refused, -1));
  assert.equal(removed.planDraft.length, 4);
  assert.match(frame(removed), /4 of 5 slots planned · 1 left/);
  assert.deepEqual(removed.planMessages, []);
});

test("draft edits never change the campaign", () => {
  const start = atPlan();
  const before = canonicalJson(start.campaign);
  let state = toggle(move(toggle(start), 3));
  state = update(state, { type: "open-review" });
  state = update(state, { type: "close-review" });
  frame(state);
  assert.equal(state.campaign, start.campaign);
  assert.equal(canonicalJson(state.campaign), before);
  assert.equal(inspectCampaign(state.campaign!).stateHash, inspectCampaign(start.campaign!).stateHash);
});

test("the plan review lists actions, costs and deadlines before End Week", () => {
  const state = update(toggle(move(toggle(atPlan()), 5)), { type: "open-review" });
  assert.equal(inputMode(state), "plan-review");
  const out = frame(state);
  assert.match(out, /Plan review for week 1: the one check before End Week\./);
  assert.match(out, /1\. Research · Tracebench · Скільки команд справді оплатили рахунок за останній місяць\?/);
  assert.match(out, /2\. Research · Papirflow · Скільки компанія витрачає на тиждень разом із розробниками продукту\?/);
  assert.match(out, /1 slot · result readable in week 2/);
  assert.match(out, /Slots: 2 of 5 used · 3 left; unused slots do not carry over\./);
  assert.match(out, /Unanswered deadlines: none/);
  assert.match(out, /Press Enter to end week 1, or Esc to go back to the plan\./);
  assert.match(out, /\[Plan review\] · Enter end week/);
});

test("End Week advances the week counter and the results appear in the Inbox and on the card", () => {
  const reviewed = update(toggle(move(toggle(atPlan()), 5)), { type: "open-review" });
  const after = endWeek(reviewed);
  const summary = inspectCampaign(after.campaign!);
  assert.equal(summary.planningWeek, 2);
  assert.equal(summary.revision, 1);
  assert.deepEqual(after.planDraft, []);
  assert.equal(after.reviewOpen, false);
  const plan = frame(after);
  assert.match(plan, /Week: 2 \(1\/156 done\)/);
  assert.match(plan, /✔ Week 1 ended\. 2 research results were delivered: see 2 Inbox\. Now planning week 2\./);
  assert.match(plan, /✔ Answered in week 1: Скільки команд справді оплатили рахунок за останній місяць\? \(read it on the card\)/);
  assert.equal(buildScreen(after, CONTEXT).planRows.length, 6, "answered checks are not offered again");

  const inbox = body(update(after, { type: "select", section: "inbox" }));
  assert.match(inbox, /4 items, newest first\./);
  assert.match(inbox, /Delivered at the end of week 1\n[\s\S]*▪ Tracebench · Paying customers: 7 \(new\)/);
  assert.match(inbox, /Платіжні дані Tracebench за місяць \(your check\) · received week 1 · ✔ confirmed by this check/);
  assert.match(inbox, /▪ Papirflow · Weekly costs: \$20,600\/week \(new\)/);
  assert.match(inbox, /Arrived in week 1\n {2}✉ Tracebench · Пошук нестабільних тестів/);

  const card = frame(update(update(update(after, { type: "select", section: "companies" }), { type: "focus", pane: "content" }), { type: "open-company", count: 2, index: 0 }));
  assert.match(card, /Paying customers: 2 figures side by side/);
  assert.match(card, /19 · week 0 · Остап Гнатюк \(founder\) · received week 1 · ⚠ conflicting evidence/);
  assert.match(frame(update(after, { type: "select", section: "overview" })), /✔ 1 week done\. Plan week 2 in 7 Plan\./);
});

test("an invalid plan is rejected with the player-visible reason and no time passes", () => {
  const start = atPlan();
  // A plan built for this week that turns invalid: its check gets answered first.
  const drafted = toggle(start);
  const answered = endWeek(update(drafted, { type: "open-review" }));
  const stale = update({ ...answered, planDraft: drafted.planDraft }, { type: "open-review" });
  assert.match(body(stale), /✖ This plan cannot end the week:\n[\s\S]*action 1: you already have the result of "Скільки команд справді оплатили рахунок за останній місяць\?" from week 1/);
  const rejected = endWeek(stale);
  assert.equal(rejected.campaign, answered.campaign, "no time passes");
  assert.equal(inspectCampaign(rejected.campaign!).planningWeek, 2);
  assert.equal(rejected.reviewOpen, false);
  assert.deepEqual(rejected.planDraft, drafted.planDraft, "the draft stays for the player to fix");
  assert.match(body(rejected), /✖ The week did not end:\n[\s\S]*you already have the result/);
});

test("an empty plan ends the week too", () => {
  const after = endWeek(update(atPlan(), { type: "open-review" }));
  assert.equal(inspectCampaign(after.campaign!).planningWeek, 2);
  assert.match(frame(after), /✔ Week 1 ended\. Nothing was delivered\. Now planning week 2\./);
});

test("plan keys: choose, add or remove, review, end the week and go back", () => {
  assert.deepEqual(screenKeyIntent("", { downArrow: true }, "plan-list"), { type: "move-plan", delta: 1 });
  assert.deepEqual(screenKeyIntent("k", {}, "plan-list"), { type: "move-plan", delta: -1 });
  assert.deepEqual(screenKeyIntent("", { return: true }, "plan-list"), { type: "toggle-plan" });
  assert.deepEqual(screenKeyIntent(" ", {}, "plan-list"), { type: "toggle-plan" });
  assert.deepEqual(screenKeyIntent("r", {}, "plan-list"), { type: "open-review" });
  assert.deepEqual(screenKeyIntent("", { escape: true }, "plan-list"), { type: "focus", pane: "sections" });
  assert.deepEqual(screenKeyIntent("", { return: true }, "plan-review"), { type: "end-week" });
  assert.deepEqual(screenKeyIntent("", { escape: true }, "plan-review"), { type: "close-review" });
  assert.deepEqual(screenKeyIntent("", { downArrow: true }, "plan-review"), { type: "scroll", lines: 1 });
  assert.deepEqual(screenKeyIntent("q", {}, "plan-list"), { type: "quit" });
  assert.deepEqual(textCommand("add 3"), { type: "plan-add", index: 2 });
  assert.deepEqual(textCommand("remove 1"), { type: "plan-remove", index: 0 });
  assert.deepEqual(textCommand("review"), { type: "open-review" });
  assert.deepEqual(textCommand("end"), { type: "end-week" });
  assert.ok(helpLines().includes("In Plan:"));
  // Without a campaign the Plan content is plain scrolling text.
  const empty = update(update(initialTuiState(), { type: "select", section: "plan" }), { type: "focus", pane: "content" });
  assert.equal(inputMode(empty), "content");
});

test("text mode plans, reviews once and ends the week", async () => {
  const input = new PassThrough();
  let output = "";
  const done = runTextMode(initialTuiState(), { input, write: (t) => (output += t) }, SOURCE);
  input.end("add 1\nstart demo-1\nadd 1\nadd 1\nadd 9\nremove 2\nadd 6\nend\nback\nreview\nend\n2\nquit\n");
  await done;
  assert.match(output, /Start a campaign first\./);
  assert.match(output, /Action 1 is already in the plan\./);
  assert.match(output, /Choose an action from 1 to 8\./);
  assert.match(output, /Action 2 is not in the plan\./);
  assert.match(output, /Review the plan first; type end again to end the week\.\n\n== Plan \(section 7 of 7\) ==[\s\S]*Plan review for week 1/);
  assert.match(output, /Type end to end week 1, or type back to edit the plan\./);
  assert.match(output, /✔ Week 1 ended\. 2 research results were delivered: see 2 Inbox\. Now planning week 2\./);
  assert.match(output, /== Inbox \(section 2 of 7\) ==\nWeek: 2 \(1\/156 done\)[\s\S]*Paying customers: 7 \(new\)/);
  for (const hidden of ["Rampa", "co-rampa", "truth", "counts-pilots"]) assert.ok(!output.includes(hidden), hidden);
});

test("the plan editor and review fit a narrow window and keep the cursor visible", () => {
  let state = atPlan();
  for (let i = 0; i < 7; i++) state = move(state, 1);
  for (const s of [state, update(toggle(state), { type: "open-review" })]) {
    const out = renderToString(createElement(ScreenView, { state: s, context: CONTEXT, columns: 40, rows: 20 }), { columns: 40 });
    const lines = out.split("\n");
    assert.ok(lines.length <= 20, out);
    for (const line of lines) assert.ok([...line].length <= 40, `too wide: ${line}`);
    if (!s.reviewOpen) assert.match(out, /▸ 8 {2}\[ \]/, out);
  }
});
