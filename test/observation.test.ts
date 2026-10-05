import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { validateScenarioPack } from "../src/content/scenario-pack.ts";
import { canonicalJson } from "../src/manifest/canonical-json.ts";
import {
  appendObservation,
  appendObservations,
  EMPTY_OBSERVATION_LOG,
  provenanceOf,
  type ObservationLog,
} from "../src/knowledge/observation.ts";
import { compareObservations, STALE_AFTER_WEEKS, verificationStatus } from "../src/knowledge/verification.ts";

const COMPANY = "co-fixture-alpha";

/** The founder's application: text, then a customer count that includes free pilots. */
const APPLICATION = {
  observation: {
    observationId: "obs-alpha-application",
    companyId: COMPANY,
    source: { kind: "founder", author: "fd-fixture-alpha-1" },
    receivedWeek: 1,
    period: { fromWeek: 0, toWeek: 0 },
    content: { kind: "text", title: "Application", text: "We help teams ship faster." },
    references: [],
  },
};

const CLAIM = {
  observation: {
    observationId: "obs-alpha-claim-customers",
    companyId: COMPANY,
    source: { kind: "founder", author: "fd-fixture-alpha-1" },
    receivedWeek: 1,
    period: { fromWeek: 0, toWeek: 0 },
    content: { kind: "metric", metric: "payingCustomers", value: 12 },
    references: ["obs-alpha-application"],
  },
  provenance: {
    fact: { value: 4 },
    distortion: { reason: "counts-pilots-as-paying", note: "8 of the 12 are free pilots" },
  },
};

const CHECK = {
  observation: {
    observationId: "obs-alpha-check-customers",
    companyId: COMPANY,
    source: { kind: "check", author: "customer research" },
    receivedWeek: 3,
    period: { fromWeek: 0, toWeek: 2 },
    content: { kind: "metric", metric: "payingCustomers", value: 4 },
    references: ["obs-alpha-claim-customers"],
  },
  provenance: { fact: { value: 4 } },
};

function logOf(...entries: Array<{ observation: unknown; provenance?: unknown }>): ObservationLog {
  const result = appendObservations(EMPTY_OBSERVATION_LOG, entries);
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues));
  return result.log;
}

function issuesOf(log: ObservationLog, entry: { observation: unknown; provenance?: unknown }): string[] {
  const result = appendObservation(log, entry);
  assert.equal(result.ok, false);
  return result.ok ? [] : result.issues.map((i) => `${i.path}: ${i.message}`);
}

function without(key: string): { observation: unknown; provenance?: unknown } {
  const copy = structuredClone(CLAIM) as { observation: Record<string, unknown>; provenance: unknown };
  delete copy.observation[key];
  return copy;
}

test("an observation without a source, company or period is rejected", () => {
  const log = logOf(APPLICATION);
  assert.deepEqual(issuesOf(log, without("source")), ["observation.source: is required"]);
  assert.deepEqual(issuesOf(log, without("companyId")), ["observation.companyId: is required"]);
  assert.deepEqual(issuesOf(log, without("period")), ["observation.period: is required"]);
  assert.deepEqual(issuesOf(log, without("receivedWeek")), ["observation.receivedWeek: is required"]);
  const noAuthor = structuredClone(CLAIM);
  (noAuthor.observation.source as Record<string, unknown>)["author"] = " ";
  assert.match(issuesOf(log, noAuthor).join(), /observation\.source\.author: must be a non-empty string/);
});

test("periods, values and references are checked", () => {
  const log = logOf(APPLICATION);
  const future = structuredClone(CLAIM);
  future.observation.period = { fromWeek: 0, toWeek: 2 };
  assert.deepEqual(issuesOf(log, future), [
    "observation.period.toWeek: must not be after receivedWeek (1): nobody reports on the future, got 2",
  ]);
  const backwards = structuredClone(CLAIM);
  backwards.observation.period = { fromWeek: 0, toWeek: -1 };
  assert.deepEqual(issuesOf(log, backwards), ["observation.period.toWeek: must not be before fromWeek (0), got -1"]);
  const fractional = structuredClone(CLAIM);
  fractional.observation.content.value = 1.5;
  assert.match(issuesOf(log, fractional).join(), /content\.value: must be a whole number of customers/);
  const dangling = structuredClone(CLAIM);
  dangling.observation.references = ["obs-missing"];
  assert.deepEqual(issuesOf(log, dangling), [
    'observation.references[0]: must be the id of an earlier stored observation, got "obs-missing"',
  ]);
  const unknownMetric = structuredClone(CLAIM);
  (unknownMetric.observation.content as Record<string, unknown>)["metric"] = "happiness";
  assert.match(issuesOf(log, unknownMetric).join(), /content\.metric: must be one of/);
});

