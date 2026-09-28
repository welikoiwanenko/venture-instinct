// PoC 0.1 starting configuration (docs/design-doc.md §5). Every number here is a
// balance hypothesis: change it by publishing a new id/version, never in consumers.

import type { CampaignConfig } from "./campaign-config.ts";
import { captureCampaignConfig } from "./campaign-config.ts";

export const POC_BASELINE_CONFIG: CampaignConfig = captureCampaignConfig({
  id: "poc-0.1-baseline",
  version: 1,
  investmentWindow: { firstWeek: 1, lastWeek: 8 },
  horizonWeeks: 156,
  slotsPerWeek: 5,
  initialCapitalUsd: 1_000_000,
  checkSizeUsd: 200_000,
  maxInitialInvestments: 5,
});
