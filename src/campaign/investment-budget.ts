// The player's initial-investment budget (docs/design-doc.md §5, §11.1, §18).
// Unlike company cash, it may never go below zero, and at most
// maxInitialInvestments checks may be paid from it.

import type { CampaignConfig } from "../config/campaign-config.ts";
import { assertNonNegativeCents, subtractCents, type Cents } from "./money.ts";

export interface InvestmentBudget {
  readonly availableCents: Cents;
  readonly checksPaid: number;
}

export type PayCheckResult =
  | { readonly ok: true; readonly budget: InvestmentBudget }
  | { readonly ok: false; readonly reason: string };

export function openingInvestmentBudget(config: CampaignConfig): InvestmentBudget {
  return Object.freeze({ availableCents: config.initialCapitalCents, checksPaid: 0 });
}

/**
 * Pays one standard check (config.checkSizeCents). Rejection returns a reason and
 * leaves `budget` untouched; success returns a new budget. The investment window
 * is checked separately with isInvestmentWeek.
 */
export function payInitialCheck(budget: InvestmentBudget, config: CampaignConfig): PayCheckResult {
  assertNonNegativeCents(budget.availableCents, "availableCents");
  if (!Number.isSafeInteger(budget.checksPaid) || budget.checksPaid < 0) {
    throw new RangeError(`checksPaid must be a non-negative integer, got ${String(budget.checksPaid)}`);
  }
  if (budget.availableCents < config.checkSizeCents) {
    return {
      ok: false,
      reason: `check of ${config.checkSizeCents} exceeds the available ${budget.availableCents}`,
    };
  }
  if (budget.checksPaid >= config.maxInitialInvestments) {
    return { ok: false, reason: `all ${config.maxInitialInvestments} initial investments are used` };
  }
  return {
    ok: true,
    budget: Object.freeze({
      availableCents: subtractCents(budget.availableCents, config.checkSizeCents),
      checksPaid: budget.checksPaid + 1,
    }),
  };
}
