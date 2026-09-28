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
    version: 1,
    investmentWindow: { firstWeek: 1, lastWeek: 8 },
    horizonWeeks: 156,
    slotsPerWeek: 5,
    initialCapitalUsd: 1_000_000,
    checkSizeUsd: 200_000,
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
      checkSizeUsd: -200_000,
      initialCapitalUsd: Number.NaN,
    },
    issues: [
      { path: "id", message: 'must be a non-empty string without surrounding spaces, got " "' },
      { path: "version", message: 'must be an integer, got "1"' },
      { path: "horizonWeeks", message: "must be an integer, got 156.5" },
      { path: "initialCapitalUsd", message: "must be an integer, got NaN" },
      { path: "checkSizeUsd", message: "must be at least 1, got -200000" },
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
    name: "max investments cannot be funded by initial capital",
    input: { ...baselineInput(), maxInitialInvestments: 6 },
    issues: [
      {
        path: "maxInitialInvestments",
        message: "6 checks of 200000 need 1200000, more than initialCapitalUsd (1000000)",
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

  defaults["checkSizeUsd"] = 100_000;
  defaults["version"] = 2;
  (defaults["investmentWindow"] as { lastWeek: number }).lastWeek = 12;

  assert.deepEqual(captured, POC_BASELINE_CONFIG);
  assert.ok(Object.isFrozen(captured));
  assert.ok(Object.isFrozen(captured.investmentWindow));
  assert.throws(() => {
    (captured as { slotsPerWeek: number }).slotsPerWeek = 6;
  }, TypeError);

  const rebalanced = captureCampaignConfig(defaults);
  assert.equal(rebalanced.version, 2);
  assert.equal(rebalanced.checkSizeUsd, 100_000);
  assert.equal(captured.checkSizeUsd, 200_000);
});
