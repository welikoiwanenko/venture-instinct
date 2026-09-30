import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { initializeCampaign, type Campaign } from "../src/app/campaign-app.ts";
import {
  assertCompanyState,
  DIMENSION_VALUES,
  DIMENSIONS,
  initialCompanyStates,
  setCompanyDimension,
  type CompanyState,
  type Dimension,
} from "../src/campaign/company-dimensions.ts";

type Json = Record<string, any>;

/** The minimal fixture plus a second, unknown company. */
function twoCompanyPack(): Json {
  const pack = JSON.parse(readFileSync(new URL("../fixtures/scenarios/minimal-one-company.json", import.meta.url), "utf8")) as Json;
  const second = structuredClone(pack["content"]["companies"][0]) as Json;
  second["id"] = "co-fixture-beta";
  second["name"] = "Fixture Beta";
  second["sector"] = "logistics-software";
  second["founders"][0]["id"] = "fd-fixture-beta-1";
  second["initialKnowledge"] = "unknown";
  delete second["application"];
  pack["content"]["companies"].push(second);
  return pack;
}

function campaign(): Campaign {
  const result = initializeCampaign({ seed: "demo-1", scenario: twoCompanyPack() });
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues));
  return result.campaign;
}

test("every company starts with all five dimensions; knowledge follows the pack", () => {
  const { state } = campaign();
  assert.deepEqual(state.companies, [
    {
      companyId: "co-fixture-alpha",
      knowledge: "identified",
      decision: "undecided",
      contact: "none",
      opportunity: "unavailable",
      lifecycle: "operating",
    },
    {
      companyId: "co-fixture-beta",
      knowledge: "unknown",
      decision: "undecided",
      contact: "none",
      opportunity: "unavailable",
      lifecycle: "operating",
    },
  ]);
  for (const company of state.companies) {
    assertCompanyState(company);
    assert.deepEqual(Object.keys(company).sort(), ["companyId", ...DIMENSIONS].sort());
  }
});

test("a company unknown to the player still has a lifecycle in the world", () => {
  const unknown = campaign().state.companies.find((c) => c.knowledge === "unknown");
  assert.equal(unknown?.lifecycle, "operating");
});

test("the initial company states are frozen and part of the hashed initial state", () => {
  const c = campaign();
  assert.ok(Object.isFrozen(c.state.companies));
  assert.ok(c.state.companies.every((s) => Object.isFrozen(s)));
  assert.deepEqual(c.manifest.initialState.companies, c.state.companies);

  const other = twoCompanyPack();
  other["content"]["companies"][1]["initialKnowledge"] = "inbound";
  other["content"]["companies"][1]["application"] = structuredClone(other["content"]["companies"][0]["application"]);
  other["content"]["companies"][1]["application"]["authorId"] = "fd-fixture-beta-1";
  const changed = initializeCampaign({ seed: "demo-1", scenario: other });
  assert.ok(changed.ok);
  assert.notEqual(changed.campaign.manifest.initialStateHash, c.manifest.initialStateHash);
});

test("changing one dimension changes nothing else", () => {
  const companies = campaign().state.companies;
  for (const dimension of DIMENSIONS) {
    for (const value of DIMENSION_VALUES[dimension]) {
      const next = setCompanyDimension(companies, "co-fixture-beta", dimension, value as never);
      const [alpha, beta] = next as [CompanyState, CompanyState];
      assert.equal(alpha, companies[0], "other companies keep their identity");
      assert.equal(beta[dimension], value);
      for (const other of DIMENSIONS.filter((d) => d !== dimension)) {
        assert.equal(beta[other], companies[1]?.[other], `${dimension}=${value} changed ${other}`);
      }
      assert.ok(Object.isFrozen(next) && Object.isFrozen(beta));
    }
  }
  // The input list is untouched.
  assert.equal(companies[1]?.knowledge, "unknown");
});

test("knowledge and lifecycle move independently", () => {
  let companies = campaign().state.companies;
  companies = setCompanyDimension(companies, "co-fixture-beta", "lifecycle", "shutdown");
  assert.equal(companies[1]?.knowledge, "unknown", "a company can shut down before the player hears of it");
  companies = setCompanyDimension(companies, "co-fixture-beta", "knowledge", "signal");
  assert.equal(companies[1]?.lifecycle, "shutdown");
});

test("invalid dimension values, dimensions and companies are rejected", () => {
  const companies = campaign().state.companies;
  const table: Array<[string, string, unknown, RegExp]> = [
    ["co-fixture-alpha", "knowledge", "known", /knowledge must be one of unknown, signal, identified; got "known"/],
    ["co-fixture-alpha", "decision", "rejected", /decision must be one of/],
    ["co-fixture-alpha", "contact", "no-response", /contact must be one of .*no_response/],
    ["co-fixture-alpha", "opportunity", undefined, /opportunity must be one of/],
    ["co-fixture-alpha", "lifecycle", "pivoting", /lifecycle must be one of operating, distressed, shutdown, acquired/],
    ["co-fixture-alpha", "mood", "calm", /unknown company dimension "mood"/],
    ["co-nobody", "decision", "passed", /no company "co-nobody"/],
  ];
  for (const [id, dimension, value, message] of table) {
    assert.throws(() => setCompanyDimension(companies, id, dimension as Dimension, value as never), RangeError);
    assert.throws(() => setCompanyDimension(companies, id, dimension as Dimension, value as never), message);
  }
  assert.throws(() => assertCompanyState({ ...companies[0]!, lifecycle: "zombie" } as never), /lifecycle must be one of/);
});

test("initial states follow pack order and need no campaign", () => {
  const profiles = [
    { id: "co-b", initialKnowledge: "unknown" },
    { id: "co-a", initialKnowledge: "inbound" },
  ] as never;
  assert.deepEqual(
    initialCompanyStates(profiles).map((c) => [c.companyId, c.knowledge]),
    [
      ["co-b", "unknown"],
      ["co-a", "identified"],
    ],
  );
});
