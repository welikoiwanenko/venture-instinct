// Campaign configuration: the versioned balance rules a run is started with
// (docs/design-doc.md §1, §5). A campaign captures one frozen copy at
// initialization and keeps it for the whole run (§18 manifest).

import { isPlainRecord, snapshotPlainData } from "../data/plain-data.ts";

export interface InvestmentWindow {
  /** First week (1-based, inclusive) in which initial investments are allowed. */
  readonly firstWeek: number;
  /** Last week (inclusive) in which initial investments are allowed. */
  readonly lastWeek: number;
}

export interface CampaignConfig {
  /** Stable name of the configuration line, e.g. "poc-0.1-baseline". */
  readonly id: string;
  /** Incremented whenever any balance value under this id changes. */
  readonly version: number;
  readonly investmentWindow: InvestmentWindow;
  /** Campaign ends after this many completed weeks, selection phase included. */
  readonly horizonWeeks: number;
  /** Action slots restored at the start of every week; leftovers do not carry over. */
  readonly slotsPerWeek: number;
  /** Whole US cents. */
  readonly initialCapitalCents: number;
  /** Whole US cents paid for each initial investment. */
  readonly checkSizeCents: number;
  readonly maxInitialInvestments: number;
}

export interface ConfigIssue {
  /** Dotted field path, e.g. "investmentWindow.lastWeek"; "" for the whole input. */
  readonly path: string;
  readonly message: string;
}

export type ConfigValidationResult =
  | { readonly ok: true; readonly config: CampaignConfig }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

export class InvalidCampaignConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(`Invalid campaign configuration:\n${issues.map(formatIssue).join("\n")}`);
    this.name = "InvalidCampaignConfigError";
    this.issues = issues;
  }
}

const CONFIG_KEYS = [
  "id",
  "version",
  "investmentWindow",
  "horizonWeeks",
  "slotsPerWeek",
  "initialCapitalCents",
  "checkSizeCents",
  "maxInitialInvestments",
] as const;

const WINDOW_KEYS = ["firstWeek", "lastWeek"] as const;

/**
 * Checks untrusted input and returns a fresh config that shares nothing with it.
 * All issues are reported at once, each tied to the field that caused it. The
 * input is read once; getters are reported as issues and never called.
 */
export function validateCampaignConfig(untrusted: unknown): ConfigValidationResult {
  const issues: ConfigIssue[] = [];
  // Every check below reads this one snapshot, never `untrusted` again.
  const snapshot = snapshotPlainData(untrusted);
  if (!snapshot.ok) {
    return { ok: false, issues: snapshot.issues };
  }
  const input = snapshot.value;
  if (!isPlainRecord(input)) {
    return { ok: false, issues: [{ path: "", message: `must be an object, got ${describe(input)}` }] };
  }
  rejectUnknownKeys(input, CONFIG_KEYS, "", issues);

  const id = readId(input, issues);
  const version = readInteger(input, "version", "", 1, issues);
  const { firstWeek, lastWeek } = readWindow(input, issues);
  const horizonWeeks = readInteger(input, "horizonWeeks", "", 1, issues);
  const slotsPerWeek = readInteger(input, "slotsPerWeek", "", 1, issues);
  const initialCapitalCents = readInteger(input, "initialCapitalCents", "", 1, issues);
  const checkSizeCents = readInteger(input, "checkSizeCents", "", 1, issues);
  const maxInitialInvestments = readInteger(input, "maxInitialInvestments", "", 1, issues);

  // Cross-field checks run whenever their own inputs are valid, so one bad field
  // never hides an unrelated inconsistency.
  if (firstWeek !== undefined && lastWeek !== undefined && lastWeek < firstWeek) {
    issues.push({
      path: "investmentWindow.lastWeek",
      message: `must not be before investmentWindow.firstWeek (${firstWeek}), got ${lastWeek}`,
    });
  }
  if (lastWeek !== undefined && horizonWeeks !== undefined && lastWeek > horizonWeeks) {
    issues.push({
      path: "investmentWindow.lastWeek",
      message: `must not be after horizonWeeks (${horizonWeeks}), got ${lastWeek}`,
    });
  }
  if (initialCapitalCents !== undefined && checkSizeCents !== undefined && maxInitialInvestments !== undefined) {
    const fullDeployment = checkSizeCents * maxInitialInvestments;
    // An unsafe product is necessarily larger than any safe initialCapitalCents.
    if (!Number.isSafeInteger(fullDeployment) || fullDeployment > initialCapitalCents) {
      issues.push({
        path: "maxInitialInvestments",
        message:
          `${maxInitialInvestments} checks of ${checkSizeCents} need ${fullDeployment}, ` +
          `more than initialCapitalCents (${initialCapitalCents})`,
      });
    }
  }

  if (
    issues.length > 0 ||
    id === undefined ||
    version === undefined ||
    firstWeek === undefined ||
    lastWeek === undefined ||
    horizonWeeks === undefined ||
    slotsPerWeek === undefined ||
    initialCapitalCents === undefined ||
    checkSizeCents === undefined ||
    maxInitialInvestments === undefined
  ) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    config: {
      id,
      version,
      investmentWindow: { firstWeek, lastWeek },
      horizonWeeks,
      slotsPerWeek,
      initialCapitalCents,
      checkSizeCents,
      maxInitialInvestments,
    },
  };
}

