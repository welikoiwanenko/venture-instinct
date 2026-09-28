import assert from "node:assert/strict";
import { test } from "node:test";

import { POC_BASELINE_CONFIG as config } from "../src/config/baseline.ts";
import { captureCampaignConfig } from "../src/config/campaign-config.ts";
import {
  openingInvestmentBudget,
  payInitialCheck,
  type InvestmentBudget,
} from "../src/campaign/investment-budget.ts";
import { addCents, assertNonNegativeCents, dollarsToCents, subtractCents } from "../src/campaign/money.ts";
import {
  assertBasisPoints,
  BASIS_POINTS_WHOLE,
  diluteShare,
  postMoneyCents,
  shareForInvestment,
  shareOfCents,
} from "../src/campaign/shares.ts";
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

test("a malformed slot balance is rejected as invalid input", () => {
  for (const remaining of [Number.NaN, -1, 2.5]) {
    assert.throws(() => spendSlots({ week: 4, remaining }, 1), RangeError, `remaining ${remaining}`);
  }
  for (const week of [Number.NaN, 0, -2, 1.5]) {
    assert.throws(() => spendSlots({ week, remaining: 5 }, 1), RangeError, `week ${week}`);
  }
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

test("money arithmetic is exact in whole cents", () => {
  // $12.50 is representable exactly; $0.10 + $0.20 is exactly $0.30.
  assert.equal(addCents(1000, 250), 1250);
  assert.equal(addCents(10, 20), 30);
  assert.equal(addCents(99_999_999, 1), 100_000_000);
  assert.equal(subtractCents(100_000_000, 100_000_000), 0);
  let remaining = 100_000_000;
  for (let i = 0; i < 5; i += 1) remaining = subtractCents(remaining, 20_000_000);
  assert.equal(remaining, 0);
  assert.throws(() => addCents(0.1, 0.2), TypeError);
  assert.throws(() => addCents(Number.MAX_SAFE_INTEGER, 1), TypeError);
  assert.throws(() => subtractCents(Number.MIN_SAFE_INTEGER, 1), TypeError);
});

test("whole dollars convert to cents exactly", () => {
  assert.equal(dollarsToCents(1_000_000), 100_000_000);
  assert.equal(dollarsToCents(-3), -300);
  assert.throws(() => dollarsToCents(12.5), TypeError);
  assert.throws(() => dollarsToCents(Number.MAX_SAFE_INTEGER), TypeError);
});

test("company cash may go negative; only the player budget has a floor", () => {
  // Company cash (distressed rules come later) uses plain signed Cents arithmetic.
  assert.equal(subtractCents(5_000_000, 8_000_000), -3_000_000);
  assert.throws(() => assertNonNegativeCents(-1, "availableCents"), RangeError);
});

test("§11.3 worked example: one investment through a round and an exit", () => {
  const usd = dollarsToCents;
  // Start: $1,000,000 of mandate cash; a $200,000 check at $1.8M pre-money buys 10%.
  let cash = openingInvestmentBudget(config).availableCents;
  assert.equal(cash, usd(1_000_000));
  const check = payInitialCheck(openingInvestmentBudget(config), config);
  assert.ok(check.ok);
  cash = check.budget.availableCents;
  assert.equal(cash, usd(800_000));
  const share = shareForInvestment(config.checkSizeCents, usd(1_800_000));
  assert.equal(share, 1_000);
  assert.equal(shareOfCents(postMoneyCents(usd(1_800_000), usd(200_000)), share), usd(200_000));

  // Another investor puts in $1M at $4M pre-money: 10% dilutes to 8%, worth $400,000
  // of the $5M post-money. Mandate cash does not change.
  const diluted = diluteShare(share, usd(4_000_000), usd(1_000_000));
  assert.equal(diluted, 800);
  assert.equal(shareForInvestment(usd(1_000_000), usd(4_000_000)), 2_000);
  assert.equal(shareOfCents(postMoneyCents(usd(4_000_000), usd(1_000_000)), diluted), usd(400_000));
  assert.equal(cash, usd(800_000));

  // The company sells for $10M of equity value: 8% pays $800,000 into mandate cash.
  const payout = shareOfCents(usd(10_000_000), diluted);
  assert.equal(payout, usd(800_000));
  cash = addCents(cash, payout);
  assert.equal(cash, usd(1_600_000));
});

test("share math rounds down, so parts never exceed the whole", () => {
  // $1 at $2 pre-money is exactly 1/3: 3333.33… bps rounds down.
  assert.equal(shareForInvestment(100, 200), 3_333);
  assert.equal(diluteShare(BASIS_POINTS_WHOLE, 200, 100), 6_666);
  assert.ok(shareForInvestment(100, 200) + diluteShare(BASIS_POINTS_WHOLE, 200, 100) <= BASIS_POINTS_WHOLE);
  // 0.01% of $0.99 is a fraction of a cent: the holder gets 0, never 1.
  assert.equal(shareOfCents(99, 1), 0);
  assert.equal(shareOfCents(1_000_001, 5_000), 500_000);
  // Exact on amounts whose intermediate product exceeds the safe-integer range.
  assert.equal(shareOfCents(Number.MAX_SAFE_INTEGER, BASIS_POINTS_WHOLE), Number.MAX_SAFE_INTEGER);
  assert.equal(diluteShare(9_999, Number.MAX_SAFE_INTEGER - 1, 1), 9_998);
  assert.equal(shareForInvestment(0, 1), 0);
});

test("share math rejects malformed input", () => {
  assertBasisPoints(0);
  assertBasisPoints(BASIS_POINTS_WHOLE);
  assert.throws(() => assertBasisPoints(10_001), RangeError);
  assert.throws(() => assertBasisPoints(-1), RangeError);
  assert.throws(() => assertBasisPoints(0.5), TypeError);
  assert.throws(() => shareForInvestment(0, 0), RangeError);
  assert.throws(() => diluteShare(1_000, 0, 0), RangeError);
  assert.throws(() => shareForInvestment(-1, 100), RangeError);
  assert.throws(() => shareOfCents(10.5, 100), TypeError);
});

test("$1,000,000 funds exactly five $200,000 checks; a sixth is unaffordable", () => {
  let budget = openingInvestmentBudget(config);
  assert.deepEqual(budget, { availableCents: 100_000_000, checksPaid: 0 });
  for (let i = 1; i <= 5; i += 1) {
    const result = payInitialCheck(budget, config);
    assert.ok(result.ok, `check ${i}`);
    budget = result.budget;
  }
  assert.deepEqual(budget, { availableCents: 0, checksPaid: 5 });

  const sixth = payInitialCheck(budget, config);
  assert.equal(sixth.ok, false);
  assert.match(sixth.ok ? "" : sixth.reason, /exceeds the available 0/);
  assert.deepEqual(budget, { availableCents: 0, checksPaid: 5 });
});

test("a check larger than the remaining budget fails without mutation", () => {
  const budget: InvestmentBudget = { availableCents: 19_999_999, checksPaid: 0 };
  const result = payInitialCheck(budget, config);
  assert.equal(result.ok, false);
  assert.deepEqual(budget, { availableCents: 19_999_999, checksPaid: 0 });
  const exact = payInitialCheck({ availableCents: 20_000_000, checksPaid: 4 }, config);
  assert.deepEqual(exact, { ok: true, budget: { availableCents: 0, checksPaid: 5 } });
});

test("the investment count limit applies even when money remains", () => {
  const rich = captureCampaignConfig({ ...structuredClone(config), id: "rich", initialCapitalCents: 200_000_000 });
  const budget: InvestmentBudget = { availableCents: 100_000_000, checksPaid: 5 };
  const result = payInitialCheck(budget, rich);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /all 5 initial investments are used/);
  assert.deepEqual(budget, { availableCents: 100_000_000, checksPaid: 5 });
});

test("a malformed budget is rejected as invalid input", () => {
  assert.throws(() => payInitialCheck({ availableCents: -1, checksPaid: 0 }, config), RangeError);
  assert.throws(() => payInitialCheck({ availableCents: 0.5, checksPaid: 0 }, config), TypeError);
  assert.throws(() => payInitialCheck({ availableCents: 0, checksPaid: 1.5 }, config), RangeError);
});
