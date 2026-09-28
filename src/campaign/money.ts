// Money for the domain (docs/design-doc.md §11, §18). Unit: whole US dollars held
// in a safe integer, so addition and subtraction are exact. Any result outside
// the safe-integer range is rejected instead of silently losing precision.
// Display formatting is a UI concern and never feeds back into these values.

/** Whole US dollars. May be negative (company cash can go distressed, §18). */
export type Usd = number;

export function assertUsd(value: unknown, name = "amount"): asserts value is Usd {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a whole number of US dollars, got ${String(value)}`);
  }
}

export function assertNonNegativeUsd(value: unknown, name = "amount"): asserts value is Usd {
  assertUsd(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must not be negative, got ${value}`);
  }
}

export function addUsd(a: Usd, b: Usd): Usd {
  assertUsd(a, "a");
  assertUsd(b, "b");
  const sum = a + b;
  assertUsd(sum, "sum");
  return sum;
}

/** Signed: the result may be negative. Callers enforce their own floor. */
export function subtractUsd(a: Usd, b: Usd): Usd {
  assertUsd(a, "a");
  assertUsd(b, "b");
  const difference = a - b;
  assertUsd(difference, "difference");
  return difference;
}
