// Authored company profiles (docs/design-doc.md §5, §10.1–10.3). A profile sets a
// company's starting conditions: who it is, what the player may learn about it
// publicly, and its hidden causal state. It never says how good the company is or
// how its story ends: there is no quality score, winner flag, predetermined exit or
// guaranteed outcome, and fields that look like one are rejected (§3.1, §10.1).
//
// Units: money in whole US cents, shares and ratios in basis points (10_000 = 100%),
// product fit on the 0–100 scale of §10.3.

import { BASIS_POINTS_WHOLE } from "../campaign/shares.ts";
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
} from "./fields.ts";

export const SECTORS = ["developer-tools", "business-process-automation", "logistics-software"] as const;
export type Sector = (typeof SECTORS)[number];

/** PoC 0.1 models one business model (§5): B2B software with recurring payments. */
export const BUSINESS_MODELS = ["b2b-recurring-software"] as const;
export type BusinessModel = (typeof BUSINESS_MODELS)[number];

export const SPECIALIZATIONS = ["engineering", "product", "design", "sales", "operations", "finance"] as const;
export type Specialization = (typeof SPECIALIZATIONS)[number];

/** Current founder strategy (§10.2). */
export const FOUNDER_STRATEGIES = ["product", "growth", "conserve", "fundraising", "pivot"] as const;
export type FounderStrategy = (typeof FOUNDER_STRATEGIES)[number];

/**
 * What the player knows about the company when the campaign starts: `inbound` companies
 * applied in the first wave (§8.1); `unknown` ones exist in the world but must be
 * discovered.
 */
export const INITIAL_KNOWLEDGE = ["inbound", "unknown"] as const;
export type InitialKnowledge = (typeof INITIAL_KNOWLEDGE)[number];

export const PRODUCT_FIT_MAX = 100;

export interface FounderProfile {
  readonly id: string;
  readonly name: string;
  readonly specialization: Specialization;
}

/** One line of the team: people of one specialization, founders included. */
export interface TeamLine {
  readonly specialization: Specialization;
  readonly headcount: number;
  /** Whole US cents per week for the whole line. */
  readonly weeklyCostCents: number;
  /** Output per person relative to nominal, in basis points (10_000 = nominal). */
  readonly productivityBps: number;
}

export interface FounderConflict {
  readonly id: string;
  /** Two or more founders of the same company. */
  readonly founderIds: readonly string[];
  readonly topic: string;
}

/** The true starting state (§10.2). Never shown to the player directly. */
export interface HiddenStartingState {
  readonly cashCents: number;
  readonly weeklyPriceCents: number;
  readonly payingCustomers: number;
  /** Share of revenue from the largest customer, in basis points. */
  readonly largestCustomerShareBps: number;
  /** Qualified leads per week from the company's own sales channel (§10.3 adjusted_base_leads). */
  readonly baseWeeklyLeads: number;
  /** Fit for the current segment, 0–100 (§10.3). */
  readonly productFit: number;
  readonly team: readonly TeamLine[];
  /** Non-staff operating costs: tools, rent, hosting. Whole US cents per week. */
  readonly otherWeeklyCostsCents: number;
  /** How aligned the founders are, in basis points (10_000 = fully aligned). */
  readonly founderAlignmentBps: number;
  readonly unresolvedConflicts: readonly FounderConflict[];
  readonly strategy: FounderStrategy;
}

export interface CompanyProfile {
  readonly id: string;
  /** Public name. */
  readonly name: string;
  readonly sector: Sector;
  readonly businessModel: BusinessModel;
  /** Public description, player-facing language (§2). */
  readonly description: string;
  readonly founders: readonly FounderProfile[];
  readonly initialKnowledge: InitialKnowledge;
  readonly hidden: HiddenStartingState;
  /** Why this company is in the pack and what its trade-off is. Authors and debug only. */
  readonly authoringNote?: string;
}

