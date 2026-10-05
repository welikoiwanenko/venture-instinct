import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  canonicalJson,
  initializeCampaign,
  inspectCampaign,
  searchKnownCompanies,
  viewAsPlayer,
  type Campaign,
} from "../src/app/campaign-app.ts";
import { viewForDebug } from "../src/app/debug.ts";
import { appendObservations } from "../src/knowledge/observation.ts";

type Json = Record<string, any>;

function gammaPack(): Json {
  return JSON.parse(readFileSync(new URL("../content/scenarios/gamma-three-companies.json", import.meta.url), "utf8")) as Json;
}

function start(pack: Json = gammaPack()): Campaign {
  const result = initializeCampaign({ seed: "demo-1", scenario: pack });
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues));
  return result.campaign;
}

/**
 * The campaign as delivered (the week 1 applications), plus one observation about
 * Rampa, which the player does not know. It cannot be delivered that way yet; it is
 * appended directly to prove that the view hides unknown companies whatever the log holds.
 */
function withObservations(campaign: Campaign): Campaign {
  const result = appendObservations(campaign.state.observations, [
    {
      observation: {
        observationId: "obs-rampa-customers",
        companyId: "co-rampa",
        source: { kind: "founder", author: "fd-andrii-savchuk" },
        receivedWeek: 1,
        period: { fromWeek: 0, toWeek: 0 },
        content: { kind: "metric", metric: "payingCustomers", value: 11 },
        references: [],
      },
      provenance: { fact: { value: 11 } },
    },
  ]);
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues));
  return Object.freeze({ ...campaign, state: Object.freeze({ ...campaign.state, observations: result.log }) });
}