/**
 * Validates and snapshots a configuration for campaign initialization. The result
 * is deeply frozen and independent of `input`, so later edits to defaults or to
 * the input object cannot change a running campaign.
 */
export function captureCampaignConfig(input: unknown): CampaignConfig {
  const result = validateCampaignConfig(input);
  if (!result.ok) {
    throw new InvalidCampaignConfigError(result.issues);
  }
  Object.freeze(result.config.investmentWindow);
  return Object.freeze(result.config);
}

export function formatIssue(issue: ConfigIssue): string {
  return `${issue.path === "" ? "(config)" : issue.path}: ${issue.message}`;
}

function readId(input: Record<string, unknown>, issues: ConfigIssue[]): string | undefined {
  const value = input["id"];
  if (value === undefined) {
    issues.push({ path: "id", message: "is required" });
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    issues.push({ path: "id", message: `must be a non-empty string without surrounding spaces, got ${describe(value)}` });
    return undefined;
  }
  return value;
}

function readWindow(
  input: Record<string, unknown>,
  issues: ConfigIssue[],
): { firstWeek: number | undefined; lastWeek: number | undefined } {
  const value = input["investmentWindow"];
  if (value === undefined) {
    issues.push({ path: "investmentWindow", message: "is required" });
    return { firstWeek: undefined, lastWeek: undefined };
  }
  if (!isPlainRecord(value)) {
    issues.push({ path: "investmentWindow", message: `must be an object, got ${describe(value)}` });
    return { firstWeek: undefined, lastWeek: undefined };
  }
  rejectUnknownKeys(value, WINDOW_KEYS, "investmentWindow", issues);
  return {
    firstWeek: readInteger(value, "firstWeek", "investmentWindow", 1, issues),
    lastWeek: readInteger(value, "lastWeek", "investmentWindow", 1, issues),
  };
}

function readInteger(
  record: Record<string, unknown>,
  key: string,
  parent: string,
  min: number,
  issues: ConfigIssue[],
): number | undefined {
  const path = parent === "" ? key : `${parent}.${key}`;
  const value = record[key];
  if (value === undefined) {
    issues.push({ path, message: "is required" });
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    issues.push({ path, message: `must be an integer, got ${describe(value)}` });
    return undefined;
  }
  if (value < min) {
    issues.push({ path, message: `must be at least ${min}, got ${value}` });
    return undefined;
  }
  return value;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  parent: string,
  issues: ConfigIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      issues.push({ path: parent === "" ? key : `${parent}.${key}`, message: "is not a known setting" });
    }
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  return typeof value;
}
