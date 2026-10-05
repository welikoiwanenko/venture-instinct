// The authoritative domain state a campaign starts from (docs/design-doc.md §5, §8.3,
// §17.2). It is a pure function of the configuration and the pack's companies: no seed
// or clock is read, because nothing random is generated yet.

import type { CampaignConfig } from "../config/campaign-config.ts";
import type { CompanyProfile } from "../content/company-profile.ts";
import { EMPTY_OBSERVATION_LOG, type ObservationLog } from "../knowledge/observation.ts";
import { initialCompanyStates, type CompanyState } from "./company-dimensions.ts";
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
  /** Every company of the pack, known or not, in pack order (§8.3). */
  readonly companies: readonly CompanyState[];
  /**
   * Everything delivered to the player, with its internal provenance (§9.1). Only the
   * player knowledge view may read it for players, and it returns only the
   * player-facing half.
   */
  readonly observations: ObservationLog;
}

export function createInitialCampaignState(config: CampaignConfig, companies: readonly CompanyProfile[]): CampaignState {
  const planningWeek = 1;
  return Object.freeze({
    planningWeek,
    completedWeeks: 0,
    slots: openWeekSlots(planningWeek, config),
    budget: openingInvestmentBudget(config),
    portfolio: Object.freeze([]) as readonly [],
    companies: initialCompanyStates(companies),
    observations: EMPTY_OBSERVATION_LOG,
  });
}
