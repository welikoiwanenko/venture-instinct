// The debug view (docs/design-doc.md §17.4): the full world of a campaign for developers,
// including hidden starting state, provenance and distortion reasons, authoring notes
// and companies the player has never heard of. It is a separate capability: the player
// view never links to it, and player-facing adapters (TUI, Playtest MCP) must not
// import it. Pure, like the player view.

import type { CampaignState } from "../campaign/initial-state.ts";
import type { CompanyState } from "../campaign/company-dimensions.ts";
import type { CompanyProfile } from "../content/company-profile.ts";
import { deepFreeze } from "../data/plain-data.ts";
import { trueMetricValue } from "./facts.ts";
import { METRIC_NAMES, type Metric, type Observation, type ObservationProvenance } from "./observation.ts";
import { verificationStatus, type VerificationStatus } from "./verification.ts";

export interface DebugObservation {
  readonly observation: Observation;
  readonly provenance?: ObservationProvenance;
  /** What the player sees as its status this week. */
  readonly status: VerificationStatus;
}

export interface DebugCompany {
  /** All five §8.3 dimensions, lifecycle included. */
  readonly state: CompanyState;
  /** The authored profile as loaded: public fields, application with distortions, hidden state. */
  readonly profile: CompanyProfile;
  /** True values of every observable metric at the start (week 0). */
  readonly trueMetrics: Readonly<Record<Metric, number>>;
  readonly observations: readonly DebugObservation[];
}

export interface DebugView {
  /** Marks the data as developer-only wherever it ends up. */
  readonly kind: "debug";
  readonly campaignId: string;
  readonly planningWeek: number;
  /** Every company in the pack, known or not. */
  readonly companies: readonly DebugCompany[];
}

export interface DebugViewSource {
  readonly campaignId: string;
  readonly state: CampaignState;
  readonly profiles: readonly CompanyProfile[];
}

export function buildDebugView({ campaignId, state, profiles }: DebugViewSource): DebugView {
  const { observations, provenance } = state.observations;
  const companies = state.companies.map((company): DebugCompany => {
    const profile = profiles.find((p) => p.id === company.companyId);
    if (profile === undefined) {
      throw new RangeError(`company ${company.companyId} has no profile in the scenario pack`);
    }
    return {
      state: company,
      profile,
      trueMetrics: Object.fromEntries(METRIC_NAMES.map((m) => [m, trueMetricValue(profile.hidden, m)])) as Record<Metric, number>,
      observations: observations
        .filter((o) => o.companyId === company.companyId)
        .map((o) => {
          const internal = provenance.find((p) => p.observationId === o.observationId);
          return {
            observation: o,
            ...(internal === undefined ? {} : { provenance: internal }),
            status: verificationStatus(o, observations, state.planningWeek),
          };
        }),
    };
  });
  return deepFreeze({ kind: "debug" as const, campaignId, planningWeek: state.planningWeek, companies: structuredClone(companies) });
}
