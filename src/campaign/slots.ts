// Weekly action slots (docs/design-doc.md §5–7). Every week opens with exactly
// slotsPerWeek; unused slots are discarded, never carried over.

import type { CampaignConfig } from "../config/campaign-config.ts";
import { assertWeek, type Week } from "./week.ts";

export interface SlotBalance {
  readonly week: Week;
  readonly remaining: number;
}

export type SpendSlotsResult =
  | { readonly ok: true; readonly balance: SlotBalance }
  | { readonly ok: false; readonly reason: string };

/** Fresh balance for `week`. Takes no previous balance, so leftovers cannot leak in. */
export function openWeekSlots(week: Week, config: CampaignConfig): SlotBalance {
  assertWeek(week, config);
  return Object.freeze({ week, remaining: config.slotsPerWeek });
}

/**
 * Spends `cost` slots. Rejection returns a reason and leaves `balance` untouched;
 * success returns a new balance. Malformed balances and costs throw.
 */
export function spendSlots(balance: SlotBalance, cost: number): SpendSlotsResult {
  if (!Number.isSafeInteger(balance.remaining) || balance.remaining < 0) {
    throw new RangeError(`remaining slots must be a non-negative integer, got ${String(balance.remaining)}`);
  }
  if (!Number.isSafeInteger(cost) || cost < 0) {
    throw new RangeError(`slot cost must be a non-negative integer, got ${String(cost)}`);
  }
  if (cost > balance.remaining) {
    return { ok: false, reason: `needs ${cost} slots, only ${balance.remaining} left in week ${balance.week}` };
  }
  return { ok: true, balance: Object.freeze({ week: balance.week, remaining: balance.remaining - cost }) };
}