/** Every object key anywhere in `value`. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
  else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysOf(child, into);
    }
  }
  return into;
}

test("the player view lists the identified companies with their observations and statuses", () => {
  const view = viewAsPlayer(withObservations(start()));
  assert.equal(view.planningWeek, 1);
  assert.deepEqual(
    view.companies.map((c) => c.companyId),
    ["co-tracebench", "co-papirflow"],
  );
  const [tracebench] = view.companies;
  assert.equal(tracebench?.profile?.name, "Tracebench");
  assert.equal(tracebench?.profile?.sector, "developer-tools");
  assert.deepEqual(tracebench?.profile?.founders.map((f) => f.name), ["Остап Гнатюк", "Ірина Мельник"]);
  assert.deepEqual(
    tracebench?.observations.map((o) => [o.observationId, o.source.author, o.receivedWeek, o.period.toWeek, o.status]),
    [
      ["obs-co-tracebench-application", "fd-ostap-hnatiuk", 1, 0, "founder-claim"],
      ["obs-co-tracebench-application-paying-customers", "fd-ostap-hnatiuk", 1, 0, "founder-claim"],
      ["obs-co-tracebench-application-weekly-revenue-cents", "fd-ostap-hnatiuk", 1, 0, "founder-claim"],
      ["obs-co-tracebench-application-team-size", "fd-ostap-hnatiuk", 1, 0, "founder-claim"],
    ],
  );
  assert.deepEqual(
    { knowledge: tracebench?.knowledge, decision: tracebench?.decision, contact: tracebench?.contact, opportunity: tracebench?.opportunity },
    { knowledge: "identified", decision: "undecided", contact: "none", opportunity: "unavailable" },
  );
});

test("the serialized player view has no hidden-state keys or values", () => {
  const campaign = withObservations(start());
  const view = viewAsPlayer(campaign);
  const keys = keysOf(view);
  const hidden = [
    "hidden",
    "productFit",
    "cashCents",
    "weeklyPriceCents",
    "payingCustomers",
    "largestCustomerShareBps",
    "baseWeeklyLeads",
    "team",
    "otherWeeklyCostsCents",
    "founderAlignmentBps",
    "unresolvedConflicts",
    "strategy",
    "provenance",
    "fact",
    "distortion",
    "reason",
    "note",
    "authoringNote",
    "initialKnowledge",
    "application",
    "claims",
    "lifecycle",
    "trueMetrics",
  ];
  for (const key of hidden) assert.ok(!keys.has(key), `${key} is in the player view`);

  const json = canonicalJson(view);
  const debugOnly = [
    "counts-pilots-as-paying",
    "free extended pilot",
    "excludes-contractor-costs",
    "optimistic-founder-claim",
    "open-core",
    "Trade-off",
    "operating",
    "Rampa",
    "co-rampa",
    "fd-andrii-savchuk",
    "Савчук",
  ];
  for (const text of debugOnly) assert.ok(!json.includes(text), `${text} is in the player view`);
});

test("changing hidden values does not change the player view", () => {
  const base = viewAsPlayer(withObservations(start()));
  const pack = gammaPack();
  const [tracebench, papirflow, rampa] = pack["content"]["companies"] as [Json, Json, Json];
  tracebench["hidden"]["productFit"] = 5;
  tracebench["hidden"]["cashCents"] = 1;
  tracebench["hidden"]["unresolvedConflicts"] = [];
  tracebench["authoringNote"] = "Trade-off: edited but still a trade-off";
  papirflow["hidden"]["strategy"] = "pivot";
  papirflow["application"]["claims"][2]["distortion"]["note"] = "a different reason text";
  rampa["hidden"]["payingCustomers"] = 12;
  rampa["hidden"]["largestCustomerShareBps"] = 900;
  rampa["name"] = "Renamed";
  const edited = viewAsPlayer(withObservations(start(pack)));
  const withoutId = (v: typeof base) => canonicalJson({ ...v, campaignId: "" });
  assert.notEqual(edited.campaignId, base.campaignId, "the pack hash, and so the campaign, did change");
  assert.equal(withoutId(edited), withoutId(base));
});

test("an unknown company is absent from the view, its counts and search", () => {
  const campaign = withObservations(start());
  const view = viewAsPlayer(campaign);
  assert.equal(view.companies.length, 2);
  assert.ok(!view.companies.some((c) => c.companyId === "co-rampa"));
  for (const query of ["Rampa", "rampa", "co-rampa", "Савчук", "розвантаження"]) {
    assert.deepEqual(searchKnownCompanies(campaign, query), [], query);
  }
  assert.deepEqual(searchKnownCompanies(campaign, "tracebench").map((c) => c.companyId), ["co-tracebench"]);
  assert.deepEqual(searchKnownCompanies(campaign, "ТАРАС").map((c) => c.companyId), ["co-papirflow"]);
  assert.deepEqual(searchKnownCompanies(campaign, "нестабільні").map((c) => c.companyId), ["co-tracebench"]);
  assert.deepEqual(searchKnownCompanies(campaign, "  "), []);
});

test("reading the player and debug views does not change the campaign", () => {
  const campaign = withObservations(start());
  const before = canonicalJson(campaign);
  const hash = inspectCampaign(campaign).stateHash;
  const first = canonicalJson(viewAsPlayer(campaign));
  for (let i = 0; i < 3; i++) {
    assert.equal(canonicalJson(viewAsPlayer(campaign)), first);
    viewForDebug(campaign);
    searchKnownCompanies(campaign, "Tracebench");
  }
  assert.equal(canonicalJson(campaign), before);
  assert.equal(inspectCampaign(campaign).stateHash, hash);
});

test("the player view is frozen and shares nothing with the campaign", () => {
  const campaign = withObservations(start());
  const view = viewAsPlayer(campaign);
  assert.ok(Object.isFrozen(view) && Object.isFrozen(view.companies[0]?.observations[0]));
  assert.notEqual(view.companies[0]?.observations[0], campaign.state.observations.observations[0]);
});

test("the debug view shows every company with hidden state, provenance and lifecycle", () => {
  const campaign = withObservations(start());
  const debug = viewForDebug(campaign);
  assert.equal(debug.kind, "debug");
  assert.deepEqual(
    debug.companies.map((c) => [c.state.companyId, c.state.knowledge, c.state.lifecycle]),
    [
      ["co-tracebench", "identified", "operating"],
      ["co-papirflow", "identified", "operating"],
      ["co-rampa", "unknown", "operating"],
    ],
  );
  const [tracebench, papirflow] = debug.companies;
  assert.equal(tracebench?.profile.hidden.productFit, 71);
  assert.equal(tracebench?.trueMetrics.payingCustomers, 7);
  assert.equal(papirflow?.trueMetrics.weeklyBurnCents, 2_060_000);
  const claim = tracebench?.observations.find((o) => o.observation.observationId === "obs-co-tracebench-application-paying-customers");
  assert.equal(claim?.provenance?.distortion?.reason, "counts-pilots-as-paying");
  assert.equal(claim?.status, "founder-claim");
  assert.ok(Object.isFrozen(debug.companies[0]?.profile.hidden));
});

test("the player view does not reach the debug view", () => {
  const view = viewAsPlayer(withObservations(start()));
  assert.ok(!canonicalJson(view).includes('"kind":"debug"'));
  assert.equal(Object.getPrototypeOf(view), Object.prototype);
  assert.ok(Object.values(view).every((v) => typeof v !== "function"));
});
