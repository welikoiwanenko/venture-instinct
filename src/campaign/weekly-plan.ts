// The weekly plan (docs/design-doc.md §6.1, §7, §9.2). The player composes a plan for
// the planning week W from the action catalogue; End Week (VI-32) submits it whole.
// Validation reads only the state at the start of W, never hidden state or the future,
// and returns every player-visible reason at once. Drafts are not domain state:
// validating, reviewing or listing actions never changes the campaign.
//
// Delta offers one action, Research: 1 slot, a company the player knows and a check
// that exists for it and has not been delivered yet. Its result arrives at the end of
// W and is readable when planning W+1 (§7).

import type { CompanyProfile } from "../content/company-profile.ts";
import type { ResearchCheck, ResearchDirection } from "../content/research-check.ts";
import { deepFreeze, isPlainRecord, snapshotPlainData } from "../data/plain-data.ts";
import type { CampaignState, ResearchRecord } from "./initial-state.ts";
import type { Week } from "./week.ts";

export const ACTION_TYPES = ["research"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** What the player sees about an action before adding it (§15). */
export interface ActionSpec {
  readonly title: string;
  readonly slotCost: number;
  readonly prerequisites: string;
  readonly result: string;
}

/** The §7 actions available in this milestone. */
export const ACTION_CATALOGUE: Readonly<Record<ActionType, ActionSpec>> = deepFreeze({
  research: {
    title: "Research",
    slotCost: 1,
    prerequisites: "a company you know and a check available for it",
    result: "one piece of evidence on the chosen question, delivered at the end of the week and readable when planning the next one",
  },
});

export interface ResearchAction {
  readonly type: "research";
  readonly companyId: string;
  readonly checkId: string;
}

export type PlanAction = ResearchAction;

/** A normalized plan: the planning week it is for and its actions in order. */
export interface WeeklyPlan {
  readonly week: Week;
  readonly actions: readonly PlanAction[];
}

export interface PlanReviewAction {
  readonly action: PlanAction;
  readonly title: string;
  readonly companyName: string;
  /** The check's question, as the player chose it. */
  readonly question: string;
  readonly slotCost: number;
  /** The planning week in which the result can first be read. */
  readonly resultReadableWeek: Week;
}

/** The one review before End Week (§6.1, §15). */
export interface PlanReview {
  readonly week: Week;
  readonly actions: readonly PlanReviewAction[];
  readonly slotsUsed: number;
  readonly slotsAvailable: number;
  readonly slotsLeft: number;
  /** Known requests whose deadline this plan leaves unanswered. None exist before requests do. */
  readonly unansweredDeadlines: readonly string[];
}

export type PlanValidation =
  | { readonly ok: true; readonly plan: WeeklyPlan; readonly review: PlanReview }
  | { readonly ok: false; readonly reasons: readonly string[] };

export interface AvailableCheck {
  readonly checkId: string;
  readonly direction: ResearchDirection;
  readonly question: string;
  /** What the check reads, as shown to the player. */
  readonly source: string;
  readonly slotCost: number;
  readonly resultReadableWeek: Week;
}

export interface AnsweredCheck {
  readonly checkId: string;
  readonly question: string;
  /** The planning week whose research delivered it. */
  readonly week: Week;
  readonly observationId: string;
}

export interface CompanyActions {
  readonly companyId: string;
  readonly companyName: string;
  /** Checks that can be planned, in authored order. Never their results. */
  readonly checks: readonly AvailableCheck[];
  /** Checks already delivered: their evidence stays readable and is not sold again (§9.2). */
  readonly answered: readonly AnsweredCheck[];
}

export interface AvailableActions {
  readonly week: Week;
  readonly slotsAvailable: number;
  readonly catalogue: Readonly<Record<ActionType, ActionSpec>>;
  /** Companies the player knows, in pack order. */
  readonly research: readonly CompanyActions[];
}

const PLAN_KEYS = ["week", "actions"];
const RESEARCH_KEYS = ["type", "companyId", "checkId"];

/**
 * Normalizes an untrusted plan and checks it against the state at the start of the
 * planning week. Pure. A company the player does not know gets the same reason
 * whether or not it exists, so a rejection never reveals an unknown company.
 */
export function validateWeeklyPlan(state: CampaignState, profiles: readonly CompanyProfile[], input: unknown): PlanValidation {
  const shaped = normalizePlan(input);
  if (!shaped.ok) return shaped;
  const plan = shaped.plan;
  const reasons: string[] = [];
  if (plan.week !== state.planningWeek) {
    reasons.push(`this plan is for week ${plan.week}, but you are planning week ${state.planningWeek}`);
  }

  const known = knownProfiles(state, profiles);
  const planned = new Map<string, number>();
  const lines: PlanReviewAction[] = [];
  plan.actions.forEach((action, index) => {
    const label = `action ${index + 1}`;
    const profile = known.get(action.companyId);
    if (profile === undefined) {
      reasons.push(`${label}: you do not know a company ${JSON.stringify(action.companyId)}`);
      return;
    }
    const check = profile.researchChecks.find((c) => c.id === action.checkId);
    if (check === undefined) {
      reasons.push(`${label}: ${profile.name} has no research check ${JSON.stringify(action.checkId)}`);
      return;
    }
    const earlier = planned.get(check.id);
    if (earlier !== undefined) {
      reasons.push(`${label}: "${check.question}" is already planned as action ${earlier}`);
      return;
    }
    planned.set(check.id, index + 1);
    const answered = answeredRecord(state.research, action.companyId, check.id);
    if (answered !== undefined) {
      reasons.push(
        `${label}: you already have the result of "${check.question}" from week ${answered.week}; read it on ${profile.name}'s card`,
      );
      return;
    }
    lines.push(reviewLine(action, profile, check, state.planningWeek));
  });

  const slotsUsed = plan.actions.reduce((sum, action) => sum + ACTION_CATALOGUE[action.type].slotCost, 0);
  if (slotsUsed > state.slots.remaining) {
    reasons.push(`the plan needs ${slotsUsed} slots, but week ${state.planningWeek} has ${state.slots.remaining}; remove ${slotsUsed - state.slots.remaining}`);
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return deepFreeze({
    ok: true,
    plan,
    review: {
      week: plan.week,
      actions: lines,
      slotsUsed,
      slotsAvailable: state.slots.remaining,
      slotsLeft: state.slots.remaining - slotsUsed,
      unansweredDeadlines: [],
    },
  });
}

/** What the player can plan this week: per known company, the open checks (never their results) and the answered ones. */
export function availableActions(state: CampaignState, profiles: readonly CompanyProfile[]): AvailableActions {
  const research = [...knownProfiles(state, profiles).values()].map((profile): CompanyActions => {
    const checks: AvailableCheck[] = [];
    const answered: AnsweredCheck[] = [];
    for (const check of profile.researchChecks) {
      const record = answeredRecord(state.research, profile.id, check.id);
      if (record === undefined) {
        checks.push({
          checkId: check.id,
          direction: check.direction,
          question: check.question,
          source: check.evidence.source,
          slotCost: ACTION_CATALOGUE.research.slotCost,
          resultReadableWeek: state.planningWeek + 1,
        });
      } else {
        answered.push({ checkId: check.id, question: check.question, week: record.week, observationId: record.observationId });
      }
    }
    return { companyId: profile.id, companyName: profile.name, checks, answered };
  });
  return deepFreeze({ week: state.planningWeek, slotsAvailable: state.slots.remaining, catalogue: ACTION_CATALOGUE, research });
}

/** Identified companies only, in pack order: a signal has no profile to research yet. */
function knownProfiles(state: CampaignState, profiles: readonly CompanyProfile[]): Map<string, CompanyProfile> {
  const known = new Map<string, CompanyProfile>();
  for (const company of state.companies) {
    if (company.knowledge !== "identified") continue;
    const profile = profiles.find((p) => p.id === company.companyId);
    if (profile !== undefined) known.set(profile.id, profile);
  }
  return known;
}

function answeredRecord(research: readonly ResearchRecord[], companyId: string, checkId: string): ResearchRecord | undefined {
  return research.find((r) => r.companyId === companyId && r.checkId === checkId);
}

function reviewLine(action: PlanAction, profile: CompanyProfile, check: ResearchCheck, week: Week): PlanReviewAction {
  const spec = ACTION_CATALOGUE[action.type];
  return {
    action,
    title: spec.title,
    companyName: profile.name,
    question: check.question,
    slotCost: spec.slotCost,
    resultReadableWeek: week + 1,
  };
}

/** Shape only: `{ week, actions: [{ type: "research", companyId, checkId }] }`, read once. */
export function normalizePlan(input: unknown): { readonly ok: true; readonly plan: WeeklyPlan } | { readonly ok: false; readonly reasons: readonly string[] } {
  const snapshot = snapshotPlainData(input, "plan");
  if (snapshot.issues.length > 0) return { ok: false, reasons: snapshot.issues.map((i) => `${i.path}: ${i.message}`) };
  const value = snapshot.value;
  if (!isPlainRecord(value)) return { ok: false, reasons: ["plan: must be an object with week and actions"] };
  const reasons: string[] = [];
  for (const key of Object.keys(value)) {
    if (!PLAN_KEYS.includes(key)) reasons.push(`plan.${key}: is not a known field`);
  }
  const week = value["week"];
  if (typeof week !== "number" || !Number.isSafeInteger(week) || week < 1) reasons.push("plan.week: must be the planning week number");
  const items = value["actions"];
  const actions: PlanAction[] = [];
  if (!Array.isArray(items)) {
    reasons.push("plan.actions: must be a list of actions (it may be empty)");
  } else {
    items.forEach((item, index) => {
      const label = `action ${index + 1}`;
      if (!isPlainRecord(item)) {
        reasons.push(`${label}: must be an object with a type`);
        return;
      }
      const type = item["type"];
      if (typeof type !== "string" || !(ACTION_TYPES as readonly string[]).includes(type)) {
        reasons.push(`${label}: unknown action type ${JSON.stringify(type)}; this week offers ${ACTION_TYPES.join(", ")}`);
        return;
      }
      const problems: string[] = [];
      for (const key of Object.keys(item)) {
        if (!RESEARCH_KEYS.includes(key)) problems.push(`${label}: ${key} is not a field of ${type}`);
      }
      const { companyId, checkId } = item;
      if (typeof companyId !== "string" || companyId === "") problems.push(`${label}: companyId must name a company`);
      if (typeof checkId !== "string" || checkId === "") problems.push(`${label}: checkId must name a research check`);
      reasons.push(...problems);
      if (problems.length === 0) actions.push({ type: "research", companyId: companyId as string, checkId: checkId as string });
    });
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, plan: deepFreeze({ week: week as number, actions }) };
}