const COMPANY_KEYS = [
  "id",
  "name",
  "sector",
  "businessModel",
  "description",
  "founders",
  "initialKnowledge",
  "hidden",
  "authoringNote",
] as const;
const FOUNDER_KEYS = ["id", "name", "specialization"] as const;
const HIDDEN_KEYS = [
  "cashCents",
  "weeklyPriceCents",
  "payingCustomers",
  "largestCustomerShareBps",
  "baseWeeklyLeads",
  "productFit",
  "team",
  "otherWeeklyCostsCents",
  "founderAlignmentBps",
  "unresolvedConflicts",
  "strategy",
] as const;
const TEAM_KEYS = ["specialization", "headcount", "weeklyCostCents", "productivityBps"] as const;
const CONFLICT_KEYS = ["id", "founderIds", "topic"] as const;

/**
 * Field names that would rate a company or fix its fate. Matched on whole camelCase
 * words anywhere in a profile, so `qualityScore`, `isWinner` and `plannedExit` are all
 * caught while a field such as `productFit` is not.
 */
const FORBIDDEN_WORDS = new Set([
  "quality",
  "score",
  "rating",
  "rank",
  "tier",
  "winner",
  "loser",
  "exit",
  "outcome",
  "guaranteed",
  "destiny",
  "fate",
]);

export function isForbiddenField(key: string): boolean {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .some((word) => FORBIDDEN_WORDS.has(word.toLowerCase()));
}

const FORBIDDEN_MESSAGE =
  "is forbidden: a profile sets starting conditions, not a quality score, winner flag, exit or outcome (§3.1, §10.1)";

const ECONOMICS_HINT = "§10.3 cannot simulate the company without it";

/** Validates one company. `path` names it in issues, e.g. "scenario.content.companies[0]". */
export function checkCompanyProfile(value: unknown, path: string, issues: ContentIssue[]): CompanyProfile | undefined {
  const start = issues.length;
  const record = readRecord(value, path, issues);
  if (record === undefined) return undefined;
  reportForbiddenFields(record, path, issues);
  rejectUnknownKeys(record, COMPANY_KEYS, path, issues, isForbiddenField);

  const id = readId(record, "id", path, issues);
  const name = readText(record, "name", path, issues);
  const sector = readEnum(record, "sector", path, SECTORS, issues);
  const businessModel = readEnum(record, "businessModel", path, BUSINESS_MODELS, issues);
  const description = readText(record, "description", path, issues);
  const founders = readFounders(record["founders"], childPath(path, "founders"), issues);
  const initialKnowledge = readEnum(record, "initialKnowledge", path, INITIAL_KNOWLEDGE, issues);
  const hidden = readHidden(record["hidden"], childPath(path, "hidden"), founders, issues);
  const authoringNote = record["authoringNote"] === undefined ? undefined : readText(record, "authoringNote", path, issues);

  if (
    issues.length > start ||
    id === undefined ||
    name === undefined ||
    sector === undefined ||
    businessModel === undefined ||
    description === undefined ||
    founders === undefined ||
    initialKnowledge === undefined ||
    hidden === undefined
  ) {
    return undefined;
  }
  return {
    id,
    name,
    sector,
    businessModel,
    description,
    founders,
    initialKnowledge,
    hidden,
    ...(authoringNote === undefined ? {} : { authoringNote }),
  };
}

function reportForbiddenFields(value: unknown, path: string, issues: ContentIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => reportForbiddenFields(item, childPath(path, index), issues));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenField(key)) {
      issues.push({ path: childPath(path, key), message: FORBIDDEN_MESSAGE });
    } else {
      reportForbiddenFields(child, childPath(path, key), issues);
    }
  }
}

function readFounders(value: unknown, path: string, issues: ContentIssue[]): FounderProfile[] | undefined {
  const items = readArray(value, path, issues);
  if (items === undefined) return undefined;
  if (items.length < 1 || items.length > 3) {
    issues.push({ path, message: `must list 1 to 3 founders, got ${items.length}` });
  }
  const start = issues.length;
  const founders = items.map((item, index) => {
    const itemPath = childPath(path, index);
    const record = readRecord(item, itemPath, issues);
    if (record === undefined) return undefined;
    rejectUnknownKeys(record, FOUNDER_KEYS, itemPath, issues, isForbiddenField);
    const id = readId(record, "id", itemPath, issues);
    const name = readText(record, "name", itemPath, issues);
    const specialization = readEnum(record, "specialization", itemPath, SPECIALIZATIONS, issues);
    return id === undefined || name === undefined || specialization === undefined ? undefined : { id, name, specialization };
  });
  return issues.length > start || founders.some((f) => f === undefined) ? undefined : (founders as FounderProfile[]);
}

