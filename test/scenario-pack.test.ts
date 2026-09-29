import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { initializeCampaign } from "../src/app/campaign-app.ts";
import { isForbiddenField } from "../src/content/company-profile.ts";
import { validateScenarioPack } from "../src/content/scenario-pack.ts";
import type { ContentIssue } from "../src/content/fields.ts";
import { canonicalHash } from "../src/manifest/canonical-json.ts";

const MINIMAL = "fixtures/scenarios/minimal-one-company.json";
const COMPANY = "scenario.content.companies[0]";

type Json = Record<string, any>;

function load(path: string): Json {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) as Json;
}

function minimal(): Json {
  return load(MINIMAL);
}

function issuesOf(pack: unknown): readonly ContentIssue[] {
  const result = validateScenarioPack(pack);
  assert.equal(result.ok, false, "expected the pack to be rejected");
  return result.ok ? [] : result.issues;
}

function edit(change: (company: Json) => void): Json {
  const pack = minimal();
  change(pack["content"]["companies"][0] as Json);
  return pack;
}

test("the minimal fixture pack loads and a campaign starts from it", () => {
  const result = validateScenarioPack(minimal());
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues));
  const [company] = result.pack.content.companies;
  assert.equal(company?.id, "co-fixture-alpha");
  assert.equal(company?.hidden.weeklyPriceCents, 20_000);
  assert.equal(result.contentHash, canonicalHash(minimal()));

  const campaign = initializeCampaign({ seed: "demo-1", scenario: minimal() });
  assert.ok(campaign.ok);
  assert.equal(campaign.campaign.manifest.scenario.contentHash, result.contentHash);
  assert.equal(campaign.campaign.manifest.versions.content, 1);
});

test("the technical empty fixture is still a valid pack", () => {
  const result = validateScenarioPack(load("fixtures/scenarios/technical-empty.json"));
  assert.ok(result.ok);
  assert.deepEqual(result.pack.content.companies, []);
});

test("invalid fixtures fail with field-specific errors", () => {
  const forbidden = "is forbidden: a profile sets starting conditions, not a quality score, winner flag, exit or outcome (§3.1, §10.1)";
  const economics = "is required: §10.3 cannot simulate the company without it";
  const table: Array<[string, ContentIssue[]]> = [
    [
      "fixtures/scenarios/invalid/missing-economics.json",
      [
        { path: `${COMPANY}.hidden.weeklyPriceCents`, message: economics },
        { path: `${COMPANY}.hidden.team[0].weeklyCostCents`, message: economics },
        { path: `${COMPANY}.hidden.otherWeeklyCostsCents`, message: economics },
      ],
    ],
    [
      "fixtures/scenarios/invalid/forbidden-outcome-field.json",
      [
        { path: `${COMPANY}.hidden.isWinner`, message: forbidden },
        { path: `${COMPANY}.hidden.plannedExit`, message: forbidden },
        { path: `${COMPANY}.qualityScore`, message: forbidden },
      ],
    ],
    [
      "fixtures/scenarios/invalid/duplicate-ids.json",
      [
        {
          path: "scenario.content.companies[1].id",
          message: 'duplicates company id "co-fixture-alpha" first used at scenario.content.companies[0].id',
        },
        {
          path: "scenario.content.companies[1].founders[0].id",
          message: 'duplicates founder id "fd-fixture-alpha-1" first used at scenario.content.companies[0].founders[0].id',
        },
      ],
    ],
  ];
  for (const [path, expected] of table) {
    assert.deepEqual(issuesOf(load(path)), expected, path);
    const campaign = initializeCampaign({ seed: "demo-1", scenario: load(path) });
    assert.equal(campaign.ok, false, path);
  }
});

test("every §10.3 economic field is required, each with its own error", () => {
  for (const key of [
    "cashCents",
    "weeklyPriceCents",
    "payingCustomers",
    "largestCustomerShareBps",
    "baseWeeklyLeads",
    "productFit",
    "team",
    "otherWeeklyCostsCents",
  ]) {
    const issues = issuesOf(edit((c) => delete c["hidden"][key]));
    assert.deepEqual(
      issues.map((i) => i.path),
      [`${COMPANY}.hidden.${key}`],
      `${key}: ${JSON.stringify(issues)}`,
    );
    assert.match(issues[0]?.message ?? "", /^is required: §10\.3/);
  }
  for (const key of ["weeklyCostCents", "productivityBps"]) {
    const issues = issuesOf(edit((c) => delete c["hidden"]["team"][0][key]));
    assert.deepEqual(issues.map((i) => i.path), [`${COMPANY}.hidden.team[0].${key}`]);
  }
});

