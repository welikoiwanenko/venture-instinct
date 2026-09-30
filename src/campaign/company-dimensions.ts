// Independent per-company state dimensions (docs/design-doc.md §8.3, §10.5). Instead of
// one pipeline status, every company in a campaign has five separate values: what the
// player knows, what the player decided, the contact, the investment opportunity and
// the company's own lifecycle in the world. Changing one never changes another; the
// transition rules that do change them (scout, outreach, PASS, invest, distress) come
// with later milestones and must go through `setCompanyDimension`.

import type { CompanyProfile, InitialKnowledge } from "../content/company-profile.ts";

export const KNOWLEDGE_STATES = ["unknown", "signal", "identified"] as const;
export const DECISION_STATES = ["undecided", "shortlisted", "passed", "invested"] as const;
export const CONTACT_STATES = ["none", "pending", "deferred", "no_response", "declined", "meeting_available"] as const;
export const OPPORTUNITY_STATES = ["unavailable", "open", "committed", "expired", "withdrawn"] as const;
export const LIFECYCLE_STATES = ["operating", "distressed", "shutdown", "acquired"] as const;

export type Knowledge = (typeof KNOWLEDGE_STATES)[number];
export type Decision = (typeof DECISION_STATES)[number];
export type Contact = (typeof CONTACT_STATES)[number];
export type Opportunity = (typeof OPPORTUNITY_STATES)[number];
export type Lifecycle = (typeof LIFECYCLE_STATES)[number];

export interface CompanyDimensions {
  /** What the player knows: a company can be operating while still unknown. */
  readonly knowledge: Knowledge;
  readonly decision: Decision;
  readonly contact: Contact;
  readonly opportunity: Opportunity;
  /** The company's state in the world, independent of the player. */
  readonly lifecycle: Lifecycle;
}

export type Dimension = keyof CompanyDimensions;

/** The allowed values of each dimension; the one table every check reads. */
export const DIMENSION_VALUES: { readonly [D in Dimension]: readonly CompanyDimensions[D][] } = {
  knowledge: KNOWLEDGE_STATES,
  decision: DECISION_STATES,
  contact: CONTACT_STATES,
  opportunity: OPPORTUNITY_STATES,
  lifecycle: LIFECYCLE_STATES,
};

export const DIMENSIONS = Object.keys(DIMENSION_VALUES) as readonly Dimension[];

export interface CompanyState extends CompanyDimensions {
  readonly companyId: string;
}

const INITIAL_KNOWLEDGE: Readonly<Record<InitialKnowledge, Knowledge>> = {
  // Inbound applicants introduced themselves in the week 1 wave (§8.1).
  inbound: "identified",
  unknown: "unknown",
};

/**
 * One state per profile, in pack order. Only knowledge depends on the pack; the player
 * has decided nothing, contacted no one and holds no offer yet, and every company is
 * operating in the world whether the player knows it or not.
 */
export function initialCompanyStates(profiles: readonly CompanyProfile[]): readonly CompanyState[] {
  return Object.freeze(
    profiles.map((profile) =>
      Object.freeze({
        companyId: profile.id,
        knowledge: INITIAL_KNOWLEDGE[profile.initialKnowledge],
        decision: "undecided",
        contact: "none",
        opportunity: "unavailable",
        lifecycle: "operating",
      } satisfies CompanyState),
    ),
  );
}

/**
 * Returns a new list in which only `dimension` of `companyId` is `value`. Every other
 * company and every other dimension keeps its identity. Unknown companies, dimensions
 * and values throw: callers are domain rules, and a wrong value is a bug, not input.
 */
export function setCompanyDimension<D extends Dimension>(
  companies: readonly CompanyState[],
  companyId: string,
  dimension: D,
  value: CompanyDimensions[D],
): readonly CompanyState[] {
  assertDimensionValue(dimension, value);
  const index = companies.findIndex((c) => c.companyId === companyId);
  const current = companies[index];
  if (current === undefined) {
    throw new RangeError(`no company ${JSON.stringify(companyId)} in this campaign`);
  }
  const next = companies.slice();
  next[index] = Object.freeze({ ...current, [dimension]: value });
  return Object.freeze(next);
}

export function assertDimensionValue(dimension: unknown, value: unknown): void {
  if (typeof dimension !== "string" || !Object.hasOwn(DIMENSION_VALUES, dimension)) {
    throw new RangeError(`unknown company dimension ${JSON.stringify(dimension)}`);
  }
  const allowed = DIMENSION_VALUES[dimension as Dimension] as readonly string[];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new RangeError(`${dimension} must be one of ${allowed.join(", ")}; got ${JSON.stringify(value)}`);
  }
}

/** Checks a whole company state, e.g. one read back from storage. */
export function assertCompanyState(value: CompanyState): void {
  for (const dimension of DIMENSIONS) {
    assertDimensionValue(dimension, value[dimension]);
  }
}
