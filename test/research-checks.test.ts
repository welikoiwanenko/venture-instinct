// VI-29: research checks in the scenario pack format (docs/design-doc.md §9.1, §9.2,
// §14.1, §5 content budget). Format and validation only; no research action yet.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { canonicalJson, initializeCampaign, viewAsPlayer } from "../src/app/campaign-app.ts";
import { forbiddenQuestionWord } from "../src/content/research-check.ts";
import { validateScenarioPack } from "../src/content/scenario-pack.ts";
import type { ContentIssue } from "../src/content/fields.ts";

const CHECKS = "scenario.content.companies[0].researchChecks";

type Json = Record<string, any>;

function load(path: string): Json {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) as Json;
}

function billingCheck(): Json {
  return {
    id: "chk-fixture-alpha-billing",
    direction: "customers",
    question: "How many teams paid an invoice last month?",
    evidence: { source: "Billing export", period: { fromWeek: -3, toWeek: 0 } },
    result: { kind: "metric", metric: "payingCustomers", value: 4 },
  };
}

/** The minimal pack with `checks` on its only company (truth: 4 paying customers, 2 people). */
function withChecks(...checks: Json[]): Json {
  const pack = load("fixtures/scenarios/minimal-one-company.json");
  pack["content"]["companies"][0]["researchChecks"] = checks;
  return pack;
}

function issuesOf(pack: unknown): readonly ContentIssue[] {
  const result = validateScenarioPack(pack);
  assert.equal(result.ok, false, "expected the pack to be rejected");
  return result.ok ? [] : result.issues;
}

test("a pack with no checks authored still validates", () => {
  const result = validateScenarioPack(load("fixtures/scenarios/minimal-one-company.json"));
  assert.ok(result.ok);
  assert.deepEqual(result.pack.content.companies[0]!.researchChecks, []);
});

test("a check with each result kind validates and keeps its fields", () => {
  const pack = withChecks(
    billingCheck(),
    {
      id: "chk-fixture-alpha-team",
      direction: "team",
      question: "Who wrote the first version of the product?",
      evidence: { source: "Public commit history", period: { fromWeek: -52, toWeek: 0 } },
      result: { kind: "text", title: "Both founders wrote the core", text: "The commit history shows both founders working on the core." },
    },
    {
      id: "chk-fixture-alpha-retention",
      direction: "growth-quality",
      question: "Do teams come back after their first month?",
      evidence: { source: "Usage analytics", period: { fromWeek: -8, toWeek: 0 } },
      result: { kind: "unavailable", reason: "The company only started collecting usage data last week." },
    },
    {
      id: "chk-fixture-alpha-team-size",
      direction: "team",
      question: "How many people are on the payroll?",
      evidence: { source: "An old public profile", period: { fromWeek: -20, toWeek: -20 } },
      result: {
        kind: "metric",
        metric: "teamSize",
        value: 1,
        distortion: { reason: "outdated-public-source", note: "The profile was written before the second engineer joined." },
      },
    },
  );
  const result = validateScenarioPack(pack);
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues));
  const checks = result.pack.content.companies[0]!.researchChecks;
  assert.deepEqual(
    checks.map((c) => [c.id, c.direction, c.result.kind]),
    [
      ["chk-fixture-alpha-billing", "customers", "metric"],
      ["chk-fixture-alpha-team", "team", "text"],
      ["chk-fixture-alpha-retention", "growth-quality", "unavailable"],
      ["chk-fixture-alpha-team-size", "team", "metric"],
    ],
  );
  assert.deepEqual(checks[0]!.evidence, { source: "Billing export", period: { fromWeek: -3, toWeek: 0 } });
});

test("invalid fixtures fail with check-specific errors", () => {
  const table: Array<[string, ContentIssue[]]> = [
    [
      "fixtures/scenarios/invalid/duplicate-check-id.json",
      [
        {
          path: `${CHECKS}[1].id`,
          message: `duplicates research check id "chk-fixture-alpha-billing" first used at ${CHECKS}[0].id`,
        },
      ],
    ],
    [
      "fixtures/scenarios/invalid/check-unexplained-gap.json",
      [{ path: `${CHECKS}[0].result.distortion`, message: "is required: the claim states 6 but the hidden state is 4 (§14.1)" }],
    ],
    [
      "fixtures/scenarios/invalid/check-unknown-direction.json",
      [{ path: `${CHECKS}[0].direction`, message: 'must be one of growth-quality, customers, team, product; got "market-size"' }],
    ],
    [
      "fixtures/scenarios/invalid/check-forbidden-question.json",
      [
        {
          path: `${CHECKS}[0].question`,
          message: 'must not contain "lying": a question may not reveal hidden truth or a verdict by its name (§9.3)',
        },
      ],
    ],
  ];
  for (const [path, expected] of table) {
    assert.deepEqual(issuesOf(load(path)), expected, path);
    assert.equal(initializeCampaign({ seed: "demo-1", scenario: load(path) }).ok, false, path);
  }
});