function readHidden(
  value: unknown,
  path: string,
  founders: readonly FounderProfile[] | undefined,
  issues: ContentIssue[],
): HiddenStartingState | undefined {
  const start = issues.length;
  const record = readRecord(value, path, issues);
  if (record === undefined) return undefined;
  rejectUnknownKeys(record, HIDDEN_KEYS, path, issues, isForbiddenField);

  const cents = { min: 0, unit: "cents" };
  const cashCents = readInteger(record, "cashCents", path, cents, issues, ECONOMICS_HINT);
  const weeklyPriceCents = readInteger(record, "weeklyPriceCents", path, { min: 1, unit: "cents" }, issues, ECONOMICS_HINT);
  const payingCustomers = readInteger(record, "payingCustomers", path, { min: 0, unit: "customers" }, issues, ECONOMICS_HINT);
  const largestCustomerShareBps = readInteger(
    record,
    "largestCustomerShareBps",
    path,
    { min: 0, max: BASIS_POINTS_WHOLE, unit: "basis points" },
    issues,
    ECONOMICS_HINT,
  );
  const baseWeeklyLeads = readInteger(record, "baseWeeklyLeads", path, { min: 0, unit: "leads" }, issues, ECONOMICS_HINT);
  const productFit = readInteger(record, "productFit", path, { min: 0, max: PRODUCT_FIT_MAX }, issues, ECONOMICS_HINT);
  const team = readTeam(record["team"], childPath(path, "team"), issues);
  const otherWeeklyCostsCents = readInteger(record, "otherWeeklyCostsCents", path, cents, issues, ECONOMICS_HINT);
  const founderAlignmentBps = readInteger(
    record,
    "founderAlignmentBps",
    path,
    { min: 0, max: BASIS_POINTS_WHOLE, unit: "basis points" },
    issues,
  );
  const unresolvedConflicts = readConflicts(record["unresolvedConflicts"], childPath(path, "unresolvedConflicts"), founders, issues);
  const strategy = readEnum(record, "strategy", path, FOUNDER_STRATEGIES, issues);

  // Cross-field checks run whenever their own inputs are valid.
  if (payingCustomers !== undefined && largestCustomerShareBps !== undefined) {
    if (payingCustomers === 0 && largestCustomerShareBps !== 0) {
      issues.push({
        path: childPath(path, "largestCustomerShareBps"),
        message: `must be 0 when there are no paying customers, got ${largestCustomerShareBps}`,
      });
    }
    const floor = payingCustomers === 0 ? 0 : Math.ceil(BASIS_POINTS_WHOLE / payingCustomers);
    if (payingCustomers > 0 && largestCustomerShareBps < floor) {
      issues.push({
        path: childPath(path, "largestCustomerShareBps"),
        message: `the largest of ${payingCustomers} customers has at least ${floor} basis points, got ${largestCustomerShareBps}`,
      });
    }
  }
  if (team !== undefined && founders !== undefined) {
    const headcount = team.reduce((sum, line) => sum + line.headcount, 0);
    if (headcount < founders.length) {
      issues.push({
        path: childPath(path, "team"),
        message: `must include the ${founders.length} founders, but its headcount is ${headcount}`,
      });
    }
  }

  if (
    issues.length > start ||
    cashCents === undefined ||
    weeklyPriceCents === undefined ||
    payingCustomers === undefined ||
    largestCustomerShareBps === undefined ||
    baseWeeklyLeads === undefined ||
    productFit === undefined ||
    team === undefined ||
    otherWeeklyCostsCents === undefined ||
    founderAlignmentBps === undefined ||
    unresolvedConflicts === undefined ||
    strategy === undefined
  ) {
    return undefined;
  }
  return {
    cashCents,
    weeklyPriceCents,
    payingCustomers,
    largestCustomerShareBps,
    baseWeeklyLeads,
    productFit,
    team,
    otherWeeklyCostsCents,
    founderAlignmentBps,
    unresolvedConflicts,
    strategy,
  };
}

