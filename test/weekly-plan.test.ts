// VI-31: the weekly plan and its validation against the start of the week
// (docs/design-doc.md §6.1, §7, §9.2). No End Week yet.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ACTION_CATALOGUE,
  availableActions,
  canonicalJson,
  initializeCampaign,
  inspectCampaign,
  validateWeeklyPlan,
  type Campaign,
  type PlanValidation,
} from "../src/app/campaign-app.ts";

const PACK_PATH = "content/scenarios/gamma-three-companies.json";

function campaign(): Campaign {
  const scenario = JSON.parse(readFileSync(new URL(`../${PACK_PATH}`, import.meta.url), "utf8")) as unknown;
  const result = initializeCampaign({ seed: "demo-1", scenario });
  assert.ok(result.ok);
  return result.campaign;
}

const research = (companyId: string, checkId: string) => ({ type: "research", companyId, checkId });

function reasons(result: PlanValidation): readonly string[] {
  assert.equal(result.ok, false, "expected the plan to be rejected");
  return result.ok ? [] : result.reasons;
}

test("the catalogue offers research for one slot, with prerequisites and when the result arrives", () => {
  assert.deepEqual(Object.keys(ACTION_CATALOGUE), ["research"]);
  assert.equal(ACTION_CATALOGUE.research.slotCost, 1);
  assert.match(ACTION_CATALOGUE.research.prerequisites, /company you know/);
  assert.match(ACTION_CATALOGUE.research.result, /end of the week/);
});

test("a valid plan returns its review: actions, costs, slots left and no deadlines yet", () => {
  const result = validateWeeklyPlan(campaign(), {
    week: 1,
    actions: [research("co-tracebench", "chk-tracebench-paying-teams"), research("co-papirflow", "chk-papirflow-weekly-costs")],
  });
  assert.ok(result.ok, result.ok ? "" : result.reasons.join("\n"));
  assert.deepEqual(result.review, {
    week: 1,
    actions: [
      {
        action: research("co-tracebench", "chk-tracebench-paying-teams"),
        title: "Research",
        companyName: "Tracebench",
        question: "Скільки команд справді оплатили рахунок за останній місяць?",
        slotCost: 1,
        resultReadableWeek: 2,
      },
      {
        action: research("co-papirflow", "chk-papirflow-weekly-costs"),
        title: "Research",
        companyName: "Papirflow",
        question: "Скільки компанія витрачає на тиждень разом із розробниками продукту?",
        slotCost: 1,
        resultReadableWeek: 2,
      },
    ],
    slotsUsed: 2,
    slotsAvailable: 5,
    slotsLeft: 3,
    unansweredDeadlines: [],
  });
});

test("an empty plan is valid and uses no slots", () => {
  const result = validateWeeklyPlan(campaign(), { week: 1, actions: [] });
  assert.ok(result.ok);
  assert.equal(result.review.slotsLeft, 5);
});

test("a plan over the week's slots is rejected with the number to remove", () => {
  const checks = availableActions(campaign()).research.flatMap((c) => c.checks.map((check) => research(c.companyId, check.checkId)));
  assert.equal(checks.length, 8);
  assert.deepEqual(reasons(validateWeeklyPlan(campaign(), { week: 1, actions: checks.slice(0, 6) })), [
    "the plan needs 6 slots, but week 1 has 5; remove 1",
  ]);
  assert.ok(validateWeeklyPlan(campaign(), { week: 1, actions: checks.slice(0, 5) }).ok);
});

test("unknown and nonexistent companies get the same reason, so nothing about Rampa leaks", () => {
  const [rampa, nobody] = [
    reasons(validateWeeklyPlan(campaign(), { week: 1, actions: [research("co-rampa", "chk-anything")] })),
    reasons(validateWeeklyPlan(campaign(), { week: 1, actions: [research("co-nobody", "chk-anything")] })),
  ];
  assert.deepEqual(rampa, ['action 1: you do not know a company "co-rampa"']);
  assert.deepEqual(nobody, ['action 1: you do not know a company "co-nobody"']);
});

test("unknown, repeated and wrong-company checks are rejected, all reasons at once", () => {
  const result = reasons(
    validateWeeklyPlan(campaign(), {
      week: 1,
      actions: [
        research("co-tracebench", "chk-tracebench-paying-teams"),
        research("co-tracebench", "chk-tracebench-paying-teams"),
        research("co-tracebench", "chk-nope"),
        research("co-tracebench", "chk-papirflow-weekly-costs"),
      ],
    }),
  );
  assert.deepEqual(result, [
    'action 2: "Скільки команд справді оплатили рахунок за останній місяць?" is already planned as action 1',
    'action 3: Tracebench has no research check "chk-nope"',
    'action 4: Tracebench has no research check "chk-papirflow-weekly-costs"',
  ]);
});