test("a claim may differ from the hidden truth, which stays unchanged", () => {
  const pack = validateScenarioPack(JSON.parse(readFileSync(new URL("../fixtures/scenarios/minimal-one-company.json", import.meta.url), "utf8")));
  assert.ok(pack.ok);
  const hiddenBefore = canonicalJson(pack.pack);
  const log = logOf(APPLICATION, CLAIM);
  const stored = log.observations[1];
  assert.equal(stored?.content.kind === "metric" ? stored.content.value : undefined, 12);
  assert.equal(pack.pack.content.companies[0]?.hidden.payingCustomers, 4);
  assert.equal(provenanceOf(log, "obs-alpha-claim-customers")?.fact?.value, 4);
  assert.equal(canonicalJson(pack.pack), hiddenBefore);
});

test("a gap between claim and fact needs a structured reason, and only a gap has one", () => {
  const log = logOf(APPLICATION);
  const noReason = structuredClone(CLAIM) as { observation: unknown; provenance: Record<string, unknown> };
  delete noReason.provenance["distortion"];
  assert.deepEqual(issuesOf(log, noReason), [
    "provenance.distortion: is required: the claim states 12 but the fact is 4 (§14.1)",
  ]);
  const needless = structuredClone(CHECK) as { observation: Record<string, unknown>; provenance: Record<string, unknown> };
  needless.observation["references"] = [];
  needless.provenance["distortion"] = { reason: "honest-mistake", note: "none really" };
  assert.deepEqual(issuesOf(log, needless), ["provenance.distortion: must be absent: the claim matches the fact (4)"]);
  const noFact = structuredClone(CHECK) as { observation: Record<string, unknown>; provenance: Record<string, unknown> };
  noFact.observation["references"] = [];
  delete noFact.provenance["fact"];
  assert.deepEqual(issuesOf(log, noFact), ["provenance.fact: is required"]);
  assert.deepEqual(issuesOf(EMPTY_OBSERVATION_LOG, { ...APPLICATION, provenance: { fact: { value: 1 } } }), [
    "provenance.fact: only a metric observation has a fact value",
  ]);
});

test("stored observations cannot be modified; a newer one is added beside them", () => {
  const first = logOf(APPLICATION, CLAIM);
  const claim = first.observations[1]!;
  assert.throws(() => {
    (claim as { receivedWeek: number }).receivedWeek = 5;
  }, TypeError);
  assert.throws(() => {
    (claim.content as { value: number }).value = 4;
  }, TypeError);
  assert.throws(() => {
    (first.observations as unknown[]).push(claim);
  }, TypeError);
  assert.throws(() => {
    (provenanceOf(first, claim.observationId)!.fact as { value: number }).value = 12;
  }, TypeError);

  const replaced = structuredClone(CLAIM);
  replaced.observation.content.value = 4;
  assert.match(issuesOf(first, replaced).join(), /"obs-alpha-claim-customers" is already stored; stored observations never change/);

  const next = appendObservation(first, CHECK);
  assert.ok(next.ok);
  assert.deepEqual(
    next.log.observations.map((o) => o.observationId),
    ["obs-alpha-application", "obs-alpha-claim-customers", "obs-alpha-check-customers"],
  );
  assert.equal(first.observations.length, 2, "the earlier log is untouched");
  assert.equal(next.log.observations[1], claim, "the stored claim is the same object");
});