test("rating, winner, exit and outcome fields are forbidden anywhere in a profile", () => {
  for (const key of [
    "quality",
    "qualityScore",
    "score",
    "rating",
    "rank",
    "tier",
    "winner",
    "isWinner",
    "is_winner",
    "exit",
    "plannedExit",
    "exitWeek",
    "outcome",
    "guaranteedOutcome",
    "guaranteed",
    "destiny",
  ]) {
    assert.ok(isForbiddenField(key), key);
  }
  for (const key of [
    "productFit",
    "founderAlignmentBps",
    "largestCustomerShareBps",
    "baseWeeklyLeads",
    "strategy",
    "description",
    "authoringNote",
    "existing",
    "ranking" /* not a whole word "rank"; unknown-field check still rejects it */,
  ]) {
    assert.ok(!isForbiddenField(key), key);
  }
  for (const place of [
    (c: Json) => (c["startupQuality"] = 90),
    (c: Json) => (c["hidden"]["winner"] = true),
    (c: Json) => (c["founders"][0]["rating"] = 5),
    (c: Json) => (c["hidden"]["team"][0]["guaranteedOutcome"] = "ipo"),
  ]) {
    const issues = issuesOf(edit(place));
    assert.equal(issues.length, 1, JSON.stringify(issues));
    assert.match(issues[0]?.message ?? "", /^is forbidden/);
  }
});

test("the schema's own field names are not forbidden", () => {
  const keys = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== "object" || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      walk(child);
    }
  };
  walk(edit((c) => (c["hidden"]["unresolvedConflicts"] = [{ id: "x", founderIds: ["a", "b"], topic: "t" }])));
  for (const key of keys) assert.ok(!isForbiddenField(key), key);
});

test("units and ranges are enforced: cents, basis points and fit 0–100", () => {
  const table: Array<[(c: Json) => void, string, RegExp]> = [
    [(c) => (c["hidden"]["cashCents"] = 1.5), "hidden.cashCents", /whole number of cents, got 1\.5/],
    [(c) => (c["hidden"]["cashCents"] = -1), "hidden.cashCents", /at least 0 cents, got -1/],
    [(c) => (c["hidden"]["weeklyPriceCents"] = 0), "hidden.weeklyPriceCents", /at least 1 cents/],
    [(c) => (c["hidden"]["weeklyPriceCents"] = "200"), "hidden.weeklyPriceCents", /whole number of cents, got "200"/],
    [(c) => (c["hidden"]["largestCustomerShareBps"] = 10_001), "hidden.largestCustomerShareBps", /between 0 and 10000 basis points/],
    [(c) => (c["hidden"]["founderAlignmentBps"] = -5), "hidden.founderAlignmentBps", /between 0 and 10000 basis points/],
    [(c) => (c["hidden"]["productFit"] = 101), "hidden.productFit", /between 0 and 100, got 101/],
    [(c) => (c["hidden"]["team"][0]["headcount"] = 0), "hidden.team[0].headcount", /at least 1 people/],
    [(c) => (c["hidden"]["team"][0]["productivityBps"] = 20_001), "hidden.team[0].productivityBps", /between 0 and 20000/],
    [(c) => (c["hidden"]["team"] = []), "hidden.team", /at least one line/],
  ];
  for (const [change, field, message] of table) {
    const issues = issuesOf(edit(change));
    assert.deepEqual(issues.map((i) => i.path), [`${COMPANY}.${field}`], field);
    assert.match(issues[0]?.message ?? "", message, field);
  }
});

test("customer concentration must be consistent with the customer count", () => {
  const none = issuesOf(edit((c) => (c["hidden"]["payingCustomers"] = 0)));
  assert.deepEqual(none, [
    { path: `${COMPANY}.hidden.largestCustomerShareBps`, message: "must be 0 when there are no paying customers, got 4000" },
  ]);
  const tooSmall = issuesOf(edit((c) => (c["hidden"]["largestCustomerShareBps"] = 2000)));
  assert.deepEqual(tooSmall, [
    { path: `${COMPANY}.hidden.largestCustomerShareBps`, message: "the largest of 4 customers has at least 2500 basis points, got 2000" },
  ]);
});

