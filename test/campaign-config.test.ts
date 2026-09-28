import assert from "node:assert/strict";
import { test } from "node:test";

import { POC_BASELINE_CONFIG } from "../src/config/baseline.ts";
import {
  captureCampaignConfig,
  InvalidCampaignConfigError,
  validateCampaignConfig,
  type ConfigIssue,
} from "../src/config/campaign-config.ts";

function baselineInput(): Record<string, unknown> {
  return structuredClone(POC_BASELINE_CONFIG) as unknown as Record<string, unknown>;
}

function issuesFor(input: unknown): readonly ConfigIssue[] {
  const result = validateCampaignConfig(input);
  assert.equal(result.ok, false, "expected the fixture to be rejected");
  return result.ok ? [] : result.issues;
}

test("baseline matches the PoC 0.1 starting configuration (design §5)", () => {
  assert.deepEqual(POC_BASELINE_CONFIG, {
    id: "poc-0.1-baseline",
    version: 2,
    investmentWindow: { firstWeek: 1, lastWeek: 8 },
    horizonWeeks: 156,
    slotsPerWeek: 5,
    initialCapitalCents: 100_000_000,
    checkSizeCents: 20_000_000,
    maxInitialInvestments: 5,
  });
  assert.equal(validateCampaignConfig(baselineInput()).ok, true);
});

const invalidFixtures: ReadonlyArray<{ name: string; input: unknown; issues: ConfigIssue[] }> = [
  {
    name: "not an object",
    input: [1, 2],
    issues: [{ path: "", message: "must be an object, got array" }],
  },
  {
    name: "missing required values",
    input: { ...baselineInput(), id: undefined, slotsPerWeek: undefined, investmentWindow: { firstWeek: 1 } },
    issues: [
      { path: "id", message: "is required" },
      { path: "investmentWindow.lastWeek", message: "is required" },
      { path: "slotsPerWeek", message: "is required" },
    ],
  },
  {
    name: "malformed values",
    input: {
      ...baselineInput(),
      id: " ",
      version: "1",
      horizonWeeks: 156.5,
      checkSizeCents: -20_000_000,
      initialCapitalCents: Number.NaN,
    },
    issues: [
      { path: "id", message: 'must be a non-empty string without surrounding spaces, got " "' },
      { path: "version", message: 'must be an integer, got "1"' },
      { path: "horizonWeeks", message: "must be an integer, got 156.5" },
      { path: "initialCapitalCents", message: "must be an integer, got NaN" },
      { path: "checkSizeCents", message: "must be at least 1, got -20000000" },
    ],
  },
  {
    name: "unknown settings (typos)",
    input: { ...baselineInput(), slotPerWeek: 6, investmentWindow: { firstWeek: 1, lastWeek: 8, end: 9 } },
    issues: [
      { path: "slotPerWeek", message: "is not a known setting" },
      { path: "investmentWindow.end", message: "is not a known setting" },
    ],
  },
  {
    name: "investment window ends before it starts",
    input: { ...baselineInput(), investmentWindow: { firstWeek: 5, lastWeek: 4 } },
    issues: [{ path: "investmentWindow.lastWeek", message: "must not be before investmentWindow.firstWeek (5), got 4" }],
  },
  {
    name: "investment window extends past the horizon",
    input: { ...baselineInput(), horizonWeeks: 6 },
    issues: [{ path: "investmentWindow.lastWeek", message: "must not be after horizonWeeks (6), got 8" }],
  },
  {
    name: "horizon issue is still reported when firstWeek is missing",
    input: { ...baselineInput(), investmentWindow: { lastWeek: 8 }, horizonWeeks: 6 },
    issues: [
      { path: "investmentWindow.firstWeek", message: "is required" },
      { path: "investmentWindow.lastWeek", message: "must not be after horizonWeeks (6), got 8" },
    ],
  },
  {
    name: "max investments cannot be funded by initial capital",
    input: { ...baselineInput(), maxInitialInvestments: 6 },
    issues: [
      {
        path: "maxInitialInvestments",
        message: "6 checks of 20000000 need 120000000, more than initialCapitalCents (100000000)",
      },
    ],
  },
  {
    name: "full deployment overflows the safe-integer range",
    input: { ...baselineInput(), checkSizeCents: Number.MAX_SAFE_INTEGER, maxInitialInvestments: 2 },
    issues: [
      {
        path: "maxInitialInvestments",
        message: `2 checks of ${Number.MAX_SAFE_INTEGER} need ${Number.MAX_SAFE_INTEGER * 2}, more than initialCapitalCents (100000000)`,
      },
    ],
  },
];

