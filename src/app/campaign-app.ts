// Application API for campaign creation and read-only inspection (docs/design-doc.md
// §17.1). Adapters (the developer CLI now, TUI and MCP later) call these functions
// instead of assembling domain pieces themselves. No I/O happens here.

import type { CampaignState } from "../campaign/initial-state.ts";
import { isInvestmentWeek } from "../campaign/week.ts";
import { POC_BASELINE_CONFIG } from "../config/baseline.ts";
import type { CampaignConfig } from "../config/campaign-config.ts";
import type { ScenarioPack } from "../content/scenario-pack.ts";
import {
  createCampaignManifest,
  type CampaignManifest,
  type ManifestIssue,
} from "../manifest/campaign-manifest.ts";
import { canonicalHash } from "../manifest/canonical-json.ts";
import type { CommandRecord } from "./commands.ts";
import {
  availableActions as listAvailableActions,
  validateWeeklyPlan as checkWeeklyPlan,
  type AvailableActions,
  type PlanValidation,
} from "../campaign/weekly-plan.ts";
import { buildPlayerView, searchPlayerView, type PlayerCompany, type PlayerView } from "../knowledge/player-view.ts";

// Adapters import only from src/app/, so the helpers they need are re-exported here.
export { formatManifestIssue, type ManifestIssue } from "../manifest/campaign-manifest.ts";
export { canonicalJson } from "../manifest/canonical-json.ts";
export {
  formatBasisPoints,
  formatCentsAsUsd,
  formatMetricValue,
  formatPeriod,
  formatSource,
  formatWeeks,
  METRIC_LABELS,
  STATUS_LABELS,
} from "./format.ts";
export type {
  PlayerCompany,
  PlayerCompanyProfile,
  PlayerFounder,
  PlayerObservation,
  PlayerView,
} from "../knowledge/player-view.ts";
export { compareObservations, type ObservationComparison, type VerificationStatus } from "../knowledge/verification.ts";
export { METRICS, type Metric, type Period } from "../knowledge/observation.ts";
export {
  ACTION_CATALOGUE,
  type ActionSpec,
  type AvailableActions,
  type AvailableCheck,
  type AnsweredCheck,
  type CompanyActions,
  type PlanAction,
  type PlanReview,
  type PlanReviewAction,
  type PlanValidation,
  type WeeklyPlan,
} from "../campaign/weekly-plan.ts";
export type { EndWeekResult } from "../campaign/end-week.ts";
export {
  submitCommand,
  type CommandEnvelope,
  type CommandRecord,
  type CommandRejection,
  type RejectionCode,
  type SubmitResult,
} from "./commands.ts";

export interface Campaign {
  readonly id: string;
  /** The frozen configuration snapshot captured at initialization. */
  readonly config: CampaignConfig;
  readonly state: CampaignState;
  readonly manifest: CampaignManifest;
  /** The validated scenario pack the manifest's content hash describes, hidden state included. */
  readonly scenario: ScenarioPack;
  /** Accepted commands so far; 0 at initialization (§17.3). */
  readonly revision: number;
  /** Every accepted command in order, with its result and the state hash after it (§17.2). */
  readonly journal: readonly CommandRecord[];
}

export interface InitializeCampaignInput {
  readonly seed: unknown;
  /** A scenario pack: `{ id, contentVersion, content }`. */
  readonly scenario: unknown;
  /** Defaults to POC_BASELINE_CONFIG. */
  readonly config?: unknown;
}

export type InitializeCampaignResult =
  | { readonly ok: true; readonly campaign: Campaign }
  | { readonly ok: false; readonly issues: readonly ManifestIssue[] };