test("enum fields accept only their listed values", () => {
  for (const [change, field] of [
    [(c: Json) => (c["sector"] = "fintech"), "sector"],
    [(c: Json) => (c["businessModel"] = "marketplace"), "businessModel"],
    [(c: Json) => (c["initialKnowledge"] = "known"), "initialKnowledge"],
    [(c: Json) => (c["hidden"]["strategy"] = "moonshot"), "hidden.strategy"],
    [(c: Json) => (c["founders"][0]["specialization"] = "genius"), "founders[0].specialization"],
  ] as const) {
    const issues = issuesOf(edit(change));
    assert.deepEqual(issues.map((i) => i.path), [`${COMPANY}.${field}`], field);
    assert.match(issues[0]?.message ?? "", /^must be one of /);
  }
});

test("founders and conflicts reference each other correctly", () => {
  const two = (c: Json) => {
    c["founders"].push({ id: "fd-fixture-alpha-2", name: "Founder Two", specialization: "sales" });
  };
  const ok = validateScenarioPack(
    edit((c) => {
      two(c);
      c["hidden"]["unresolvedConflicts"] = [{ id: "open-source-core", founderIds: ["fd-fixture-alpha-1", "fd-fixture-alpha-2"], topic: "t" }];
    }),
  );
  assert.ok(ok.ok, ok.ok ? "" : JSON.stringify(ok.issues));

  const conflictPath = `${COMPANY}.hidden.unresolvedConflicts[0].founderIds`;
  assert.deepEqual(
    issuesOf(
      edit((c) => {
        two(c);
        c["hidden"]["unresolvedConflicts"] = [{ id: "x", founderIds: ["fd-fixture-alpha-1", "fd-elsewhere"], topic: "t" }];
      }),
    ),
    [{ path: `${conflictPath}[1]`, message: '"fd-elsewhere" is not a founder of this company' }],
  );
  assert.deepEqual(
    issuesOf(edit((c) => (c["hidden"]["unresolvedConflicts"] = [{ id: "x", founderIds: ["fd-fixture-alpha-1"], topic: "t" }]))),
    [{ path: conflictPath, message: "a conflict needs at least 2 founders, got 1" }],
  );
  assert.deepEqual(
    issuesOf(edit((c) => (c["founders"] = []))),
    [{ path: `${COMPANY}.founders`, message: "must list 1 to 3 founders, got 0" }],
  );
  assert.deepEqual(
    issuesOf(
      edit((c) => {
        two(c);
        c["hidden"]["team"][0]["headcount"] = 1;
      }),
    ),
    [{ path: `${COMPANY}.hidden.team`, message: "must include the 2 founders, but its headcount is 1" }],
  );
});

test("ids are stable kebab-case strings and unknown fields are rejected", () => {
  assert.deepEqual(
    issuesOf(edit((c) => (c["id"] = "Co Alpha"))).map((i) => i.path),
    [`${COMPANY}.id`],
  );
  assert.deepEqual(issuesOf(edit((c) => (c["hidden"]["mood"] = "sunny"))), [
    { path: `${COMPANY}.hidden.mood`, message: "is not a known field" },
  ]);
});

test("the content hash changes with any content field but not with key order", () => {
  const base = validateScenarioPack(minimal());
  assert.ok(base.ok);

  // Every leaf of the pack, changed one at a time, gives a different hash.
  const leaves: Array<Array<string | number>> = [];
  const walk = (value: unknown, path: Array<string | number>): void => {
    if (Array.isArray(value)) return value.forEach((item, i) => walk(item, [...path, i]));
    if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) walk(child, [...path, key]);
      return;
    }
    leaves.push(path);
  };
  walk(minimal(), []);
  assert.ok(leaves.length > 20);
  for (const path of leaves) {
    const pack = minimal();
    let parent: any = pack;
    for (const key of path.slice(0, -1)) parent = parent[key];
    const last = path.at(-1) as string;
    const value = parent[last];
    parent[last] = typeof value === "number" ? value + 1 : typeof value === "string" ? `${value}-x` : value;
    const result = validateScenarioPack(pack);
    // Some edits make the pack invalid (e.g. an enum); those cannot load at all.
    if (result.ok) assert.notEqual(result.contentHash, base.contentHash, path.join("."));
  }

  const reversed = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reversed);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]));
  };
  const reordered = validateScenarioPack(reversed(minimal()));
  assert.ok(reordered.ok);
  assert.equal(reordered.contentHash, base.contentHash);
});

