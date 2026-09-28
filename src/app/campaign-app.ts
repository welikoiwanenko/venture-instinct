// Application API for campaign creation and read-only inspection (docs/design-doc.md
// §17.1). Adapters (the developer CLI now, TUI and MCP later) call these functions
// instead of assembling domain pieces themselves. No I/O happens here.

import type { CampaignState } from "../campaign/initial-state.ts";
import { isInvestmentWeek } from "../campaign/week.ts";
import { POC_BASELINE_CONFIG } from "../config/baseline.ts";
import type { CampaignConfig } from "../config/campaign-config.ts";
import {
  createCampaignManifest,
  type CampaignManifest,
  type ManifestIssue,
} from "../manifest/campaign-manifest.ts";
import { canonicalHash } from "../manifest/canonical-json.ts";

export interface Campaign {
  readonly id: string;
  /** The frozen configuration snapshot captured at initialization. */
  readonly config: CampaignConfig;
  readonly state: CampaignState;
  readonly manifest: CampaignManifest;
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
  readonly capitalAvailableUsd: number;
  readonly initialInvestmentsMade: number;
  readonly maxInitialInvestments: number;
  readonly portfolioSize: number;
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
  const { manifest } = result;
  return {
    ok: true,
    campaign: Object.freeze({
      id: manifest.campaignId,
      config: manifest.config,
      state: manifest.initialState,
      manifest,
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
    capitalAvailableUsd: state.budget.availableUsd,
    initialInvestmentsMade: state.budget.checksPaid,
    maxInitialInvestments: config.maxInitialInvestments,
    portfolioSize: state.portfolio.length,
    stateHash: canonicalHash(state),
  });
}
