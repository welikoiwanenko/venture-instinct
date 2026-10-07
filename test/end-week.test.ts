// VI-32: End Week as one atomic command (docs/design-doc.md §6.2, §9.1, §17.3, §18).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  canonicalJson,
  initializeCampaign,
  inspectCampaign,
  submitCommand,
  viewAsPlayer,
  type Campaign,
  type SubmitResult,
} from "../src/app/campaign-app.ts";
import { viewForDebug } from "../src/app/debug.ts";

const PACK_PATH = "content/scenarios/gamma-three-companies.json";

function pack(): Record<string, any> {
  return JSON.parse(readFileSync(new URL(`../${PACK_PATH}`, import.meta.url), "utf8")) as Record<string, any>;
}

function campaign(config?: unknown): Campaign {
  const result = initializeCampaign({ seed: "demo-1", scenario: pack(), ...(config === undefined ? {} : { config }) });
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues));
  return result.campaign;
}

const research = (companyId: string, checkId: string) => ({ type: "research", companyId, checkId });

function endWeek(c: Campaign, commandId: string, actions: unknown[], week = inspectCampaign(c).planningWeek): SubmitResult {
  return submitCommand(c, { commandId, expectedRevision: c.revision, type: "endWeek", args: { week, actions } });
}

function accepted(result: SubmitResult): Extract<SubmitResult, { ok: true }> {
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.rejection));
  return result;
}

function snapshot(c: Campaign): string {
  return canonicalJson({ state: c.state, revision: c.revision, journal: c.journal });
}

test("ending week 1 with research delivers the result for week 2 and marks the contradicted claim", () => {
  const start = campaign();
  const { campaign: next, record } = accepted(endWeek(start, "w1", [research("co-tracebench", "chk-tracebench-paying-teams")]));
  const summary = inspectCampaign(next);
  assert.equal(summary.planningWeek, 2);
  assert.equal(summary.completedWeeks, 1);
  assert.equal(summary.slotsAvailable, 5, "week 2 opens with fresh slots");
  assert.equal(summary.revision, 1);
  assert.deepEqual(record.result, {
    endedWeek: 1,
    planningWeek: 2,
    slotsSpent: 1,
    slotsDiscarded: 4,
    delivered: ["obs-chk-tracebench-paying-teams-week-1"],
  });
  assert.equal(record.stateHash, summary.stateHash);

  const tracebench = viewAsPlayer(next).companies.find((c) => c.companyId === "co-tracebench");
  const result = tracebench?.observations.find((o) => o.observationId === "obs-chk-tracebench-paying-teams-week-1");
  assert.deepEqual(result, {
    observationId: "obs-chk-tracebench-paying-teams-week-1",
    companyId: "co-tracebench",
    source: { kind: "check", author: "Платіжні дані Tracebench за місяць" },
    receivedWeek: 1,
    period: { fromWeek: -3, toWeek: 0 },
    content: { kind: "metric", metric: "payingCustomers", value: 7 },
    references: [],
    status: "confirmed-by-check",
  });
  const claim = tracebench?.observations.find((o) => o.observationId === "obs-co-tracebench-application-paying-customers");
  assert.equal(claim?.status, "conflicting-evidence");
  // The honest revenue claim is untouched.
  assert.equal(tracebench?.observations.find((o) => o.observationId === "obs-co-tracebench-application-weekly-revenue-cents")?.status, "founder-claim");
  assert.deepEqual(next.state.research, [
    { companyId: "co-tracebench", checkId: "chk-tracebench-paying-teams", week: 1, observationId: "obs-chk-tracebench-paying-teams-week-1" },
  ]);
});