for (const fixture of invalidFixtures) {
  test(`rejects invalid fixture: ${fixture.name}`, () => {
    assert.deepEqual(issuesFor(fixture.input), fixture.issues);
  });
}

test("capture rejects invalid input with every field-specific issue", () => {
  assert.throws(
    () => captureCampaignConfig({ ...baselineInput(), version: 0, slotsPerWeek: undefined }),
    (error: unknown) =>
      error instanceof InvalidCampaignConfigError &&
      error.message.includes("version: must be at least 1, got 0") &&
      error.message.includes("slotsPerWeek: is required"),
  );
});

test("captured config stays unchanged when defaults change afterwards", () => {
  const defaults = baselineInput();
  const captured = captureCampaignConfig(defaults);

  defaults["checkSizeCents"] = 10_000_000;
  defaults["version"] = 3;
  (defaults["investmentWindow"] as { lastWeek: number }).lastWeek = 12;

  assert.deepEqual(captured, POC_BASELINE_CONFIG);
  assert.ok(Object.isFrozen(captured));
  assert.ok(Object.isFrozen(captured.investmentWindow));
  assert.throws(() => {
    (captured as { slotsPerWeek: number }).slotsPerWeek = 6;
  }, TypeError);

  const rebalanced = captureCampaignConfig(defaults);
  assert.equal(rebalanced.version, 3);
  assert.equal(rebalanced.checkSizeCents, 10_000_000);
  assert.equal(captured.checkSizeCents, 20_000_000);
});

test("getters are reported as issues and never called", () => {
  let calls = 0;
  const input = baselineInput();
  Object.defineProperty(input, "slotsPerWeek", {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error("boom");
    },
  });
  const window = input["investmentWindow"] as Record<string, unknown>;
  Object.defineProperty(window, "lastWeek", { enumerable: true, get: () => 8 });

  const result = validateCampaignConfig(input);
  assert.deepEqual(result, {
    ok: false,
    issues: [
      { path: "investmentWindow.lastWeek", message: "must be a data property, not a getter or setter" },
      { path: "slotsPerWeek", message: "must be a data property, not a getter or setter" },
    ],
  });
  assert.throws(() => captureCampaignConfig(input), InvalidCampaignConfigError);
  assert.equal(calls, 0);
});

test("a getter does not hide independent issues in other fields", () => {
  const input = { ...baselineInput(), slotsPerWeek: 0, maxInitialInvestments: 6 };
  Object.defineProperty(input, "id", { enumerable: true, get: () => "poc-0.1-baseline" });
  assert.deepEqual(issuesFor(input), [
    { path: "id", message: "must be a data property, not a getter or setter" },
    { path: "slotsPerWeek", message: "must be at least 1, got 0" },
    {
      path: "maxInitialInvestments",
      message: "6 checks of 20000000 need 120000000, more than initialCapitalCents (100000000)",
    },
  ]);
});

test("a throwing proxy is reported as an issue, not an exception, whatever it throws", () => {
  const throwing = (thrown: () => unknown) =>
    new Proxy(baselineInput(), {
      ownKeys() {
        throw thrown();
      },
    });
  const unreadable = "cannot be read: an unreadable value was thrown";
  const table: Array<[() => unknown, string]> = [
    [() => new Error("trap"), "cannot be read: trap"],
    [() => "plain string", "cannot be read: plain string"],
    [() => Object.create(null), unreadable],
    [
      () => ({
        toString() {
          throw new Error("nested");
        },
      }),
      unreadable,
    ],
    [
      () => {
        const error = new Error("hidden");
        Object.defineProperty(error, "message", {
          get() {
            throw new Error("nested");
          },
        });
        return error;
      },
      unreadable,
    ],
  ];
  for (const [thrown, message] of table) {
    assert.deepEqual(issuesFor(throwing(thrown)), [{ path: "", message }]);
  }
});

test("values inherited from Object.prototype are not read as settings", () => {
  const { slotsPerWeek: _slots, ...input } = baselineInput();
  const proto = Object.prototype as Record<string, unknown>;
  proto["slotsPerWeek"] = 5;
  try {
    assert.deepEqual(issuesFor(input), [{ path: "slotsPerWeek", message: "is required" }]);
  } finally {
    delete proto["slotsPerWeek"];
  }
});
