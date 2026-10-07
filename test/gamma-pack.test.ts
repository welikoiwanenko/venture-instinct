// Content checks for the Gamma baseline pack (VI-16). Schema rules live in
// scenario-pack.test.ts; these check the authored companies themselves.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { CompanyProfile } from "../src/content/company-profile.ts";
import { SECTORS } from "../src/content/company-profile.ts";
import { validateScenarioPack } from "../src/content/scenario-pack.ts";
import { trueMetricValue } from "../src/knowledge/facts.ts";

const GAMMA_PACK_PATH = "content/scenarios/gamma-three-companies.json";

function companies(): readonly CompanyProfile[] {
  const result = validateScenarioPack(JSON.parse(readFileSync(new URL(`../${GAMMA_PACK_PATH}`, import.meta.url), "utf8")));
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues, null, 2));
  return result.pack.content.companies;
}

test("the pack passes schema validation with three companies, one per sector", () => {
  const list = companies();
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((c) => c.sector).sort(), [...SECTORS].sort());
  for (const company of list) {
    assert.ok(company.founders.length >= 1 && company.founders.length <= 3, company.id);
  }
});

test("two companies apply in the week 1 wave; the third is unknown and has no application", () => {
  const list = companies();
  const inbound = list.filter((c) => c.initialKnowledge === "inbound");
  const unknown = list.filter((c) => c.initialKnowledge === "unknown");
  assert.equal(inbound.length, 2);
  assert.equal(unknown.length, 1);
  for (const company of inbound) assert.ok(company.application !== undefined, company.id);
  assert.equal(unknown[0]?.application, undefined);
});

test("every application states its figures with a period and has at least one structured gap", () => {
  for (const company of companies()) {
    const application = company.application;
    if (application === undefined) continue;
    assert.ok(company.founders.some((f) => f.id === application.authorId), `${company.id}: the author is a founder`);
    assert.ok(application.claims.length >= 2, company.id);
    for (const claim of application.claims) {
      assert.ok(claim.period.toWeek <= 0 && claim.period.fromWeek <= claim.period.toWeek, `${company.id}/${claim.metric}`);
    }
    const gaps = application.claims.filter((claim) => claim.value !== trueMetricValue(company.hidden, claim.metric));
    assert.ok(gaps.length >= 1, `${company.id} has no gap between claim and hidden state`);
    for (const gap of gaps) assert.ok(gap.distortion !== undefined, `${company.id}/${gap.metric} has no reason`);
  }
});

test("applications stay within the §5 content budget of about 80–140 words", () => {
  for (const company of companies()) {
    if (company.application === undefined) continue;
    const words = company.application.text.split(/\s+/).length;
    assert.ok(words >= 80 && words <= 140, `${company.id}: ${words} words`);
    assert.ok(company.application.summary.length <= 140, `${company.id}: summary is one short line`);
  }
});

/** Higher is better on every axis; each is a real cause in §10.2–10.3, not a rating. */
function axes(c: CompanyProfile): Record<string, number> {
  const revenue = trueMetricValue(c.hidden, "weeklyRevenueCents");
  return {
    cash: c.hidden.cashCents,
    revenue,
    weeklyNet: revenue - trueMetricValue(c.hidden, "weeklyBurnCents"),
    productFit: c.hidden.productFit,
    leads: c.hidden.baseWeeklyLeads,
    alignment: c.hidden.founderAlignmentBps,
    spread: -c.hidden.largestCustomerShareBps,
    teamSize: trueMetricValue(c.hidden, "teamSize"),
  };
}

test("no company is at least as good as another on every hidden axis", () => {
  const list = companies();
  for (const a of list) {
    for (const b of list) {
      if (a === b) continue;
      const [x, y] = [axes(a), axes(b)];
      const worseSomewhere = Object.keys(x).some((axis) => (x[axis] ?? 0) < (y[axis] ?? 0));
      assert.ok(worseSomewhere, `${a.id} is nowhere worse than ${b.id}: ${JSON.stringify({ [a.id]: x, [b.id]: y })}`);
    }
  }
});