test("text and could-not-get-the-data results become text observations; provenance stays internal", () => {
  const { campaign: next } = accepted(
    endWeek(campaign(), "w1", [
      research("co-tracebench", "chk-tracebench-largest-customer"),
      research("co-papirflow", "chk-papirflow-daily-use"),
      research("co-papirflow", "chk-papirflow-weekly-costs"),
    ]),
  );
  const view = viewAsPlayer(next);
  const byId = new Map(view.companies.flatMap((c) => c.observations.map((o) => [o.observationId, o] as const)));
  const unavailable = byId.get("obs-chk-tracebench-largest-customer-week-1");
  assert.equal(unavailable?.content.kind, "text");
  assert.ok(unavailable?.content.kind === "text" && unavailable.content.title === "Не вдалося отримати дані");
  assert.ok(byId.get("obs-chk-papirflow-daily-use-week-1")?.content.kind === "text");
  assert.equal(byId.get("obs-co-papirflow-application-weekly-burn-cents")?.status, "conflicting-evidence");
  // The player view never carries the truth or a reason.
  const json = canonicalJson(view);
  for (const secret of ["provenance", "fact", "distortion", "excludes-contractor-costs"]) assert.ok(!json.includes(secret), secret);
  // The debug view shows where the delivered figure came from.
  const debug = viewForDebug(next).companies.find((c) => c.profile.id === "co-papirflow");
  const costs = debug?.observations.find((o) => o.observation.observationId === "obs-chk-papirflow-weekly-costs-week-1");
  assert.deepEqual(costs?.provenance, { observationId: "obs-chk-papirflow-weekly-costs-week-1", fact: { value: 2_060_000 } });
});

test("an invalid plan is rejected whole: no time passes, no slot is spent, revision and hash unchanged", () => {
  const start = campaign();
  const before = snapshot(start);
  const plans: Array<[unknown[], number | undefined, RegExp]> = [
    [[research("co-tracebench", "chk-tracebench-paying-teams"), research("co-rampa", "chk-x")], undefined, /you do not know a company "co-rampa"/],
    [Array.from({ length: 6 }, (_, i) => research("co-tracebench", `chk-${i}`)), undefined, /needs 6 slots/],
    [[], 2, /this plan is for week 2, but you are planning week 1/],
  ];
  for (const [actions, week, reason] of plans) {
    const result = endWeek(start, "w1", actions, week);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.rejection.code === "rejected");
    assert.match(!result.ok ? result.rejection.reasons.join("\n") : "", reason);
  }
  const malformed = submitCommand(start, { commandId: "w1", expectedRevision: 0, type: "endWeek", args: { week: 1 } });
  assert.ok(!malformed.ok && malformed.rejection.code === "invalid-arguments");
  assert.equal(snapshot(start), before);
  assert.equal(inspectCampaign(start).planningWeek, 1);
  // After all those rejections the same command id still works.
  assert.equal(accepted(endWeek(start, "w1", [])).record.sequence, 1);
});

test("ending a week with an empty plan is valid and advances time", () => {
  const { campaign: next, record } = accepted(endWeek(campaign(), "w1", []));
  assert.equal(inspectCampaign(next).planningWeek, 2);
  assert.deepEqual(record.result, { endedWeek: 1, planningWeek: 2, slotsSpent: 0, slotsDiscarded: 5, delivered: [] });
  assert.equal(next.state.observations.observations.length, campaign().state.observations.observations.length);
});

test("a delivered check cannot be bought again in a later week", () => {
  const week2 = accepted(endWeek(campaign(), "w1", [research("co-tracebench", "chk-tracebench-paying-teams")])).campaign;
  const again = endWeek(week2, "w2", [research("co-tracebench", "chk-tracebench-paying-teams")]);
  assert.ok(!again.ok);
  assert.match(!again.ok ? again.rejection.reasons[0] ?? "" : "", /you already have the result/);
});

