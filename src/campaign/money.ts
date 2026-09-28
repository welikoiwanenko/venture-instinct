// Money for the domain (docs/design-doc.md §10.2, §11, §18). Unit: whole US cents
// held in a safe integer, so addition and subtraction are exact and $12.50 is 1250.
// Any result outside the safe-integer range is rejected instead of silently losing
// precision. Display formatting is a UI concern and never feeds back into these values.

/** Whole US cents. May be negative (company cash can go distressed, §18). */
export type Cents = number;

export const CENTS_PER_DOLLAR = 100;

export function assertCents(value: unknown, name = "amount"): asserts value is Cents {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a whole number of cents, got ${String(value)}`);
  }
}

export function assertNonNegativeCents(value: unknown, name = "amount"): asserts value is Cents {
  assertCents(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must not be negative, got ${value}`);
  }
}

export function addCents(a: Cents, b: Cents): Cents {
  assertCents(a, "a");
  assertCents(b, "b");
  const sum = a + b;
  assertCents(sum, "sum");
  return sum;
}

/** Signed: the result may be negative. Callers enforce their own floor. */
export function subtractCents(a: Cents, b: Cents): Cents {
  assertCents(a, "a");
  assertCents(b, "b");
  const difference = a - b;
  assertCents(difference, "difference");
  return difference;
}

/** Exact conversion of a whole-dollar amount, e.g. for literals in configs and tests. */
export function dollarsToCents(dollars: number): Cents {
  if (!Number.isSafeInteger(dollars)) {
    throw new TypeError(`dollars must be a whole number, got ${String(dollars)}`);
  }
  const cents = dollars * CENTS_PER_DOLLAR;
  assertCents(cents, "cents");
  return cents;
}
