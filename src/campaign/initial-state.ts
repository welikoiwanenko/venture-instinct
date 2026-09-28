// The authoritative domain state a campaign starts from (docs/design-doc.md §5, §17.2).
// It is a pure function of the configuration: no seed, clock or content is read yet,
// because PoC 0.1 Alpha generates no companies.

import type { CampaignConfig } from "../config/campaign-config.ts";
import { openingInvestmentBudget, type InvestmentBudget } from "./investment-budget.ts";
import { openWeekSlots, type SlotBalance } from "./slots.ts";
import type { Week } from "./week.ts";

export interface CampaignState {
  /** The week whose plan the player is currently assembling. */
  readonly planningWeek: Week;
  readonly completedWeeks: number;
  readonly slots: SlotBalance;
  readonly budget: InvestmentBudget;
  /** Holdings arrive with the first investment; until then the portfolio is empty. */
  readonly portfolio: readonly [];
}

export function createInitialCampaignState(config: CampaignConfig): CampaignState {
  const planningWeek = 1;
  return Object.freeze({
    planningWeek,
    completedWeeks: 0,
    slots: openWeekSlots(planningWeek, config),
    budget: openingInvestmentBudget(config),
    portfolio: Object.freeze([]) as readonly [],
  });
}
