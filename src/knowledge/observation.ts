// Player observations: dated, sourced evidence (docs/design-doc.md §3 principles 2 and 5,
// §9.1, §14.1, §18). The world holds the true state; the player holds only what was
// delivered to them, which may be incomplete or wrong. An observation never changes the
// hidden state, and once stored it never changes itself: a new figure is a new
// observation, so the log is append-only.
//
// Each stored entry has two halves:
// - `Observation` is the player-facing record. It is the only half a player API may
//   return, and it has no field that reveals truth or intent.
// - `ObservationProvenance` is internal: the true value of the fact the observation
//   refers to and, when the two differ, the structured reason for the gap (§14.1: lies
//   and mistakes have a reason, never random noise). It is for debug views only.
//
// Weeks: `receivedWeek` is the campaign week the observation arrived (1-based). A period
// may reach before the campaign: week 0 is the last week before it started, -3 the
// fourth-last. Periods are inclusive.

import { deepFreeze, snapshotPlainData, withSnapshotIssues } from "../data/plain-data.ts";
import {
  childPath,
  readArray,
  readEnum,
  readId,
  readInteger,
  readRecord,
  readText,
  rejectUnknownKeys,
  type ContentIssue,
} from "../content/fields.ts";

/**
 * Where an observation came from. The kind decides its basic verification status: a
 * founder's word, a public source, or the player's own check (research).
 */