test("the validated pack is independent of its input", () => {
  const input = minimal();
  const result = validateScenarioPack(input);
  assert.ok(result.ok);
  input["content"]["companies"][0]["hidden"]["cashCents"] = 1;
  assert.equal(result.pack.content.companies[0]?.hidden.cashCents, 10_000_000);
});

test("inbound companies have an application; unknown companies have none", () => {
  const app = `${COMPANY}.application`;
  assert.deepEqual(issuesOf(edit((c) => delete c["application"])), [
    { path: app, message: "is required: an inbound company applied in the week 1 wave (§8.1)" },
  ]);
  assert.deepEqual(issuesOf(edit((c) => (c["initialKnowledge"] = "unknown"))), [
    { path: app, message: "must be absent: the player has not heard of a company that starts unknown" },
  ]);
  const unknown = validateScenarioPack(
    edit((c) => {
      c["initialKnowledge"] = "unknown";
      delete c["application"];
    }),
  );
  assert.ok(unknown.ok);
});

test("application claims name a period, come from a founder and explain every gap", () => {
  const app = `${COMPANY}.application`;
  const claim = `${app}.claims[0]`;
  const table: Array<[(c: Json) => void, ContentIssue[]]> = [
    [(c) => (c["application"]["authorId"] = "fd-someone-else"), [{ path: `${app}.authorId`, message: '"fd-someone-else" is not a founder of this company' }]],
    [(c) => (c["application"]["receivedWeek"] = 3), [{ path: `${app}.receivedWeek`, message: "must be 1: only the first inbound wave exists so far, got 3" }]],
    [(c) => (c["application"]["claims"] = []), [{ path: `${app}.claims`, message: "must state at least one figure with its period (§8.1)" }]],
    [(c) => delete c["application"]["claims"][0]["period"], [{ path: `${claim}.period`, message: "is required" }]],
    [
      (c) => delete c["application"]["claims"][0]["period"]["toWeek"],
      [{ path: `${claim}.period.toWeek`, message: "is required: every claimed figure names its period" }],
    ],
    [
      (c) => (c["application"]["claims"][0]["period"] = { fromWeek: 0, toWeek: 1 }),
      [{ path: `${claim}.period.toWeek`, message: "must be between -520 and 0, got 1" }],
    ],
    [
      (c) => (c["application"]["claims"][0]["value"] = 9),
      [{ path: `${claim}.distortion`, message: "is required: the claim states 9 but the hidden state gives 4 (§14.1)" }],
    ],
    [
      (c) => (c["application"]["claims"][0]["distortion"] = { reason: "honest-mistake", note: "n" }),
      [{ path: `${claim}.distortion`, message: "must be absent: the claim matches the hidden state (4)" }],
    ],
    [
      (c) => c["application"]["claims"].push({ metric: "payingCustomers", value: 4, period: { fromWeek: 0, toWeek: 0 } }),
      [{ path: `${app}.claims[1].metric`, message: "payingCustomers is already stated" }],
    ],
  ];
  for (const [change, expected] of table) {
    assert.deepEqual(issuesOf(edit(change)), expected);
  }
  const explained = validateScenarioPack(
    edit((c) => {
      c["application"]["claims"][0]["value"] = 9;
      c["application"]["claims"][0]["distortion"] = { reason: "counts-pilots-as-paying", note: "5 are pilots" };
    }),
  );
  assert.ok(explained.ok, explained.ok ? "" : JSON.stringify(explained.issues));
});

test("derived revenue, costs and headcount must stay within the safe-integer range", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const revenue = issuesOf(edit((c) => (c["hidden"]["weeklyPriceCents"] = max)));
  assert.deepEqual(revenue.map((i) => i.path), [`${COMPANY}.hidden.weeklyPriceCents`]);
  assert.match(revenue[0]?.message ?? "", /× 4 paying customers gives weekly revenue of 36028797018963964 cents, beyond the safe-integer range/);

  const costs = issuesOf(edit((c) => (c["hidden"]["otherWeeklyCostsCents"] = max)));
  assert.deepEqual(costs, [
    { path: `${COMPANY}.hidden.team`, message: `weekly costs with otherWeeklyCostsCents total ${BigInt(max) + 600000n} cents, beyond the safe-integer range` },
  ]);

  const people = issuesOf(
    edit((c) => {
      c["hidden"]["team"].push({ specialization: "sales", headcount: max, weeklyCostCents: 0, productivityBps: 10000 });
    }),
  );
  assert.deepEqual(people, [{ path: `${COMPANY}.hidden.team`, message: `total headcount ${BigInt(max) + 2n} is beyond the safe-integer range` }]);
});