test("a check whose evidence was already delivered is not offered or accepted again", () => {
  const base = campaign();
  const answered: Campaign = Object.freeze({
    ...base,
    state: Object.freeze({
      ...base.state,
      research: Object.freeze([
        { companyId: "co-tracebench", checkId: "chk-tracebench-paying-teams", week: 1, observationId: "obs-earlier" },
      ]),
    }),
  });
  assert.deepEqual(reasons(validateWeeklyPlan(answered, { week: 1, actions: [research("co-tracebench", "chk-tracebench-paying-teams")] })), [
    'action 1: you already have the result of "Скільки команд справді оплатили рахунок за останній місяць?" from week 1; read it on Tracebench\'s card',
  ]);
  const tracebench = availableActions(answered).research.find((c) => c.companyId === "co-tracebench");
  assert.ok(!tracebench?.checks.some((c) => c.checkId === "chk-tracebench-paying-teams"));
  assert.deepEqual(tracebench?.answered, [
    {
      checkId: "chk-tracebench-paying-teams",
      question: "Скільки команд справді оплатили рахунок за останній місяць?",
      week: 1,
      observationId: "obs-earlier",
    },
  ]);
});

test("a plan for another week and malformed plans are rejected with readable reasons", () => {
  assert.deepEqual(reasons(validateWeeklyPlan(campaign(), { week: 2, actions: [] })), ["this plan is for week 2, but you are planning week 1"]);
  const table: Array<[unknown, string[]]> = [
    [null, ["plan: must be an object with week and actions"]],
    [{ week: 1 }, ["plan.actions: must be a list of actions (it may be empty)"]],
    [{ week: "1", actions: [] }, ["plan.week: must be the planning week number"]],
    [{ week: 1, actions: [], notes: "x" }, ["plan.notes: is not a known field"]],
    [{ week: 1, actions: [{ type: "scout" }] }, ['action 1: unknown action type "scout"; this week offers research']],
    [{ week: 1, actions: ["research"] }, ["action 1: must be an object with a type"]],
    [
      { week: 1, actions: [{ type: "research", companyId: "", slots: 2 }] },
      ["action 1: slots is not a field of research", "action 1: companyId must name a company", "action 1: checkId must name a research check"],
    ],
  ];
  for (const [plan, expected] of table) assert.deepEqual(reasons(validateWeeklyPlan(campaign(), plan)), expected, JSON.stringify(plan));
});

test("a sparse actions array is rejected position by position, not read as an empty plan", () => {
  assert.deepEqual(
    reasons(validateWeeklyPlan(campaign(), { week: 1, actions: new Array(2) })),
    ["action 1: must be an object with a type", "action 2: must be an object with a type"],
  );
  const holey: unknown[] = [research("co-tracebench", "chk-tracebench-paying-teams")];
  holey[2] = research("co-papirflow", "chk-papirflow-weekly-costs");
  assert.deepEqual(reasons(validateWeeklyPlan(campaign(), { week: 1, actions: holey })), ["action 2: must be an object with a type"]);
});

test("available actions list each known company's checks with question, cost and arrival, never results", () => {
  const actions = availableActions(campaign());
  assert.equal(actions.week, 1);
  assert.equal(actions.slotsAvailable, 5);
  assert.deepEqual(
    actions.research.map((c) => [c.companyId, c.companyName, c.checks.length, c.answered.length]),
    [
      ["co-tracebench", "Tracebench", 4, 0],
      ["co-papirflow", "Papirflow", 4, 0],
    ],
  );
  assert.deepEqual(actions.research[0]?.checks[0], {
    checkId: "chk-tracebench-paying-teams",
    direction: "customers",
    question: "Скільки команд справді оплатили рахунок за останній місяць?",
    source: "Платіжні дані Tracebench за місяць",
    slotCost: 1,
    resultReadableWeek: 2,
  });
  const json = canonicalJson(actions);
  for (const secret of ["co-rampa", "Rampa", "\"kind\"", "\"value\"", "4700", "2060000", "distortion", "Ірина Мельник автор", "Платіжний сервіс"]) {
    assert.ok(!json.includes(secret), `${secret} is in the available actions`);
  }
});

test("validating, reviewing and listing actions never change the campaign or its state hash", () => {
  const c = campaign();
  const before = canonicalJson({ state: c.state, revision: c.revision, journal: c.journal });
  validateWeeklyPlan(c, { week: 1, actions: [research("co-tracebench", "chk-tracebench-paying-teams")] });
  validateWeeklyPlan(c, { week: 1, actions: [research("co-rampa", "x")] });
  availableActions(c);
  assert.equal(canonicalJson({ state: c.state, revision: c.revision, journal: c.journal }), before);
  assert.equal(inspectCampaign(c).stateHash, c.manifest.initialStateHash);
});
