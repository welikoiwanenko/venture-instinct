// Ownership shares in basis points and the money they convert to (docs/design-doc.md
// §10.2, §11.2, §11.3). Math only: ownership records and the cap table come later.
//
// Unit: 1 basis point = 0.01%, so 10% = 1_000 and the whole company = 10_000.
// Intermediate products are computed with BigInt, so nothing is lost before the
// single rounding step, and every result must fit back into a safe integer.
//
// Rounding rule: every operation rounds DOWN (toward zero; all inputs are
// non-negative). A holder never receives more share or money than the exact
// value, so the parts of one company can never add up to more than 100% or more
// than the price paid. The truncated remainder is not assigned here; the future
// cap table decides who holds it (§11.2).

import { addCents, assertNonNegativeCents, type Cents } from "./money.ts";

/** Whole basis points of one company, 0..BASIS_POINTS_WHOLE. */
export type BasisPoints = number;

export const BASIS_POINTS_WHOLE: BasisPoints = 10_000;

export function assertBasisPoints(value: unknown, name = "share"): asserts value is BasisPoints {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a whole number of basis points, got ${String(value)}`);
  }
  if (value < 0 || value > BASIS_POINTS_WHOLE) {
    throw new RangeError(`${name} must be between 0 and ${BASIS_POINTS_WHOLE} basis points, got ${value}`);
  }
}

/** Post-money valuation: pre-money plus the new money. */
export function postMoneyCents(preMoney: Cents, investment: Cents): Cents {
  assertNonNegativeCents(preMoney, "preMoney");
  assertNonNegativeCents(investment, "investment");
  return addCents(preMoney, investment);
}

/** Share bought by `investment` at `preMoney`: F / (V + F), rounded down. */
export function shareForInvestment(investment: Cents, preMoney: Cents): BasisPoints {
  const postMoney = postMoneyCents(preMoney, investment);
  if (postMoney === 0) {
    throw new RangeError("post-money valuation must be positive");
  }
  return mulDivFloor(investment, BASIS_POINTS_WHOLE, postMoney);
}

/** An existing holder's share after new money F at pre-money V: share × V / (V + F), rounded down. */
export function diluteShare(share: BasisPoints, preMoney: Cents, investment: Cents): BasisPoints {
  assertBasisPoints(share);
  const postMoney = postMoneyCents(preMoney, investment);
  if (postMoney === 0) {
    throw new RangeError("post-money valuation must be positive");
  }
  return mulDivFloor(share, preMoney, postMoney);
}

/** The part of `amount` (an exit price or a valuation) that `share` is worth, rounded down. */
export function shareOfCents(amount: Cents, share: BasisPoints): Cents {
  assertNonNegativeCents(amount, "amount");
  assertBasisPoints(share);
  return mulDivFloor(amount, share, BASIS_POINTS_WHOLE);
}

function mulDivFloor(a: number, b: number, divisor: number): number {
  const result = Number((BigInt(a) * BigInt(b)) / BigInt(divisor));
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`result ${result} is outside the safe-integer range`);
  }
  return result;
}
