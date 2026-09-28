import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createInitialCampaignState } from "../src/campaign/initial-state.ts";
import { POC_BASELINE_CONFIG } from "../src/config/baseline.ts";
import {
  createCampaignManifest,
  ENGINE_VERSIONS,
  type CampaignManifest,
  type ManifestInput,
  type ManifestIssue,
} from "../src/manifest/campaign-manifest.ts";
import { canonicalHash, canonicalJson } from "../src/manifest/canonical-json.ts";

const FIXTURE_URL = new URL("../fixtures/scenarios/technical-empty.json", import.meta.url);
const MANIFEST_MODULE_URL = new URL("../src/manifest/campaign-manifest.ts", import.meta.url);
const SEED = "fixture-seed-1";

function fixtureScenario(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_URL, "utf8")) as Record<string, unknown>;
}

function baselineConfig(): Record<string, unknown> {
  return structuredClone(POC_BASELINE_CONFIG) as unknown as Record<string, unknown>;
}

function build(overrides: Partial<ManifestInput> = {}): CampaignManifest {
  const result = createCampaignManifest({
    seed: SEED,
    scenario: fixtureScenario(),
    config: baselineConfig(),
    ...overrides,
  });
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.issues));
  return result.manifest;
}

function issuesFor(overrides: Partial<ManifestInput>): readonly ManifestIssue[] {
  const result = createCampaignManifest({
    seed: SEED,
    scenario: fixtureScenario(),
    config: baselineConfig(),
    ...overrides,
  });
  assert.equal(result.ok, false, "expected the input to be rejected");
  return result.ok ? [] : result.issues;
}