test("the same seed, pack and commands give the same state hash and observation ids", () => {
  const run = () => {
    let c = campaign();
    c = accepted(endWeek(c, "w1", [research("co-tracebench", "chk-tracebench-paying-teams"), research("co-papirflow", "chk-papirflow-largest-customer")])).campaign;
    c = accepted(endWeek(c, "w2", [research("co-tracebench", "chk-tracebench-core-authors")])).campaign;
    c = accepted(endWeek(c, "w3", [])).campaign;
    return c;
  };
  const [a, b] = [run(), run()];
  assert.equal(inspectCampaign(a).stateHash, inspectCampaign(b).stateHash);
  assert.equal(snapshot(a), snapshot(b));
  assert.deepEqual(
    a.state.research.map((r) => r.observationId),
    [
      "obs-chk-tracebench-paying-teams-week-1",
      "obs-chk-papirflow-largest-customer-week-1",
      "obs-chk-tracebench-core-authors-week-2",
    ],
  );
  assert.equal(inspectCampaign(a).planningWeek, 4);
  assert.deepEqual(a.journal.map((r) => r.sequence), [1, 2, 3]);
});

test("repeating End Week with the same command id does not end a second week", () => {
  const first = accepted(endWeek(campaign(), "w1", [research("co-tracebench", "chk-tracebench-paying-teams")]));
  const retry = submitCommand(first.campaign, {
    commandId: "w1",
    expectedRevision: 0,
    type: "endWeek",
    args: { week: 1, actions: [research("co-tracebench", "chk-tracebench-paying-teams")] },
  });
  assert.ok(retry.ok && retry.repeated);
  assert.equal(inspectCampaign(retry.campaign).planningWeek, 2);
  assert.equal(retry.campaign.journal.length, 1);
});

test("the last week of the horizon cannot be ended until run completion exists", () => {
  const short = {
    id: "test-short",
    version: 1,
    investmentWindow: { firstWeek: 1, lastWeek: 1 },
    horizonWeeks: 2,
    slotsPerWeek: 5,
    initialCapitalCents: 100_000_000,
    checkSizeCents: 20_000_000,
    maxInitialInvestments: 5,
  };
  const week2 = accepted(endWeek(campaign(short), "w1", [])).campaign;
  assert.equal(inspectCampaign(week2).planningWeek, 2);
  const last = endWeek(week2, "w2", []);
  assert.ok(!last.ok);
  assert.deepEqual(!last.ok ? last.rejection.reasons : [], [
    "week 2 is the last week of the campaign; ending it completes the run, which is not available yet",
  ]);
  assert.equal(inspectCampaign(week2).completedWeeks, 1);
});

test("research on the longest allowed company and check ids still delivers", () => {
  const longest = pack();
  const companyId = `co-${"x".repeat(61)}`;
  const checkId = `chk-${"y".repeat(60)}`;
  longest["content"]["companies"][0]["id"] = companyId;
  longest["content"]["companies"][0]["researchChecks"][0]["id"] = checkId;
  const result = initializeCampaign({ seed: "demo-1", scenario: longest });
  assert.ok(result.ok);
  const { record } = accepted(endWeek(result.campaign, "w1", [research(companyId, checkId)]));
  const [id] = (record.result as { delivered: string[] }).delivered;
  assert.equal(id, `obs-${checkId}-week-1`);
});

test("company and check ids that join to the same text still deliver two distinct results", () => {
  // "co-a" + "b-c" and "co-a-b" + "c" would both read "co-a-b-c" if the two ids were joined.
  const colliding = pack();
  const [tracebench, papirflow] = colliding["content"]["companies"];
  tracebench["id"] = "co-a";
  tracebench["researchChecks"] = [tracebench["researchChecks"][0]];
  tracebench["researchChecks"][0]["id"] = "b-c";
  papirflow["id"] = "co-a-b";
  papirflow["researchChecks"] = [papirflow["researchChecks"][0]];
  papirflow["researchChecks"][0]["id"] = "c";
  const result = initializeCampaign({ seed: "demo-1", scenario: colliding });
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues));
  const { record, campaign: next } = accepted(endWeek(result.campaign, "w1", [research("co-a", "b-c"), research("co-a-b", "c")]));
  assert.deepEqual((record.result as { delivered: string[] }).delivered, ["obs-b-c-week-1", "obs-c-week-1"]);
  assert.deepEqual(
    next.state.research.map((r) => [r.companyId, r.checkId]),
    [
      ["co-a", "b-c"],
      ["co-a-b", "c"],
    ],
  );
});