/** Read-only view of a campaign. Plain data, safe to print or serialize. */
export interface CampaignSummary {
  readonly campaignId: string;
  readonly seed: string;
  readonly scenarioId: string;
  readonly configId: string;
  readonly configVersion: number;
  readonly planningWeek: number;
  readonly completedWeeks: number;
  readonly horizonWeeks: number;
  readonly investmentWindowOpen: boolean;
  readonly slotsAvailable: number;
  /** Whole US cents. */
  readonly capitalAvailableCents: number;
  readonly initialInvestmentsMade: number;
  readonly maxInitialInvestments: number;
  /** Whole US cents paid for each initial investment. */
  readonly checkSizeCents: number;
  readonly portfolioSize: number;
  /** Companies the player knows of. Unknown companies are not counted (§9.1). */
  readonly knownCompanies: number;
  /** Accepted commands so far; a command must name it as its expectedRevision. */
  readonly revision: number;
  /** Hash of the current domain state; equals manifest.initialStateHash before any command. */
  readonly stateHash: string;
}

/**
 * Validates every input before building anything, so a rejected call returns all
 * issues and no campaign; there is no partially initialized state to clean up.
 */
export function initializeCampaign(input: InitializeCampaignInput): InitializeCampaignResult {
  const result = createCampaignManifest({
    seed: input.seed,
    scenario: input.scenario,
    config: input.config === undefined ? POC_BASELINE_CONFIG : input.config,
  });
  if (!result.ok) {
    return result;
  }
  const { manifest, pack } = result;
  return {
    ok: true,
    campaign: Object.freeze({
      id: manifest.campaignId,
      config: manifest.config,
      state: manifest.initialState,
      manifest,
      scenario: pack,
      revision: 0,
      journal: Object.freeze([]),
    }),
  };
}

/** Pure read: never changes the campaign, advances time or draws randomness. */
export function inspectCampaign(campaign: Campaign): CampaignSummary {
  const { config, state, manifest } = campaign;
  return Object.freeze({
    campaignId: campaign.id,
    seed: manifest.seed,
    scenarioId: manifest.scenario.id,
    configId: config.id,
    configVersion: config.version,
    planningWeek: state.planningWeek,
    completedWeeks: state.completedWeeks,
    horizonWeeks: config.horizonWeeks,
    investmentWindowOpen: isInvestmentWeek(state.planningWeek, config),
    slotsAvailable: state.slots.remaining,
    capitalAvailableCents: state.budget.availableCents,
    initialInvestmentsMade: state.budget.checksPaid,
    maxInitialInvestments: config.maxInitialInvestments,
    checkSizeCents: config.checkSizeCents,
    portfolioSize: state.portfolio.length,
    knownCompanies: state.companies.filter((c) => c.knowledge !== "unknown").length,
    revision: campaign.revision,
    stateHash: canonicalHash(state),
  });
}

/**
 * What the player has legitimately learned (design §9.1, §17.4): known companies with
 * their public profile, the player's own decisions and the delivered observations with
 * their statuses. The only campaign read a player-facing adapter needs besides
 * `inspectCampaign`. Pure: never changes the campaign, advances time or draws randomness.
 */
export function viewAsPlayer(campaign: Campaign): PlayerView {
  return buildPlayerView({ campaignId: campaign.id, state: campaign.state, profiles: campaign.scenario.content.companies });
}

/** Known companies whose readable text matches `query`. Unknown companies are never searched. */
export function searchKnownCompanies(campaign: Campaign, query: string): readonly PlayerCompany[] {
  return searchPlayerView(viewAsPlayer(campaign), query);
}

/**
 * Checks a draft plan for the planning week against the state at its start (§6.1) and,
 * when valid, returns the plan review: actions, slot costs, slots left and unanswered
 * deadlines. Otherwise returns every player-visible reason. Drafts are not domain state:
 * pure, never changes the campaign.
 */
export function validateWeeklyPlan(campaign: Campaign, plan: unknown): PlanValidation {
  return checkWeeklyPlan(campaign.state, campaign.scenario.content.companies, plan);
}

/** The actions the player can plan this week, with cost and arrival, never their results. Pure. */
export function availableActions(campaign: Campaign): AvailableActions {
  return listAvailableActions(campaign.state, campaign.scenario.content.companies);
}