function readTeam(value: unknown, path: string, issues: ContentIssue[]): TeamLine[] | undefined {
  const items = readArray(value, path, issues, ECONOMICS_HINT);
  if (items === undefined) return undefined;
  if (items.length === 0) {
    issues.push({ path, message: "must have at least one line" });
    return undefined;
  }
  const start = issues.length;
  const seen = new Set<string>();
  const lines = items.map((item, index) => {
    const itemPath = childPath(path, index);
    const record = readRecord(item, itemPath, issues);
    if (record === undefined) return undefined;
    rejectUnknownKeys(record, TEAM_KEYS, itemPath, issues, isForbiddenField);
    const specialization = readEnum(record, "specialization", itemPath, SPECIALIZATIONS, issues);
    const headcount = readInteger(record, "headcount", itemPath, { min: 1, unit: "people" }, issues);
    const weeklyCostCents = readInteger(record, "weeklyCostCents", itemPath, { min: 0, unit: "cents" }, issues, ECONOMICS_HINT);
    const productivityBps = readInteger(
      record,
      "productivityBps",
      itemPath,
      { min: 0, max: 2 * BASIS_POINTS_WHOLE, unit: "basis points" },
      issues,
      ECONOMICS_HINT,
    );
    if (specialization !== undefined) {
      if (seen.has(specialization)) {
        issues.push({ path: childPath(itemPath, "specialization"), message: `${specialization} already has a line` });
      }
      seen.add(specialization);
    }
    return specialization === undefined ||
      headcount === undefined ||
      weeklyCostCents === undefined ||
      productivityBps === undefined
      ? undefined
      : { specialization, headcount, weeklyCostCents, productivityBps };
  });
  return issues.length > start || lines.some((l) => l === undefined) ? undefined : (lines as TeamLine[]);
}

function readConflicts(
  value: unknown,
  path: string,
  founders: readonly FounderProfile[] | undefined,
  issues: ContentIssue[],
): FounderConflict[] | undefined {
  const items = readArray(value, path, issues);
  if (items === undefined) return undefined;
  const start = issues.length;
  const ids = new Set<string>();
  const founderIds = founders === undefined ? undefined : new Set(founders.map((f) => f.id));
  const conflicts = items.map((item, index) => {
    const itemPath = childPath(path, index);
    const record = readRecord(item, itemPath, issues);
    if (record === undefined) return undefined;
    rejectUnknownKeys(record, CONFLICT_KEYS, itemPath, issues, isForbiddenField);
    const id = readId(record, "id", itemPath, issues);
    if (id !== undefined) {
      if (ids.has(id)) issues.push({ path: childPath(itemPath, "id"), message: `duplicates conflict id ${JSON.stringify(id)}` });
      ids.add(id);
    }
    const topic = readText(record, "topic", itemPath, issues);
    const partiesPath = childPath(itemPath, "founderIds");
    const parties = readArray(record["founderIds"], partiesPath, issues);
    let checked: string[] | undefined;
    if (parties !== undefined) {
      checked = [];
      parties.forEach((party, partyIndex) => {
        const partyPath = childPath(partiesPath, partyIndex);
        if (typeof party !== "string") {
          issues.push({ path: partyPath, message: `must be a founder id, got ${typeof party}` });
        } else if (founderIds !== undefined && !founderIds.has(party)) {
          issues.push({ path: partyPath, message: `${JSON.stringify(party)} is not a founder of this company` });
        } else if (checked?.includes(party)) {
          issues.push({ path: partyPath, message: `${JSON.stringify(party)} is listed twice` });
        } else {
          checked?.push(party);
        }
      });
      if (parties.length < 2) {
        issues.push({ path: partiesPath, message: `a conflict needs at least 2 founders, got ${parties.length}` });
      }
    }
    return id === undefined || topic === undefined || checked === undefined ? undefined : { id, founderIds: checked, topic };
  });
  return issues.length > start || conflicts.some((c) => c === undefined) ? undefined : (conflicts as FounderConflict[]);
}
