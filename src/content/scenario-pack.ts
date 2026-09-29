// Scenario packs (docs/design-doc.md §14.1, §18): versioned authored content that a
// campaign starts from. A pack groups company profiles under a scenario id and a
// content version; its canonical hash is recorded in the campaign manifest, so any
// content change is visible there while key order is not.
//
//   { "id": "...", "contentVersion": 1, "content": { "purpose"?: "...", "companies": [...] } }

import { describeThrown, isPlainRecord, snapshotPlainData, withSnapshotIssues } from "../data/plain-data.ts";
import { canonicalHash } from "../manifest/canonical-json.ts";
import { checkCompanyProfile, type CompanyProfile } from "./company-profile.ts";
import { childPath, describe, readArray, readRecord, readText, rejectUnknownKeys, type ContentIssue } from "./fields.ts";

export interface ScenarioContent {
  /** What the pack is for, e.g. a technical fixture. Authors only. */
  readonly purpose?: string;
  /** In authored order, which is also the order of every company list derived from the pack. */
  readonly companies: readonly CompanyProfile[];
}

export interface ScenarioPack {
  readonly id: string;
  readonly contentVersion: number;
  readonly content: ScenarioContent;
}

export type ScenarioPackResult =
  | { readonly ok: true; readonly pack: ScenarioPack; readonly contentHash: string }
  | { readonly ok: false; readonly issues: readonly ContentIssue[] };

const PACK_KEYS = ["id", "contentVersion", "content"] as const;
const CONTENT_KEYS = ["purpose", "companies"] as const;

/**
 * Validates an untrusted pack and returns a copy that shares nothing with it, plus the
 * canonical hash of that copy. Every issue is reported at once with its path under
 * `root`. The input is read once; getters are reported, never called.
 */
export function validateScenarioPack(untrusted: unknown, root = "scenario"): ScenarioPackResult {
  if (untrusted === undefined) {
    return { ok: false, issues: [{ path: root, message: "is required" }] };
  }
  const snapshot = snapshotPlainData(untrusted, root);
  const local: ContentIssue[] = [];
  const pack = checkPack(snapshot.value, root, local);

  // Hash only a complete snapshot; a partial one would describe different data.
  let contentHash: string | undefined;
  if (snapshot.issues.length === 0 && isPlainRecord(snapshot.value)) {
    try {
      contentHash = canonicalHash(snapshot.value);
    } catch (error) {
      local.push({ path: root, message: `must be plain JSON data: ${describeThrown(error)}` });
    }
  }

  const issues = withSnapshotIssues(snapshot.issues, local);
  if (issues.length > 0 || pack === undefined || contentHash === undefined) {
    return { ok: false, issues };
  }
  return { ok: true, pack, contentHash };
}

function checkPack(value: unknown, root: string, issues: ContentIssue[]): ScenarioPack | undefined {
  if (!isPlainRecord(value)) {
    issues.push({ path: root, message: `must be an object, got ${describe(value)}` });
    return undefined;
  }
  rejectUnknownKeys(value, PACK_KEYS, root, issues);
  const id = readText(value, "id", root, issues);
  const contentVersion = readVersion(value, root, issues);
  const content = checkContent(value["content"], childPath(root, "content"), issues);
  if (id === undefined || contentVersion === undefined || content === undefined) return undefined;
  return { id, contentVersion, content };
}

function readVersion(record: Record<string, unknown>, root: string, issues: ContentIssue[]): number | undefined {
  const path = childPath(root, "contentVersion");
  const value = record["contentVersion"];
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

function checkContent(value: unknown, path: string, issues: ContentIssue[]): ScenarioContent | undefined {
  const start = issues.length;
  const record = readRecord(value, path, issues);
  if (record === undefined) return undefined;
  rejectUnknownKeys(record, CONTENT_KEYS, path, issues);
  const purpose = record["purpose"] === undefined ? undefined : readText(record, "purpose", path, issues);

  const companiesPath = childPath(path, "companies");
  const items = readArray(record["companies"], companiesPath, issues);
  const companies = items?.map((item, index) => checkCompanyProfile(item, childPath(companiesPath, index), issues));
  if (items !== undefined) reportDuplicateIds(items, companiesPath, issues);

  if (issues.length > start || companies === undefined || companies.some((c) => c === undefined)) {
    return undefined;
  }
  return { ...(purpose === undefined ? {} : { purpose }), companies: companies as CompanyProfile[] };
}

/**
 * Company ids, and founder ids across all companies, must be unique in the pack. Reads
 * the raw items, so a duplicate is reported even when its profile has other issues.
 */
function reportDuplicateIds(items: readonly unknown[], path: string, issues: ContentIssue[]): void {
  const companies = new Map<string, string>();
  const founders = new Map<string, string>();
  items.forEach((item, index) => {
    if (!isPlainRecord(item)) return;
    const companyPath = childPath(path, index);
    claim(companies, item["id"], childPath(companyPath, "id"), "company", issues);
    const list = item["founders"];
    if (!Array.isArray(list)) return;
    list.forEach((founder, founderIndex) => {
      if (!isPlainRecord(founder)) return;
      const founderPath = childPath(childPath(childPath(companyPath, "founders"), founderIndex), "id");
      claim(founders, founder["id"], founderPath, "founder", issues);
    });
  });
}

function claim(seen: Map<string, string>, id: unknown, path: string, kind: string, issues: ContentIssue[]): void {
  if (typeof id !== "string") return;
  const first = seen.get(id);
  if (first === undefined) {
    seen.set(id, path);
  } else {
    issues.push({ path, message: `duplicates ${kind} id ${JSON.stringify(id)} first used at ${first}` });
  }
}