test("appending several entries stores all of them or none", () => {
  const broken = structuredClone(CHECK);
  broken.observation.period = { fromWeek: 0, toWeek: 9 };
  const result = appendObservations(EMPTY_OBSERVATION_LOG, [APPLICATION, CLAIM, broken]);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.issues[0]?.path ?? "", /^\[2\]\.observation\.period\.toWeek$/);
});

test("the player-facing form carries none of the internal fields", () => {
  const log = logOf(APPLICATION, CLAIM, CHECK);
  const json = canonicalJson(log.observations);
  for (const internal of ["fact", "distortion", "reason", "note", "counts-pilots-as-paying", "free pilots", "provenance"]) {
    assert.ok(!json.includes(internal), `${internal} leaked: ${json}`);
  }
  assert.deepEqual(Object.keys(log.observations[1]!).sort(), [
    "companyId",
    "content",
    "observationId",
    "period",
    "receivedWeek",
    "references",
    "source",
  ]);
  // The internal half is its own record, linked by id.
  assert.deepEqual(provenanceOf(log, "obs-alpha-claim-customers"), {
    observationId: "obs-alpha-claim-customers",
    fact: { value: 4 },
    distortion: { reason: "counts-pilots-as-paying", note: "8 of the 12 are free pilots" },
  });
});

test("statuses: a claim, then a check that contradicts it, then staleness", () => {
  const claimOnly = logOf(APPLICATION, CLAIM);
  const claim = claimOnly.observations[1]!;
  assert.equal(verificationStatus(claim, claimOnly.observations, 1), "founder-claim");

  const withCheck = logOf(APPLICATION, CLAIM, CHECK);
  const check = withCheck.observations[2]!;
  assert.equal(verificationStatus(claim, withCheck.observations, 3), "conflicting-evidence");
  assert.equal(verificationStatus(check, withCheck.observations, 3), "confirmed-by-check");
  // Stored records did not change; the status is a reading of the log.
  assert.deepEqual(claimOnly.observations[1], withCheck.observations[1]);

  assert.equal(verificationStatus(check, withCheck.observations, 2 + STALE_AFTER_WEEKS), "confirmed-by-check");
  assert.equal(verificationStatus(check, withCheck.observations, 3 + STALE_AFTER_WEEKS), "stale-period");

  const publicSource = logOf({
    observation: { ...CHECK.observation, observationId: "obs-alpha-press", source: { kind: "public", author: "tech blog" }, references: [] },
    provenance: { fact: { value: 4 } },
  });
  assert.equal(verificationStatus(publicSource.observations[0]!, publicSource.observations, 3), "public-source");
  assert.equal(verificationStatus(withCheck.observations[0]!, withCheck.observations, 3), "founder-claim", "text has no conflicts");
});

test("two checks that disagree are both conflicting evidence", () => {
  const second = structuredClone(CHECK);
  second.observation.observationId = "obs-alpha-check-2";
  second.observation.content.value = 6;
  second.provenance = { fact: { value: 4 }, distortion: { reason: "honest-mistake", note: "counted a churned customer" } } as never;
  const log = logOf(APPLICATION, CLAIM, CHECK, second);
  assert.equal(verificationStatus(log.observations[2]!, log.observations, 3), "conflicting-evidence");
  assert.equal(verificationStatus(log.observations[3]!, log.observations, 3), "conflicting-evidence");
});

test("comparing two figures gives their difference and whether the periods overlap", () => {
  const log = logOf(APPLICATION, CLAIM, CHECK);
  const [, claim, check] = log.observations as [unknown, (typeof log.observations)[number], (typeof log.observations)[number]];
  const comparison = compareObservations(check, claim);
  assert.deepEqual(comparison, {
    companyId: COMPANY,
    metric: "payingCustomers",
    difference: -8,
    samePeriod: true,
  });
  assert.deepEqual(compareObservations(claim, check), comparison, "argument order does not matter");
  assert.throws(() => compareObservations(claim, log.observations[0]!), /only metric observations/);
  const other = logOf(APPLICATION, {
    observation: { ...CLAIM.observation, observationId: "obs-alpha-cash", content: { kind: "metric", metric: "cashCents", value: 1 } },
    provenance: { fact: { value: 1 } },
  });
  assert.throws(() => compareObservations(claim, other.observations[1]!), /same company and metric only/);
});
