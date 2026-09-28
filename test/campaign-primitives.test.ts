import assert from "node:assert/strict";
import { test } from "node:test";

import { POC_BASELINE_CONFIG as config } from "../src/config/baseline.ts";
import { captureCampaignConfig } from "../src/config/campaign-config.ts";
import {
  openingInvestmentBudget,
  payInitialCheck,
  type InvestmentBudget,
} from "../src/campaign/investment-budget.ts";
import { addUsd, assertNonNegativeUsd, subtractUsd } from "../src/campaign/money.ts";
import { openWeekSlots, spendSlots } from "../src/campaign/slots.ts";
import { assertWeek, isInvestmentWeek } from "../src/campaign/week.ts";

test("investment window is inclusive: weeks 1 and 8 open, 9 and later closed", () => {
  const table: Array<[number, boolean]> = [
    [1, true],
    [8, true],
    [9, false],
    [156, false],
  ];
  for (const [week, open] of table) {
    assert.equal(isInvestmentWeek(week, config), open, `week ${week}`);
  }
});

test("weeks must be integers within 1..horizonWeeks", () => {
  assertWeek(1, config);
  assertWeek(156, config);
  for (const bad of [0, 157, -1]) {
    assert.throws(() => assertWeek(bad, config), RangeError, `week ${bad}`);
  }
  for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", undefined]) {
    assert.throws(() => assertWeek(bad, config), TypeError, `week ${String(bad)}`);
  }
  assert.throws(() => isInvestmentWeek(0, config), RangeError);
  assert.throws(() => openWeekSlots(8.5, config), TypeError);
});

test("slots: exact capacity succeeds, one over fails without mutation", () => {
  const week = openWeekSlots(4, config);
  assert.deepEqual(week, { week: 4, remaining: 5 });

  const all = spendSlots(week, 5);
  assert.deepEqual(all, { ok: true, balance: { week: 4, remaining: 0 } });

  const over = spendSlots(week, 6);
  assert.equal(over.ok, false);
  assert.deepEqual(week, { week: 4, remaining: 5 });

  // §6.3: two research (1), interview (2), scout (1) fill the week.
  let balance = week;
  for (const cost of [1, 1, 2, 1]) {
    const result = spendSlots(balance, cost);
    assert.ok(result.ok);
    balance = result.balance;
  }
  assert.equal(balance.remaining, 0);
  const help = spendSlots(balance, 2);
  assert.equal(help.ok, false);
  assert.equal(balance.remaining, 0);
  assert.deepEqual(spendSlots(balance, 0), { ok: true, balance: { week: 4, remaining: 0 } });
});

test("slot costs must be non-negative integers", () => {
  const week = openWeekSlots(1, config);
  for (const bad of [-1, 1.5, Number.NaN]) {
    assert.throws(() => spendSlots(week, bad), RangeError, `cost ${bad}`);
  }
  assert.deepEqual(week, { week: 1, remaining: 5 });
});

test("unused slots do not carry over into a new week", () => {
  const spent = spendSlots(openWeekSlots(2, config), 1);
  assert.ok(spent.ok);
  assert.equal(spent.balance.remaining, 4);
  assert.equal(openWeekSlots(3, config).remaining, 5);
});

test("slot capacity comes from the captured config", () => {
  const six = captureCampaignConfig({ ...structuredClone(config), id: "six-slots", slotsPerWeek: 6 });
  assert.equal(openWeekSlots(1, six).remaining, 6);
});

test("money arithmetic is exact in whole dollars", () => {
  assert.equal(addUsd(999_999, 1), 1_000_000);
  assert.equal(subtractUsd(1_000_000, 1_000_000), 0);
  let remaining = 1_000_000;
  for (let i = 0; i < 5; i += 1) remaining = subtractUsd(remaining, 200_000);
  assert.equal(remaining, 0);
  assert.throws(() => addUsd(0.1, 0.2), TypeError);
  assert.throws(() => addUsd(Number.MAX_SAFE_INTEGER, 1), TypeError);
  assert.throws(() => subtractUsd(Number.MIN_SAFE_INTEGER, 1), TypeError);
});

test("company cash may go negative; only the player budget has a floor", () => {
  // Company cash (distressed rules come later) uses plain signed Usd arithmetic.
  assert.equal(subtractUsd(50_000, 80_000), -30_000);
  assert.throws(() => assertNonNegativeUsd(-1, "availableUsd"), RangeError);
});

test("$1,000,000 funds exactly five $200,000 checks; a sixth is unaffordable", () => {
  let budget = openingInvestmentBudget(config);
  assert.deepEqual(budget, { availableUsd: 1_000_000, checksPaid: 0 });
  for (let i = 1; i <= 5; i += 1) {
    const result = payInitialCheck(budget, config);
    assert.ok(result.ok, `check ${i}`);
    budget = result.budget;
  }
  assert.deepEqual(budget, { availableUsd: 0, checksPaid: 5 });

  const sixth = payInitialCheck(budget, config);
  assert.equal(sixth.ok, false);
  assert.match(sixth.ok ? "" : sixth.reason, /exceeds the available 0/);
  assert.deepEqual(budget, { availableUsd: 0, checksPaid: 5 });
});

test("a check larger than the remaining budget fails without mutation", () => {
  const budget: InvestmentBudget = { availableUsd: 199_999, checksPaid: 0 };
  const result = payInitialCheck(budget, config);
  assert.equal(result.ok, false);
  assert.deepEqual(budget, { availableUsd: 199_999, checksPaid: 0 });
  const exact = payInitialCheck({ availableUsd: 200_000, checksPaid: 4 }, config);
  assert.deepEqual(exact, { ok: true, budget: { availableUsd: 0, checksPaid: 5 } });
});

test("the investment count limit applies even when money remains", () => {
  const rich = captureCampaignConfig({ ...structuredClone(config), id: "rich", initialCapitalUsd: 2_000_000 });
  const budget: InvestmentBudget = { availableUsd: 1_000_000, checksPaid: 5 };
  const result = payInitialCheck(budget, rich);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /all 5 initial investments are used/);
  assert.deepEqual(budget, { availableUsd: 1_000_000, checksPaid: 5 });
});

test("a malformed budget is rejected as invalid input", () => {
  assert.throws(() => payInitialCheck({ availableUsd: -1, checksPaid: 0 }, config), RangeError);
  assert.throws(() => payInitialCheck({ availableUsd: 0.5, checksPaid: 0 }, config), TypeError);
  assert.throws(() => payInitialCheck({ availableUsd: 0, checksPaid: 1.5 }, config), RangeError);
});
