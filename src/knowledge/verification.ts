// What the player may conclude about an observation (docs/design-doc.md §9.1): a status
// label, never a reliability percentage, and side-by-side comparisons of figures.
//
// A status is computed when it is read, from the player's own log and the current
// week, so stored observations stay immutable while their status can change: a founder
// claim becomes "conflicting evidence" once a check of the same period disagrees, and
// any figure becomes a "stale period" once it is old. Only player-facing records are
// read here; provenance never influences a status.

import type { Metric, Observation, Period, SourceKind } from "./observation.ts";

export type VerificationStatus =
  | "founder-claim"
  | "public-source"
  | "confirmed-by-check"
  | "conflicting-evidence"
  | "stale-period";

/**
 * A figure whose period ended more than this many weeks before the current week is
 * shown as stale. Balance hypothesis (§1): calibrate in playtests.
 */
export const STALE_AFTER_WEEKS = 8;

const BASIS: Readonly<Record<SourceKind, VerificationStatus>> = {
  founder: "founder-claim",
  public: "public-source",
  check: "confirmed-by-check",
};

/**
 * Status of `observation` as of `currentWeek`, given everything in `known` (the
 * player's observations; `observation` itself may be among them). Precedence:
 * conflicting evidence, then a stale period, then the basis of its source. A check
 * that disagrees only with claims keeps "confirmed by this check"; the claims it
 * contradicts become "conflicting evidence".
 */
export function verificationStatus(
  observation: Observation,
  known: readonly Observation[],
  currentWeek: number,
): VerificationStatus {
  const conflicts = conflictingObservations(observation, known);
  if (conflicts.length > 0 && (observation.source.kind !== "check" || conflicts.some((o) => o.source.kind === "check"))) {
    return "conflicting-evidence";
  }
  if (currentWeek - observation.period.toWeek > STALE_AFTER_WEEKS) {
    return "stale-period";
  }
  return BASIS[observation.source.kind];
}

/** Other metric observations of the same company and metric whose period overlaps and whose value differs. */
function conflictingObservations(observation: Observation, known: readonly Observation[]): Observation[] {
  const { content } = observation;
  if (content.kind !== "metric") return [];
  return known.filter(
    (other) =>
      other.observationId !== observation.observationId &&
      other.companyId === observation.companyId &&
      other.content.kind === "metric" &&
      other.content.metric === content.metric &&
      other.content.value !== content.value &&
      overlaps(other.period, observation.period),
  );
}

export interface ObservationComparison {
  readonly companyId: string;
  readonly metric: Metric;
  /**
   * The later figure's value minus the earlier one's, in the metric's unit. Later means
   * the later period (ties: received later, then id), so argument order does not matter.
   */
  readonly difference: number;
  /** Whether the two periods overlap, i.e. the figures describe the same time. */
  readonly samePeriod: boolean;
}

/**
 * Compares two figures of the same metric about the same company. Throws for anything else: comparing different metrics or
 * companies has no meaning, so it is a caller bug.
 */
export function compareObservations(a: Observation, b: Observation): ObservationComparison {
  if (a.content.kind !== "metric" || b.content.kind !== "metric") {
    throw new TypeError("only metric observations can be compared");
  }
  if (a.companyId !== b.companyId || a.content.metric !== b.content.metric) {
    throw new RangeError(
      `cannot compare ${a.companyId}/${a.content.metric} with ${b.companyId}/${b.content.metric}: same company and metric only`,
    );
  }
  const difference = b.content.value - a.content.value;
  return {
    companyId: a.companyId,
    metric: a.content.metric,
    difference: order(a, b) <= 0 ? difference : -difference,
    samePeriod: overlaps(a.period, b.period),
  };
}

function order(a: Observation, b: Observation): number {
  return (
    a.period.toWeek - b.period.toWeek ||
    a.period.fromWeek - b.period.fromWeek ||
    a.receivedWeek - b.receivedWeek ||
    (a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0)
  );
}

function overlaps(a: Period, b: Period): boolean {
  return a.fromWeek <= b.toWeek && b.fromWeek <= a.toWeek;
}