/** Same data, every object's keys inserted in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseKeys(child)]),
  );
}

test("canonical JSON sorts keys by code unit and has no whitespace", () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, "x"], B: { d: 2, c: 1 } }), '{"B":{"c":1,"d":2},"a":[true,null,"x"],"b":1}');
  assert.equal(canonicalJson({ z: 1, a: 2 }), canonicalJson({ a: 2, z: 1 }));
  // Code-unit order, not locale order: "Z" < "a" < "é".
  assert.equal(canonicalJson({ é: 1, a: 2, Z: 3 }), '{"Z":3,"a":2,"é":1}');
});

test("canonical JSON rejects values JSON cannot represent exactly", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic["self"] = cyclic;
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined, { a: undefined }, new Date(0), new Map(), 1n, cyclic, new Array(2), { list: [1, , 3] }]) {
    assert.throws(() => canonicalJson(bad), TypeError, String(bad));
  }
  // Indexed values are serialized, not whatever an overridden iterator yields.
  const spoofed = [1];
  Object.defineProperty(spoofed, Symbol.iterator, { value: () => [2].values() });
  assert.equal(canonicalJson(spoofed), "[1]");
  // A shared (non-cyclic) reference is fine.
  const shared = { x: 1 };
  assert.equal(canonicalJson([shared, shared]), '[{"x":1},{"x":1}]');
});

test("technical fixture: identical inputs give identical manifest and initial state", () => {
  const first = build();
  const second = build({ scenario: reverseKeys(fixtureScenario()), config: reverseKeys(baselineConfig()) });
  assert.equal(canonicalJson(second), canonicalJson(first));
  assert.deepEqual(second.initialState, createInitialCampaignState(POC_BASELINE_CONFIG));
});

test("technical fixture manifest is pinned", () => {
  // Re-pinned in VI-26 with math v2 and config v2 (money moved from dollars to cents).
  const manifest = build();
  assert.deepEqual(
    { ...manifest, config: undefined, initialState: undefined },
    {
      format: 1,
      campaignId: "cmp-d2bd6e6571e67143",
      seed: SEED,
      scenario: { id: "technical-fixture-empty", contentHash: "sha256:de3bf02e2a9814fb9e6f96614bad51c55d9a1a1ba0ac385628270e5f9fe4924e" },
      versions: { simulation: 1, content: 1, config: 2, rng: 1, math: 2 },
      config: undefined,
      configHash: "sha256:6a46363af32aecdb1a886086b944088c3bcdb1388e10b910717308db9f9c8627",
      initialState: undefined,
      initialStateHash: "sha256:14e583e977939cacbb57dc184c5f5f9b3610fdba3cb53ffe3d9290a4cb87440b",
    },
  );
  assert.deepEqual(manifest.config, POC_BASELINE_CONFIG);
  assert.deepEqual(manifest.initialState, {
    planningWeek: 1,
    completedWeeks: 0,
    slots: { week: 1, remaining: 5 },
    budget: { availableCents: 100_000_000, checksPaid: 0 },
    portfolio: [],
  });
});

test("wall-clock time does not reach the manifest", (t) => {
  const baseline = canonicalJson(build());
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2031, 5, 15, 23, 59, 59) });
  assert.equal(canonicalJson(build()), baseline);
});

test("time zone and locale do not reach the manifest", () => {
  const script = `
    import { readFileSync } from "node:fs";
    import { createCampaignManifest } from ${JSON.stringify(MANIFEST_MODULE_URL.href)};
    import { canonicalJson } from ${JSON.stringify(new URL("../src/manifest/canonical-json.ts", import.meta.url).href)};
    import { POC_BASELINE_CONFIG } from ${JSON.stringify(new URL("../src/config/baseline.ts", import.meta.url).href)};
    const scenario = JSON.parse(readFileSync(new URL(${JSON.stringify(FIXTURE_URL.href)}), "utf8"));
    const result = createCampaignManifest({ seed: ${JSON.stringify(SEED)}, scenario, config: POC_BASELINE_CONFIG });
    process.stdout.write(canonicalJson(result.manifest));
  `;
  const outputs = [
    { TZ: "UTC", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
    { TZ: "Pacific/Kiritimati", LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8" },
  ].map((env) => {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  });
  assert.equal(outputs[0], canonicalJson(build()));
  assert.equal(outputs[1], outputs[0]);
});

test("a different seed is recorded; the Alpha starting state does not depend on it", () => {
  const a = build();
  const b = build({ seed: "fixture-seed-2" });
  assert.equal(b.seed, "fixture-seed-2");
  assert.notEqual(b.campaignId, a.campaignId);
  assert.equal(b.initialStateHash, a.initialStateHash);
});

test("changed configuration is captured even without a version bump", () => {
  const base = build();
  const edited = build({ config: { ...baselineConfig(), checkSizeCents: 10_000_000 } });
  assert.equal(edited.versions.config, 2);
  assert.equal(edited.config.checkSizeCents, 10_000_000);
  assert.notEqual(edited.configHash, base.configHash);
  assert.notEqual(edited.campaignId, base.campaignId);

  const bumped = build({ config: { ...baselineConfig(), version: 3 } });
  assert.equal(bumped.versions.config, 3);
  assert.notEqual(bumped.configHash, base.configHash);

  const slots = build({ config: { ...baselineConfig(), slotsPerWeek: 4 } });
  assert.equal(slots.initialState.slots.remaining, 4);
  assert.notEqual(slots.initialStateHash, base.initialStateHash);
});

test("changed content changes the content hash; its version is recorded", () => {
  const base = build();
  const scenario = fixtureScenario();
  const edited = build({ scenario: { ...scenario, content: { ...(scenario["content"] as object), purpose: "edited" } } });
  assert.notEqual(edited.scenario.contentHash, base.scenario.contentHash);
  assert.equal(edited.versions.content, 1);

  const bumped = build({ scenario: { ...scenario, contentVersion: 2 } });
  assert.equal(bumped.versions.content, 2);
  assert.notEqual(bumped.scenario.contentHash, base.scenario.contentHash);
  assert.equal(base.scenario.contentHash, canonicalHash(fixtureScenario()));
});

test("engine versions come from ENGINE_VERSIONS and are all recorded", () => {
  const manifest = build();
  assert.deepEqual(
    { simulation: manifest.versions.simulation, rng: manifest.versions.rng, math: manifest.versions.math },
    ENGINE_VERSIONS,
  );
  const rng2 = build({ engine: { ...ENGINE_VERSIONS, rng: 2 } });
  assert.equal(rng2.versions.rng, 2);
  assert.notEqual(rng2.campaignId, manifest.campaignId);
});

test("missing scenario metadata or versions fail with the offending field", () => {
  const { id: _id, ...noId } = fixtureScenario();
  const { contentVersion: _cv, ...noVersion } = fixtureScenario();
  const { content: _c, ...noContent } = fixtureScenario();
  const { rng: _rng, ...noRng } = ENGINE_VERSIONS;
  const table: Array<[Partial<ManifestInput>, string]> = [
    [{ scenario: undefined }, "scenario"],
    [{ scenario: noId }, "scenario.id"],
    [{ scenario: { ...fixtureScenario(), id: " spaced " } }, "scenario.id"],
    [{ scenario: noVersion }, "scenario.contentVersion"],
    [{ scenario: { ...fixtureScenario(), contentVersion: 0 } }, "scenario.contentVersion"],
    [{ scenario: noContent }, "scenario.content"],
    [{ scenario: { ...fixtureScenario(), extra: 1 } }, "scenario.extra"],
    [{ scenario: { ...fixtureScenario(), content: { at: new Date(0) } } }, "scenario"],
    [{ engine: noRng }, "engine.rng"],
    [{ engine: { ...ENGINE_VERSIONS, math: 1.5 } }, "engine.math"],
    [{ seed: undefined }, "seed"],
    [{ seed: "" }, "seed"],
    [{ seed: "has space" }, "seed"],
    [{ seed: 42 }, "seed"],
    [{ config: { ...baselineConfig(), version: undefined } }, "config.version"],
    [{ config: undefined }, "config"],
  ];
  for (const [overrides, path] of table) {
    const issues = issuesFor(overrides);
    assert.ok(
      issues.some((issue) => issue.path === path),
      `${path}: got ${JSON.stringify(issues)}`,
    );
  }
});

test("all input problems are reported together", () => {
  const issues = issuesFor({ seed: "", scenario: { id: "x" }, engine: {} });
  const paths = issues.map((issue) => issue.path);
  for (const path of ["seed", "scenario.contentVersion", "scenario.content", "engine.simulation", "engine.rng", "engine.math"]) {
    assert.ok(paths.includes(path), `${path} missing from ${JSON.stringify(paths)}`);
  }
});

test("the manifest is deeply frozen and independent of its inputs", () => {
  const scenario = fixtureScenario();
  const config = baselineConfig();
  const result = createCampaignManifest({ seed: SEED, scenario, config });
  assert.ok(result.ok);
  const before = canonicalJson(result.manifest);
  scenario["id"] = "mutated";
  config["slotsPerWeek"] = 99;
  assert.equal(canonicalJson(result.manifest), before);
  assert.ok(Object.isFrozen(result.manifest));
  assert.ok(Object.isFrozen(result.manifest.config.investmentWindow));
  assert.ok(Object.isFrozen(result.manifest.initialState.slots));
  assert.ok(Object.isFrozen(result.manifest.initialState.portfolio));
});

test("scenario metadata and hash come from one snapshot; getters are rejected", () => {
  let reads = 0;
  const scenario = fixtureScenario();
  Object.defineProperty(scenario, "id", {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? "technical-fixture-empty" : "something-else";
    },
  });
  const content = scenario["content"] as Record<string, unknown>;
  Object.defineProperty(content, "purpose", {
    enumerable: true,
    get() {
      throw new Error("boom");
    },
  });
  const issues = issuesFor({ scenario });
  assert.deepEqual(issues, [
    { path: "scenario.id", message: "must be a data property, not a getter or setter" },
    { path: "scenario.content.purpose", message: "must be a data property, not a getter or setter" },
  ]);
  assert.equal(reads, 0);
});

test("getters in config or engine versions are issues, not exceptions", () => {
  const config = baselineConfig();
  Object.defineProperty(config, "horizonWeeks", {
    enumerable: true,
    get() {
      throw new Error("boom");
    },
  });
  const engine = { ...ENGINE_VERSIONS };
  Object.defineProperty(engine, "math", { enumerable: true, get: () => 2 });
  assert.deepEqual(issuesFor({ config, engine }), [
    { path: "engine.math", message: "must be a data property, not a getter or setter" },
    { path: "config.horizonWeeks", message: "must be a data property, not a getter or setter" },
  ]);
});

test("a scenario hash equals the hash of the same data without getters or prototypes", () => {
  const plain = fixtureScenario();
  const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, plain);
  assert.equal(build({ scenario: nullProto }).scenario.contentHash, build().scenario.contentHash);
});
