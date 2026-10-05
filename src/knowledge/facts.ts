// True values of observable metrics, derived from a company's hidden state (docs/design-doc.md
// §9.1, §10.2). This is the world layer: it is what a claim is measured against, and
// it is never part of player-facing data.

import type { HiddenStartingState } from "../content/company-profile.ts";
import type { Metric } from "./observation.ts";

/** The true value of `metric` in `hidden`, in the metric's unit (see METRICS). */
export function trueMetricValue(hidden: HiddenStartingState, metric: Metric): number {
  switch (metric) {
    case "payingCustomers":
      return hidden.payingCustomers;
    case "weeklyPriceCents":
      return hidden.weeklyPriceCents;
    // §10.3: every active customer pays the weekly price.
    case "weeklyRevenueCents":
      return hidden.payingCustomers * hidden.weeklyPriceCents;
    case "weeklyBurnCents":
      return hidden.team.reduce((sum, line) => sum + line.weeklyCostCents, 0) + hidden.otherWeeklyCostsCents;
    case "cashCents":
      return hidden.cashCents;
    case "teamSize":
      return hidden.team.reduce((sum, line) => sum + line.headcount, 0);
    case "largestCustomerShareBps":
      return hidden.largestCustomerShareBps;
  }
}
