// Starts a campaign for the TUI through the application API, exactly as the VI-10
// command does: read the scenario pack, then `initializeCampaign` with the baseline
// config. The result is either a whole campaign or readable errors, never a partial one.

import {
  formatManifestIssue,
  initializeCampaign,
  inspectCampaign,
  submitCommand,
  validateWeeklyPlan,
  type Campaign,
  type EndWeekResult,
  type PlanValidation,
} from "../app/campaign-app.ts";

/** Where the scenario pack comes from; `read` is called on every start attempt. */
export interface ScenarioSource {
  /** Shown to the player, e.g. the file path. */
  readonly label: string;
  readonly read: () => string;
}

export type StartResult =
  | { readonly ok: true; readonly campaign: Campaign }
  | { readonly ok: false; readonly errors: readonly string[] };

export function startCampaign(seed: string, source: ScenarioSource): StartResult {
  let text: string;
  try {
    text = source.read();
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? (error as Error).message;
    return { ok: false, errors: [`scenario ${source.label}: cannot read file (${reason})`] };
  }
  let scenario: unknown;
  try {
    scenario = JSON.parse(text) as unknown;
  } catch (error) {
    return { ok: false, errors: [`scenario ${source.label}: invalid JSON (${(error as Error).message})`] };
  }
  const result = initializeCampaign({ seed, scenario });
  return result.ok ? { ok: true, campaign: result.campaign } : { ok: false, errors: result.issues.map(formatManifestIssue) };
}

/** One research action in the TUI's draft plan. */
export interface PlanItem {
  readonly companyId: string;
  readonly checkId: string;
}

export type EndWeekAttempt =
  | { readonly ok: true; readonly campaign: Campaign; readonly messages: readonly string[] }
  | { readonly ok: false; readonly errors: readonly string[] };

/** The draft as the plan the application API checks: for the planning week, in draft order. */
export function draftPlan(campaign: Campaign, draft: readonly PlanItem[]): unknown {
  return {
    week: inspectCampaign(campaign).planningWeek,
    actions: draft.map((item) => ({ type: "research", companyId: item.companyId, checkId: item.checkId })),
  };
}

/** The plan review of the draft, or every reason it is invalid. Pure: the campaign is unchanged. */
export function reviewDraft(campaign: Campaign, draft: readonly PlanItem[]): PlanValidation {
  return validateWeeklyPlan(campaign, draftPlan(campaign, draft));
}

/**
 * Ends the week with the draft through the `endWeek` command. The command id is derived
 * from the planning week: a week ends at most once, and a rejected attempt is not
 * journaled, so a corrected plan may reuse it.
 */
export function submitEndWeek(campaign: Campaign, draft: readonly PlanItem[]): EndWeekAttempt {
  const summary = inspectCampaign(campaign);
  const result = submitCommand(campaign, {
    commandId: `tui-end-week-${summary.planningWeek}`,
    expectedRevision: summary.revision,
    type: "endWeek",
    args: draftPlan(campaign, draft),
  });
  if (!result.ok) return { ok: false, errors: ["✖ The week did not end:", ...result.rejection.reasons.map((r) => `  ${r}`)] };
  const outcome = result.record.result as EndWeekResult;
  const count = outcome.delivered.length;
  return {
    ok: true,
    campaign: result.campaign,
    messages: [
      `✔ Week ${outcome.endedWeek} ended. ${count === 0 ? "Nothing was delivered" : `${count} research ${count === 1 ? "result was" : "results were"} delivered: see 2 Inbox`}. Now planning week ${outcome.planningWeek}.`,
    ],
  };
}