export const SOURCE_KINDS = ["founder", "public", "check"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface ObservationSource {
  readonly kind: SourceKind;
  /** Who said it: a founder id, a publication, or the check that produced it. */
  readonly author: string;
}

export interface Period {
  readonly fromWeek: number;
  readonly toWeek: number;
}

/** Metrics an observation can state, with the unit of their integer value. */
export const METRICS = {
  payingCustomers: "customers",
  weeklyRevenueCents: "cents",
  weeklyPriceCents: "cents",
  weeklyBurnCents: "cents",
  cashCents: "cents",
  teamSize: "people",
  largestCustomerShareBps: "basis points",
} as const;
export type Metric = keyof typeof METRICS;
export const METRIC_NAMES = Object.keys(METRICS) as readonly Metric[];

export type ObservationContent =
  | { readonly kind: "metric"; readonly metric: Metric; readonly value: number }
  /** `title` is the one-line short form of `text`, e.g. an application's summary. */
  | { readonly kind: "text"; readonly title: string; readonly text: string };

export interface Observation {
  readonly observationId: string;
  readonly companyId: string;
  readonly source: ObservationSource;
  readonly receivedWeek: number;
  /** The period the fact refers to, which is not the week it arrived. */
  readonly period: Period;
  readonly content: ObservationContent;
  /** Earlier observations of the same company this one builds on, e.g. its application. */
  readonly references: readonly string[];
}

export const DISTORTION_REASONS = [
  "optimistic-founder-claim",
  "counts-pilots-as-paying",
  "excludes-contractor-costs",
  "stale-figure",
  "honest-mistake",
  "outdated-public-source",
] as const;
export type DistortionReason = (typeof DISTORTION_REASONS)[number];

export interface Distortion {
  readonly reason: DistortionReason;
  /** What exactly is off, for authors and debug. */
  readonly note: string;
}

/** Internal half of an entry. Never part of player-facing data. */
export interface ObservationProvenance {
  readonly observationId: string;
  /** The true value of the stated metric for the observation's period (metric observations only). */
  readonly fact?: { readonly value: number };
  /** Required exactly when the stated value differs from the fact. */
  readonly distortion?: Distortion;
}

export interface ObservationLog {
  /** Player-facing records in the order they were stored. */
  readonly observations: readonly Observation[];
  /** Internal records, one per observation, in the same order. */
  readonly provenance: readonly ObservationProvenance[];
}

export type AppendResult =
  | { readonly ok: true; readonly log: ObservationLog }
  | { readonly ok: false; readonly issues: readonly ContentIssue[] };

/** Earliest week a period may start: ten years before the campaign. */
const EARLIEST_WEEK = -520;

const OBSERVATION_KEYS = ["observationId", "companyId", "source", "receivedWeek", "period", "content", "references"] as const;
const PROVENANCE_KEYS = ["fact", "distortion"] as const;

export const EMPTY_OBSERVATION_LOG: ObservationLog = deepFreeze({ observations: [], provenance: [] });

/**
 * Validates one new entry and returns a new log with it appended; `log` itself is never
 * changed. Rejection returns every issue and leaves nothing half-stored. Stored entries
 * are deeply frozen, so they cannot be edited afterwards.
 */
export function appendObservation(
  log: ObservationLog,
  input: { readonly observation: unknown; readonly provenance?: unknown },
): AppendResult {
  const snapshot = snapshotPlainData({ observation: input.observation, provenance: input.provenance ?? {} });
  const issues: ContentIssue[] = [];
  const value = snapshot.value as { observation: unknown; provenance: unknown } | undefined;
  const observation = checkObservation(value?.observation, "observation", log, issues);
  const provenance = checkProvenance(value?.provenance, "provenance", observation, issues);
  const all = withSnapshotIssues(snapshot.issues, issues);
  if (all.length > 0 || observation === undefined || provenance === undefined) {
    return { ok: false, issues: all };
  }
  return {
    ok: true,
    log: Object.freeze({
      observations: Object.freeze([...log.observations, deepFreeze(observation)]),
      provenance: Object.freeze([...log.provenance, deepFreeze(provenance)]),
    }),
  };
}

/** Appends several entries in order, or none of them. */
export function appendObservations(
  log: ObservationLog,
  inputs: ReadonlyArray<{ readonly observation: unknown; readonly provenance?: unknown }>,
): AppendResult {
  let current = log;
  for (const [index, input] of inputs.entries()) {
    const result = appendObservation(current, input);
    if (!result.ok) {
      return { ok: false, issues: result.issues.map((i) => ({ path: `[${index}].${i.path}`, message: i.message })) };
    }
    current = result.log;
  }
  return { ok: true, log: current };
}

export function provenanceOf(log: ObservationLog, observationId: string): ObservationProvenance | undefined {
  return log.provenance.find((p) => p.observationId === observationId);
}

function checkObservation(value: unknown, path: string, log: ObservationLog, issues: ContentIssue[]): Observation | undefined {
  const start = issues.length;
  const record = readRecord(value, path, issues);
  if (record === undefined) return undefined;
  rejectUnknownKeys(record, OBSERVATION_KEYS, path, issues);

  const observationId = readId(record, "observationId", path, issues);
  if (observationId !== undefined && log.observations.some((o) => o.observationId === observationId)) {
    issues.push({
      path: childPath(path, "observationId"),
      message: `${JSON.stringify(observationId)} is already stored; stored observations never change, add a new one instead`,
    });
  }
  const companyId = readId(record, "companyId", path, issues);
  const source = readSource(record["source"], childPath(path, "source"), issues);
  const receivedWeek = readInteger(record, "receivedWeek", path, { min: 1 }, issues);
  const period = readPeriod(record["period"], childPath(path, "period"), receivedWeek, issues);
  const content = readContent(record["content"], childPath(path, "content"), issues);
  const references = readReferences(record["references"], childPath(path, "references"), companyId, log, issues);

  if (
    issues.length > start ||
    observationId === undefined ||
    companyId === undefined ||
    source === undefined ||
    receivedWeek === undefined ||
    period === undefined ||
    content === undefined ||
    references === undefined
  ) {
    return undefined;
  }
  return { observationId, companyId, source, receivedWeek, period, content, references };
}

function readSource(value: unknown, path: string, issues: ContentIssue[]): ObservationSource | undefined {
  const record = readRecord(value, path, issues);
  if (record === undefined) return undefined;
  rejectUnknownKeys(record, ["kind", "author"], path, issues);
  const kind = readEnum(record, "kind", path, SOURCE_KINDS, issues);
  const author = readText(record, "author", path, issues);
  return kind === undefined || author === undefined ? undefined : { kind, author };
}

function readPeriod(value: unknown, path: string, receivedWeek: number | undefined, issues: ContentIssue[]): Period | undefined {
  const record = readRecord(value, path, issues);
  if (record === undefined) return undefined;
  rejectUnknownKeys(record, ["fromWeek", "toWeek"], path, issues);
  const weeks = { min: EARLIEST_WEEK };
  const fromWeek = readInteger(record, "fromWeek", path, weeks, issues);
  const toWeek = readInteger(record, "toWeek", path, weeks, issues);
  if (fromWeek === undefined || toWeek === undefined) return undefined;
  if (toWeek < fromWeek) {
    issues.push({ path: childPath(path, "toWeek"), message: `must not be before fromWeek (${fromWeek}), got ${toWeek}` });
    return undefined;
  }
  if (receivedWeek !== undefined && toWeek > receivedWeek) {
    issues.push({
      path: childPath(path, "toWeek"),
      message: `must not be after receivedWeek (${receivedWeek}): nobody reports on the future, got ${toWeek}`,
    });
    return undefined;
  }
  return { fromWeek, toWeek };
}

function readContent(value: unknown, path: string, issues: ContentIssue[]): ObservationContent | undefined {
  const record = readRecord(value, path, issues);
  if (record === undefined) return undefined;
  const kind = readEnum(record, "kind", path, ["metric", "text"] as const, issues);
  if (kind === "metric") {
    rejectUnknownKeys(record, ["kind", "metric", "value"], path, issues);
    const metric = readEnum(record, "metric", path, METRIC_NAMES, issues);
    const min = metric === "cashCents" ? Number.MIN_SAFE_INTEGER : 0;
    const value = readInteger(record, "value", path, { min, unit: metric === undefined ? "units" : METRICS[metric] }, issues);
    return metric === undefined || value === undefined ? undefined : { kind, metric, value };
  }
  if (kind === "text") {
    rejectUnknownKeys(record, ["kind", "title", "text"], path, issues);
    const title = readText(record, "title", path, issues);
    const text = readText(record, "text", path, issues);
    return title === undefined || text === undefined ? undefined : { kind, title, text };
  }
  return undefined;
}

function readReferences(
  value: unknown,
  path: string,
  companyId: string | undefined,
  log: ObservationLog,
  issues: ContentIssue[],
): string[] | undefined {
  const items = readArray(value, path, issues);
  if (items === undefined) return undefined;
  const start = issues.length;
  const references: string[] = [];
  items.forEach((item, index) => {
    const itemPath = childPath(path, index);
    const earlier = log.observations.find((o) => o.observationId === item);
    if (typeof item !== "string" || earlier === undefined) {
      issues.push({ path: itemPath, message: `must be the id of an earlier stored observation, got ${JSON.stringify(item)}` });
    } else if (companyId !== undefined && earlier.companyId !== companyId) {
      issues.push({ path: itemPath, message: `${JSON.stringify(item)} is about ${earlier.companyId}, not ${companyId}` });
    } else if (references.includes(item)) {
      issues.push({ path: itemPath, message: `${JSON.stringify(item)} is listed twice` });
    } else {
      references.push(item);
    }
  });
  return issues.length > start ? undefined : references;
}

function checkProvenance(
  value: unknown,
  path: string,
  observation: Observation | undefined,
  issues: ContentIssue[],
): ObservationProvenance | undefined {
  const start = issues.length;
  const record = readRecord(value, path, issues);
  if (record === undefined || observation === undefined) return undefined;
  rejectUnknownKeys(record, PROVENANCE_KEYS, path, issues);
  const content = observation.content;

  let fact: { value: number } | undefined;
  const factPath = childPath(path, "fact");
  if (content.kind === "metric") {
    const factRecord = readRecord(record["fact"], factPath, issues);
    if (factRecord !== undefined) {
      rejectUnknownKeys(factRecord, ["value"], factPath, issues);
      const min = content.metric === "cashCents" ? Number.MIN_SAFE_INTEGER : 0;
      const factValue = readInteger(factRecord, "value", factPath, { min, unit: METRICS[content.metric] }, issues);
      if (factValue !== undefined) fact = { value: factValue };
    }
  } else if (record["fact"] !== undefined) {
    issues.push({ path: factPath, message: "only a metric observation has a fact value" });
  }

  let distortion: Distortion | undefined;
  const distortionPath = childPath(path, "distortion");
  if (record["distortion"] !== undefined) {
    const distortionRecord = readRecord(record["distortion"], distortionPath, issues);
    if (distortionRecord !== undefined) {
      rejectUnknownKeys(distortionRecord, ["reason", "note"], distortionPath, issues);
      const reason = readEnum(distortionRecord, "reason", distortionPath, DISTORTION_REASONS, issues);
      const note = readText(distortionRecord, "note", distortionPath, issues);
      if (reason !== undefined && note !== undefined) distortion = { reason, note };
    }
  }

  // A gap between claim and truth always has a stated reason, and only a gap has one.
  if (content.kind === "metric" && fact !== undefined && record["distortion"] === undefined && fact.value !== content.value) {
    issues.push({
      path: distortionPath,
      message: `is required: the observation states ${content.value} but the fact is ${fact.value} (§14.1)`,
    });
  }
  if (content.kind === "metric" && fact !== undefined && distortion !== undefined && fact.value === content.value) {
    issues.push({ path: distortionPath, message: `must be absent: the stated value equals the fact (${fact.value})` });
  }

  if (issues.length > start) return undefined;
  return {
    observationId: observation.observationId,
    ...(fact === undefined ? {} : { fact }),
    ...(distortion === undefined ? {} : { distortion }),
  };
}
