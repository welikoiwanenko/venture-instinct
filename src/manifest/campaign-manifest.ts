// Campaign manifest: everything needed to reproduce a campaign's starting state
// (docs/design-doc.md §17.2, §18). It records inputs and version identities only;
// wall-clock time, locale and host details are deliberately absent.

import {
  validateCampaignConfig,
  type CampaignConfig,
} from "../config/campaign-config.ts";
import { createInitialCampaignState, type CampaignState } from "../campaign/initial-state.ts";
import { validateScenarioPack, type ScenarioPack } from "../content/scenario-pack.ts";
import { deepFreeze, isPlainRecord, snapshotPlainData, withSnapshotIssues } from "../data/plain-data.ts";
import { canonicalHash, canonicalJson } from "./canonical-json.ts";

/** Versions owned by the engine code. Bump one whenever its behaviour changes. */
export interface EngineVersions {
  /** Domain rules: week order, actions, lifecycle. */
  readonly simulation: number;
  /**
   * The future keyed-RNG contract (§18). Recorded now so every manifest names it;
   * no random draws exist yet, so the seed does not influence the starting state.
   */
  readonly rng: number;
  /**
   * Financial arithmetic and rounding: money in whole cents, shares in basis points
   * rounded down (src/campaign/money.ts, src/campaign/shares.ts).
   * v1 was whole dollars.
   */
  readonly math: number;
}

// simulation v2: the initial state lists every company of the pack with its §8.3
// dimensions and holds the player's observation log with the week 1 applications.
// simulation v3: the state records delivered research (empty at the start).
export const ENGINE_VERSIONS: EngineVersions = Object.freeze({ simulation: 3, rng: 1, math: 2 });

export const MANIFEST_FORMAT = 1;

export interface CampaignManifest {
  readonly format: typeof MANIFEST_FORMAT;
  /** Derived from the rest of the manifest, so identical inputs give identical ids. */
  readonly campaignId: string;
  readonly seed: string;
  readonly scenario: {
    readonly id: string;
    /** `canonicalHash` of the whole scenario pack. */
    readonly contentHash: string;
  };
  readonly versions: {
    readonly simulation: number;
    readonly content: number;
    readonly config: number;
    readonly rng: number;
    readonly math: number;
  };
  readonly config: CampaignConfig;
  readonly configHash: string;
  readonly initialState: CampaignState;
  readonly initialStateHash: string;
}

export interface ManifestInput {
  readonly seed: unknown;
  /** A scenario pack (src/content/scenario-pack.ts): `{ id, contentVersion, content }`. */
  readonly scenario: unknown;
  readonly config: unknown;
  /** Defaults to ENGINE_VERSIONS; overridable so tests can prove each version is required. */
  readonly engine?: unknown;
}

export interface ManifestIssue {
  /** Dotted input path, e.g. "scenario.contentVersion" or "config.slotsPerWeek". */
  readonly path: string;
  readonly message: string;
}

export type ManifestResult =
  /** `pack` is the validated, deeply frozen scenario the manifest's content hash describes. */
  | { readonly ok: true; readonly manifest: CampaignManifest; readonly pack: ScenarioPack }
  | { readonly ok: false; readonly issues: readonly ManifestIssue[] };

const SEED_PATTERN = /^[\x21-\x7e]{1,128}$/;
const ENGINE_KEYS = ["simulation", "rng", "math"] as const;

/**
 * Validates every input, reporting all issues at once, and builds a deeply frozen
 * manifest that shares nothing with the inputs. Pure: nothing is read from the host.
 * Each input is read once into a snapshot; its validation, metadata and hash all
 * come from that snapshot, and getters are rejected without being called.
 */
