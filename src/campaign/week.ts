// Campaign weeks (docs/design-doc.md §5–6). Weeks are 1-based and run from 1 to
// horizonWeeks inclusive; the investment window is inclusive at both ends.

import type { CampaignConfig } from "../config/campaign-config.ts";

export type Week = number;

export function assertWeek(week: unknown, config: CampaignConfig): asserts week is Week {
  if (typeof week !== "number" || !Number.isSafeInteger(week)) {
    throw new TypeError(`week must be an integer, got ${String(week)}`);
  }
  if (week < 1 || week > config.horizonWeeks) {
    throw new RangeError(`week must be between 1 and ${config.horizonWeeks}, got ${week}`);
  }
}

/** Whether initial investments may be made in `week` (§11.1: weeks 1–8 in the baseline). */
export function isInvestmentWeek(week: Week, config: CampaignConfig): boolean {
  assertWeek(week, config);
  const { firstWeek, lastWeek } = config.investmentWindow;
  return week >= firstWeek && week <= lastWeek;
}