test("every company has an authoring note naming its trade-off", () => {
  for (const company of companies()) {
    assert.match(company.authoringNote ?? "", /^Trade-off: .+ but .+/, company.id);
  }
});

test("names and public descriptions do not reveal the hidden state or an outcome", () => {
  const telling = /найкращ|лідер|успіш|провал|банкрут|перемож|зірк|єдинорог|best|leader|winner|unicorn|doomed|fail|\d/i;
  for (const company of companies()) {
    assert.doesNotMatch(company.name, telling, company.id);
    assert.doesNotMatch(company.description, telling, company.id);
  }
});

// VI-30: research checks for the two companies the player knows (design §5, §9.2, §14.1).

test("each known company has 3–4 checks covering at least three §9.2 directions; Rampa has none", () => {
  for (const company of companies()) {
    const checks = company.researchChecks;
    if (company.initialKnowledge === "unknown") {
      assert.deepEqual(checks, [], `${company.id} is unknown to the player in Delta`);
      continue;
    }
    assert.ok(checks.length >= 3 && checks.length <= 4, `${company.id}: ${checks.length} checks`);
    assert.ok(new Set(checks.map((c) => c.direction)).size >= 3, `${company.id}: directions`);
  }
});

test("every check result describes week 0 or earlier and its figure matches the truth or has a reason", () => {
  for (const company of companies()) {
    for (const check of company.researchChecks) {
      assert.ok(check.evidence.period.toWeek <= 0, check.id);
      if (check.result.kind !== "metric") continue;
      const truth = trueMetricValue(company.hidden, check.result.metric);
      assert.ok(check.result.value === truth || check.result.distortion !== undefined, check.id);
    }
  }
});

test("each known company has a check that contradicts its application", () => {
  for (const company of companies()) {
    if (company.application === undefined) continue;
    const contradicted = company.researchChecks.filter((check) => {
      const result = check.result;
      if (result.kind !== "metric") return false;
      return company.application!.claims.some((claim) => claim.metric === result.metric && claim.value !== result.value);
    });
    assert.ok(contradicted.length >= 1, `${company.id}: no check contradicts the application`);
  }
  const byId = new Map(companies().flatMap((c) => c.researchChecks.map((check) => [check.id, check] as const)));
  assert.deepEqual(byId.get("chk-tracebench-paying-teams")?.result, { kind: "metric", metric: "payingCustomers", value: 7 });
  assert.deepEqual(byId.get("chk-papirflow-largest-customer")?.result, { kind: "metric", metric: "largestCustomerShareBps", value: 4700 });
  assert.deepEqual(byId.get("chk-papirflow-weekly-costs")?.result, { kind: "metric", metric: "weeklyBurnCents", value: 2_060_000 });
});

test("the pack has a could-not-get-the-data result and text evidence for team or product", () => {
  const checks = companies().flatMap((c) => c.researchChecks);
  const unavailable = checks.filter((c) => c.result.kind === "unavailable");
  assert.ok(unavailable.length >= 1);
  for (const check of unavailable) {
    // The reason explains access, not deception (§9.2).
    assert.doesNotMatch(check.result.kind === "unavailable" ? check.result.reason : "", /прихову|бреш|обман|відмовил/i, check.id);
  }
  assert.ok(checks.some((c) => (c.direction === "team" || c.direction === "product") && c.result.kind === "text"));
});

test("no check reveals a future outcome or a verdict", () => {
  const telling = /найкращ|найгірш|успіш|провал|банкрут|перемож|приречен|якіст|оцінк|рейтинг|прогноз|буде |станеться|best|worst|winner|doomed|fail/i;
  for (const check of companies().flatMap((c) => c.researchChecks)) {
    const texts = [check.question, check.evidence.source];
    if (check.result.kind === "text") texts.push(check.result.title, check.result.text);
    if (check.result.kind === "unavailable") texts.push(check.result.reason);
    for (const text of texts) assert.doesNotMatch(text, telling, check.id);
  }
});
