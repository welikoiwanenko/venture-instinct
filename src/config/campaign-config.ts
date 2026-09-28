// Campaign configuration: the versioned balance rules a run is started with
// (docs/design-doc.md §1, §5). A campaign captures one frozen copy at
// initialization and keeps it for the whole run (§18 manifest).

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
  /** Whole US dollars. */
  readonly initialCapitalUsd: number;
  /** Whole US dollars paid for each initial investment. */
  readonly checkSizeUsd: number;
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
  "initialCapitalUsd",
  "checkSizeUsd",
  "maxInitialInvestments",
] as const;

const WINDOW_KEYS = ["firstWeek", "lastWeek"] as const;

/**
 * Checks untrusted input and returns a fresh config that shares nothing with it.
 * All issues are reported at once, each tied to the field that caused it.
 */
export function validateCampaignConfig(input: unknown): ConfigValidationResult {
  const issues: ConfigIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: "", message: `must be an object, got ${describe(input)}` }] };
  }
  rejectUnknownKeys(input, CONFIG_KEYS, "", issues);

  const id = readId(input, issues);
  const version = readInteger(input, "version", "", 1, issues);
  const investmentWindow = readWindow(input, issues);
  const horizonWeeks = readInteger(input, "horizonWeeks", "", 1, issues);
  const slotsPerWeek = readInteger(input, "slotsPerWeek", "", 1, issues);
  const initialCapitalUsd = readInteger(input, "initialCapitalUsd", "", 1, issues);
  const checkSizeUsd = readInteger(input, "checkSizeUsd", "", 1, issues);
  const maxInitialInvestments = readInteger(input, "maxInitialInvestments", "", 1, issues);

  if (investmentWindow !== undefined && horizonWeeks !== undefined && investmentWindow.lastWeek > horizonWeeks) {
    issues.push({
      path: "investmentWindow.lastWeek",
      message: `must not be after horizonWeeks (${horizonWeeks}), got ${investmentWindow.lastWeek}`,
    });
  }
  if (initialCapitalUsd !== undefined && checkSizeUsd !== undefined && maxInitialInvestments !== undefined) {
    const fullDeployment = checkSizeUsd * maxInitialInvestments;
    if (fullDeployment > initialCapitalUsd) {
      issues.push({
        path: "maxInitialInvestments",
        message:
          `${maxInitialInvestments} checks of ${checkSizeUsd} need ${fullDeployment}, ` +
          `more than initialCapitalUsd (${initialCapitalUsd})`,
      });
    }
  }

  if (
    issues.length > 0 ||
    id === undefined ||
    version === undefined ||
    investmentWindow === undefined ||
    horizonWeeks === undefined ||
    slotsPerWeek === undefined ||
    initialCapitalUsd === undefined ||
    checkSizeUsd === undefined ||
    maxInitialInvestments === undefined
  ) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    config: {
      id,
      version,
      investmentWindow,
      horizonWeeks,
      slotsPerWeek,
      initialCapitalUsd,
      checkSizeUsd,
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

function readWindow(input: Record<string, unknown>, issues: ConfigIssue[]): InvestmentWindow | undefined {
  const value = input["investmentWindow"];
  if (value === undefined) {
    issues.push({ path: "investmentWindow", message: "is required" });
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push({ path: "investmentWindow", message: `must be an object, got ${describe(value)}` });
    return undefined;
  }
  rejectUnknownKeys(value, WINDOW_KEYS, "investmentWindow", issues);
  const firstWeek = readInteger(value, "firstWeek", "investmentWindow", 1, issues);
  const lastWeek = readInteger(value, "lastWeek", "investmentWindow", 1, issues);
  if (firstWeek === undefined || lastWeek === undefined) {
    return undefined;
  }
  if (lastWeek < firstWeek) {
    issues.push({
      path: "investmentWindow.lastWeek",
      message: `must not be before investmentWindow.firstWeek (${firstWeek}), got ${lastWeek}`,
    });
    return undefined;
  }
  return { firstWeek, lastWeek };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  return typeof value;
}