test("check ids are unique across the whole pack", () => {
  const pack = withChecks(billingCheck());
  const second = structuredClone(pack["content"]["companies"][0]);
  second["id"] = "co-fixture-beta";
  second["founders"][0]["id"] = "fd-fixture-beta-1";
  second["application"]["authorId"] = "fd-fixture-beta-1";
  pack["content"]["companies"].push(second);
  assert.deepEqual(issuesOf(pack), [
    {
      path: "scenario.content.companies[1].researchChecks[0].id",
      message: `duplicates research check id "chk-fixture-alpha-billing" first used at ${CHECKS}[0].id`,
    },
  ]);
});

test("a figure that matches the truth may not carry a distortion", () => {
  const check = billingCheck();
  check["result"]["distortion"] = { reason: "honest-mistake", note: "none" };
  assert.deepEqual(issuesOf(withChecks(check)), [
    { path: `${CHECKS}[0].result.distortion`, message: "must be absent: the claim matches the hidden state (4)" },
  ]);
});

test("shape, period and content budget are enforced with paths", () => {
  const long = Array.from({ length: 121 }, () => "слово").join(" ");
  const table: Array<[(c: Json) => void, string, RegExp]> = [
    [(c) => (c["result"] = { kind: "text", title: "Long", text: long }), "result.text", /at most 120 words \(§5 content budget\), got 121/],
    [(c) => (c["result"] = { kind: "unavailable", reason: long }), "result.reason", /at most 120 words/],
    [(c) => (c["question"] = Array.from({ length: 31 }, () => "why").join(" ")), "question", /at most 30 words/],
    [(c) => (c["evidence"]["period"] = { fromWeek: 0, toWeek: 1 }), "evidence.period.toWeek", /must not be after week 0/],
    [(c) => (c["result"] = { kind: "rumour", text: "x" }), "result.kind", /must be one of metric, text, unavailable/],
    [(c) => (c["result"]["metric"] = "valuation"), "result.metric", /must be one of payingCustomers/],
    [(c) => (c["id"] = "Billing Check"), "id", /lower-case kebab-case id/],
    [(c) => delete c["evidence"]["source"], "evidence.source", /is required/],
    [(c) => (c["answer"] = 4), "answer", /is not a known field/],
  ];
  for (const [change, field, message] of table) {
    const check = billingCheck();
    change(check);
    const issues = issuesOf(withChecks(check));
    assert.deepEqual(issues.map((i) => i.path), [`${CHECKS}[0].${field}`], field);
    assert.match(issues[0]?.message ?? "", message, field);
  }
  const notAList = load("fixtures/scenarios/minimal-one-company.json");
  notAList["content"]["companies"][0]["researchChecks"] = { id: "x" };
  assert.deepEqual(issuesOf(notAList).map((i) => i.path), [CHECKS]);
});

test("questions may not reveal hidden truth or a verdict, in English or Ukrainian", () => {
  for (const text of [
    "Is the founder lying about revenue?",
    "What is the true quality of the team?",
    "Чи бреше засновник про клієнтів?",
    "Чи не обманюють нас щодо витрат?",
    "Яка якість продукту?",
    "Чи є приховані витрати?",
    "Хто переможець у цьому секторі?",
  ]) {
    assert.ok(forbiddenQuestionWord(text) !== undefined, text);
  }
  for (const text of [
    "Скільки команд справді платили за останній місяць?",
    "Хто виконував ключову роботу в минулому проєкті?",
    "Who comes back after the first use?",
    "Is there a dependence on one customer?",
  ]) {
    assert.equal(forbiddenQuestionWord(text), undefined, text);
  }
});

test("the content hash covers checks, so changing a check changes the manifest", () => {
  const plain = initializeCampaign({ seed: "demo-1", scenario: withChecks(billingCheck()) });
  const edited = billingCheck();
  edited["question"] = "How many teams paid last month?";
  const changed = initializeCampaign({ seed: "demo-1", scenario: withChecks(edited) });
  const none = initializeCampaign({ seed: "demo-1", scenario: withChecks() });
  assert.ok(plain.ok && changed.ok && none.ok);
  assert.notEqual(plain.campaign.manifest.scenario.contentHash, changed.campaign.manifest.scenario.contentHash);
  assert.notEqual(plain.campaign.id, changed.campaign.id);
  assert.notEqual(plain.campaign.manifest.scenario.contentHash, none.campaign.manifest.scenario.contentHash);
});

test("undelivered checks are not in the player view", () => {
  const check = billingCheck();
  check["result"] = { kind: "text", title: "SECRET-TITLE", text: "SECRET-TEXT" };
  check["question"] = "SECRET-QUESTION about invoices?";
  check["evidence"]["source"] = "SECRET-SOURCE";
  const result = initializeCampaign({ seed: "demo-1", scenario: withChecks(check) });
  assert.ok(result.ok);
  const json = canonicalJson(viewAsPlayer(result.campaign));
  for (const secret of ["SECRET", "chk-fixture-alpha-billing", "researchChecks"]) {
    assert.ok(!json.includes(secret), `${secret} is in the player view`);
  }
});
