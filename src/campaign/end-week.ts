// End Week (docs/design-doc.md §6.2, §9.1, §17.3, §18): the one rule that moves time.
// It validates the plan against the start of week W, spends its slots, completes the
// research due in W, delivers the results at the end of W and opens W+1, or it changes
// nothing at all. Atomicity without persistence: the function returns a whole new state
// or a rejection; there is no partly ended week to undo.
//
// Phases in §6.2 order; those without content in Delta are explicit no-ops:
// 1. validate the plan at the start of W and reserve its slots;
// 2. initial investments and agreed rounds (Epsilon) — none yet;
// 3. complete the research due in W, reading the world before the operating phase;
// 4. market, founders and the operating simulation (Zeta) — the world does not change yet;
// 5. close opportunities and overdue requests — none exist yet;
// 6. deliver observations at the end of W;
// 7. open W+1 with fresh slots; unused slots of W are discarded.

import type { CampaignConfig } from "../config/campaign-config.ts";
import type { CompanyProfile } from "../content/company-profile.ts";
import { deepFreeze } from "../data/plain-data.ts";
import { appendObservations } from "../knowledge/observation.ts";
import type { CampaignState, ResearchRecord } from "./initial-state.ts";
import { researchEntry, researchObservationId } from "./research.ts";
import { openWeekSlots, spendSlots } from "./slots.ts";
import { validateWeeklyPlan, type PlanReview, type WeeklyPlan } from "./weekly-plan.ts";
import type { Week } from "./week.ts";

export interface EndWeekResult {
  readonly endedWeek: Week;
  /** The week now being planned. */
  readonly planningWeek: Week;
  readonly slotsSpent: number;
  /** Slots of the ended week that were not used; they do not carry over (§5). */
  readonly slotsDiscarded: number;
  /** Observations delivered at the end of the week, in plan order. */
  readonly delivered: readonly string[];
}

export type EndWeekOutcome =
  | { readonly ok: true; readonly state: CampaignState; readonly result: EndWeekResult; readonly review: PlanReview }
  | { readonly ok: false; readonly reasons: readonly string[] };

export function endWeek(state: CampaignState, profiles: readonly CompanyProfile[], config: CampaignConfig, plan: unknown): EndWeekOutcome {
  const week = state.planningWeek;
  // Run completion (§16) arrives with Eta; until then the last week cannot be ended,
  // so no week beyond the horizon ever opens.
  if (week >= config.horizonWeeks) {
    return {
      ok: false,
      reasons: [`week ${week} is the last week of the campaign; ending it completes the run, which is not available yet`],
    };
  }

  // 1. Validate against the start of W and reserve the slots.
  const validation = validateWeeklyPlan(state, profiles, plan);
  if (!validation.ok) return validation;
  const { plan: accepted, review } = validation;
  const spent = spendSlots(state.slots, review.slotsUsed);
  if (!spent.ok) return { ok: false, reasons: [spent.reason] };

  // 2. Initial investments and agreed rounds: none in Delta.

  // 3. Complete the research due in W.
  const entries = completeResearch(accepted, profiles);

  // 4. Operating simulation: intentionally empty until Zeta; the world does not change between weeks.

  // 5. Opportunities and requests: none in Delta.

  // 6. Deliver at the end of W.
  const appended = appendObservations(state.observations, entries.map((e) => e.entry));
  if (!appended.ok) {
    // The plan was validated against authored checks, so this is a bug, not player input.
    throw new Error(`research for week ${week} could not be delivered:\n${appended.issues.map((i) => `${i.path}: ${i.message}`).join("\n")}`);
  }
  const research: ResearchRecord[] = entries.map((e) => e.record);

  // 7. Open W+1 with fresh slots.
  const next = week + 1;
  const nextState: CampaignState = deepFreeze({
    ...state,
    planningWeek: next,
    completedWeeks: state.completedWeeks + 1,
    slots: openWeekSlots(next, config),
    observations: appended.log,
    research: [...state.research, ...research],
  });
  return {
    ok: true,
    state: nextState,
    review,
    result: deepFreeze({
      endedWeek: week,
      planningWeek: next,
      slotsSpent: review.slotsUsed,
      slotsDiscarded: spent.balance.remaining,
      delivered: research.map((r) => r.observationId),
    }),
  };
}

function completeResearch(
  plan: WeeklyPlan,
  profiles: readonly CompanyProfile[],
): Array<{ entry: { observation: unknown; provenance: unknown }; record: ResearchRecord }> {
  return plan.actions.map((action) => {
    const profile = profiles.find((p) => p.id === action.companyId);
    const check = profile?.researchChecks.find((c) => c.id === action.checkId);
    if (profile === undefined || check === undefined) {
      throw new Error(`validated plan names a missing check ${action.companyId}/${action.checkId}`);
    }
    return {
      entry: researchEntry(profile, check, plan.week),
      record: {
        companyId: profile.id,
        checkId: check.id,
        week: plan.week,
        observationId: researchObservationId(check.id, plan.week),
      },
    };
  });
}