export function createCampaignManifest(input: ManifestInput): ManifestResult {
  const issues: ManifestIssue[] = [];

  const seed = readSeed(input.seed, issues);
  const scenario = readScenario(input.scenario, issues);
  const engine = readEngine(input.engine === undefined ? ENGINE_VERSIONS : input.engine, issues);
  const configResult = validateCampaignConfig(input.config);
  if (!configResult.ok) {
    for (const issue of configResult.issues) {
      issues.push({ path: issue.path === "" ? "config" : `config.${issue.path}`, message: issue.message });
    }
  }

  if (issues.length > 0 || seed === undefined || scenario === undefined || engine === undefined || !configResult.ok) {
    return { ok: false, issues };
  }

  const config = configResult.config;
  const initialState = createInitialCampaignState(config, scenario.pack.content.companies);
  const body = {
    format: MANIFEST_FORMAT,
    seed,
    scenario: { id: scenario.id, contentHash: scenario.contentHash },
    versions: {
      simulation: engine.simulation,
      content: scenario.contentVersion,
      config: config.version,
      rng: engine.rng,
      math: engine.math,
    },
    config,
    configHash: canonicalHash(config),
    initialState,
    initialStateHash: canonicalHash(initialState),
  };
  const campaignId = `cmp-${canonicalHash(body).slice("sha256:".length, "sha256:".length + 16)}`;
  // Round-trip through canonical JSON: a fresh, input-independent copy.
  const manifest = JSON.parse(canonicalJson({ ...body, campaignId })) as CampaignManifest;
  return { ok: true, manifest: deepFreeze(manifest), pack: scenario.pack };
}

export function formatManifestIssue(issue: ManifestIssue): string {
  return `${issue.path}: ${issue.message}`;
}

function readSeed(value: unknown, issues: ManifestIssue[]): string | undefined {
  if (value === undefined) {
    issues.push({ path: "seed", message: "is required" });
    return undefined;
  }
  if (typeof value !== "string" || !SEED_PATTERN.test(value)) {
    issues.push({
      path: "seed",
      message: `must be 1-128 printable ASCII characters without spaces, got ${describe(value)}`,
    });
    return undefined;
  }
  return value;
}

function readScenario(
  untrusted: unknown,
  issues: ManifestIssue[],
): { id: string; contentVersion: number; contentHash: string; pack: ScenarioPack } | undefined {
  const result = validateScenarioPack(untrusted, "scenario");
  if (!result.ok) {
    issues.push(...result.issues);
    return undefined;
  }
  const { pack, contentHash } = result;
  return { id: pack.id, contentVersion: pack.contentVersion, contentHash, pack };
}

function readEngine(untrusted: unknown, issues: ManifestIssue[]): EngineVersions | undefined {
  const snapshot = snapshotPlainData(untrusted, "engine");
  const local: ManifestIssue[] = [];
  const engine = checkEngine(snapshot.value, local);
  issues.push(...withSnapshotIssues(snapshot.issues, local));
  return snapshot.issues.length === 0 ? engine : undefined;
}

function checkEngine(value: unknown, issues: ManifestIssue[]): EngineVersions | undefined {
  if (!isPlainRecord(value)) {
    issues.push({ path: "engine", message: `must be an object, got ${describe(value)}` });
    return undefined;
  }
  rejectUnknownKeys(value, ENGINE_KEYS, "engine", issues);
  const simulation = readVersion(value, "simulation", "engine", issues);
  const rng = readVersion(value, "rng", "engine", issues);
  const math = readVersion(value, "math", "engine", issues);
  if (simulation === undefined || rng === undefined || math === undefined) {
    return undefined;
  }
  return { simulation, rng, math };
}

function readVersion(
  record: Record<string, unknown>,
  key: string,
  parent: string,
  issues: ManifestIssue[],
): number | undefined {
  const path = `${parent}.${key}`;
  const value = record[key];
  if (value === undefined) {
    issues.push({ path, message: "is required" });
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    issues.push({ path, message: `must be a positive integer, got ${describe(value)}` });
    return undefined;
  }
  return value;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  parent: string,
  issues: ManifestIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      issues.push({ path: `${parent}.${key}`, message: "is not a known field" });
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
