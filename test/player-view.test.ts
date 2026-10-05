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
 * The campaign with observations in its log. Delivery rules arrive with VI-18; here the
 * log is filled directly so the view can be tested on its own. One observation is
 * about Rampa, which the player does not know: the view must still hide it.
 */
function withObservations(campaign: Campaign): Campaign {
  const founderClaim = (id: string, companyId: string, author: string, metric: string, value: number, fact: number, distortion?: object) => ({
    observation: {
      observationId: id,
      companyId,
      source: { kind: "founder", author },
      receivedWeek: 1,
      period: { fromWeek: 0, toWeek: 0 },
      content: { kind: "metric", metric, value },
      references: [],
    },
    provenance: { fact: { value: fact }, ...(distortion === undefined ? {} : { distortion }) },
  });
  const result = appendObservations(campaign.state.observations, [
    {
      observation: {
        observationId: "obs-tracebench-application",
        companyId: "co-tracebench",
        source: { kind: "founder", author: "fd-ostap-hnatiuk" },
        receivedWeek: 1,
        period: { fromWeek: 0, toWeek: 0 },
        content: { kind: "text", title: "Пошук нестабільних тестів у CI", text: "Tracebench знаходить нестабільні тести в CI." },
        references: [],
      },
    },
    founderClaim("obs-tracebench-customers", "co-tracebench", "fd-ostap-hnatiuk", "payingCustomers", 19, 7, {
      reason: "counts-pilots-as-paying",
      note: "12 free pilots counted as paying",
    }),
    founderClaim("obs-papirflow-burn", "co-papirflow", "fd-taras-kovalenko", "weeklyBurnCents", 920_000, 2_060_000, {
      reason: "excludes-contractor-costs",
      note: "contract developers booked as project cost",
    }),
    founderClaim("obs-rampa-customers", "co-rampa", "fd-andrii-savchuk", "payingCustomers", 11, 11),
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
      ["obs-tracebench-application", "fd-ostap-hnatiuk", 1, 0, "founder-claim"],
      ["obs-tracebench-customers", "fd-ostap-hnatiuk", 1, 0, "founder-claim"],
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
    "free pilots",
    "excludes-contractor-costs",
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
  const claim = tracebench?.observations.find((o) => o.observation.observationId === "obs-tracebench-customers");
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
