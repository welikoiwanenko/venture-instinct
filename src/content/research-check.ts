// Authored research checks (docs/design-doc.md §9.1, §9.2, §14.1). A check is one
// question the player may pay a slot to answer about a company, the evidence set it
// reads, and what that evidence says. Research produces evidence from the world, never
// invented text: a figure must equal the hidden state, or carry the structured reason it
// differs (§14.1), exactly like an application claim.
//
// A check's result is internal until a research action delivers it as an observation;
// the player view never reads checks.
//
//   { "id": "chk-...", "direction": "customers", "question": "...",
//     "evidence": { "source": "...", "period": { "fromWeek": -3, "toWeek": 0 } },
//     "result": { "kind": "metric", "metric": "payingCustomers", "value": 7 }
//             | { "kind": "text", "title": "...", "text": "..." }
//             | { "kind": "unavailable", "reason": "..." } }

import { trueMetricValue } from "../knowledge/facts.ts";
import {
  checkDistortionMatchesGap,
  METRIC_NAMES,
  metricBounds,
  readDistortion,
  readPeriod,
  type Distortion,
  type Metric,
  type Period,
} from "../knowledge/observation.ts";
import type { HiddenStartingState } from "./company-profile.ts";
import { childPath, readArray, readEnum, readId, readInteger, readRecord, readText, rejectUnknownKeys, type ContentIssue } from "./fields.ts";

/** The four §9.2 directions a check can take. */
export const RESEARCH_DIRECTIONS = ["growth-quality", "customers", "team", "product"] as const;
export type ResearchDirection = (typeof RESEARCH_DIRECTIONS)[number];

export interface ResearchEvidence {
  /** What the check reads, in player-facing language, e.g. "Платіжні дані за місяць"; shown as the source. */
  readonly source: string;
  /** The period the evidence describes; before the campaign until the world simulates (Zeta). */
  readonly period: Period;
}

export type ResearchResult =
  /** A figure for the evidence period. `distortion` is required exactly when it differs from the truth. */
  | { readonly kind: "metric"; readonly metric: Metric; readonly value: number; readonly distortion?: Distortion }
  /** A finding in words, e.g. about the team or product; `title` is its one-line short form. */
  | { readonly kind: "text"; readonly title: string; readonly text: string }
  /** Time spent without data. The reason is not, by itself, a sign of deception (§9.2). */
  | { readonly kind: "unavailable"; readonly reason: string };

export interface ResearchCheck {
  /** Stable, unique in the pack. */
  readonly id: string;
  readonly direction: ResearchDirection;
  /** The question as the player reads it before choosing the check. */
  readonly question: string;
  readonly evidence: ResearchEvidence;
  readonly result: ResearchResult;
}

/** §5 content budget: research text is at most about 120 words. */
export const RESEARCH_TEXT_MAX_WORDS = 120;
/** A question is one sentence the player scans in a list. */
export const RESEARCH_QUESTION_MAX_WORDS = 30;

const CHECK_KEYS = ["id", "direction", "question", "evidence", "result"] as const;
const EVIDENCE_KEYS = ["source", "period"] as const;
const BEFORE_CAMPAIGN = { week: 0, reason: "week 0: until the world simulates, evidence describes the time before the campaign" };

/**
 * Words a question may not contain: they would reveal hidden truth or a verdict by the
 * question's name (§9.3, §10.1), e.g. "Is the founder lying about customers?". English
 * words match whole; Ukrainian entries are stems, matched at the start of a word so
 * that their inflections are caught too.
 */
const FORBIDDEN_QUESTION_WORDS = new Set([
  "quality",
  "score",
  "rating",
  "rank",
  "winner",
  "loser",
  "exit",
  "outcome",
  "guaranteed",
  "fate",
  "lie",
  "lies",
  "lying",
  "liar",
  "fraud",
  "fake",
  "true",
  "truth",
  "hidden",
  "distortion",
]);
const FORBIDDEN_QUESTION_STEMS = [
  "якіст",
  "рейтинг",
  "переможц",
  "переможе",
  "невдах",
  "гарантован",
  "брех",
  "бреш",
  "обман",
  "правд",
  "шахра",
  "прихован",
  "викривлен",
];

/** The first forbidden word in `text`, or undefined. */
export function forbiddenQuestionWord(text: string): string | undefined {
  for (const word of text.toLocaleLowerCase("uk").split(/[^\p{L}\p{N}'’]+/u)) {
    if (word === "") continue;
    if (FORBIDDEN_QUESTION_WORDS.has(word) || FORBIDDEN_QUESTION_STEMS.some((stem) => word.startsWith(stem))) return word;
  }
  return undefined;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w !== "").length;
}

/**
 * Validates a company's checks. Absent means no checks. `hidden` is the company's
 * validated hidden state, when it is valid, to measure figures against.
 */
export function readResearchChecks(
  value: unknown,
  path: string,
  hidden: HiddenStartingState | undefined,
  issues: ContentIssue[],
): ResearchCheck[] | undefined {
  if (value === undefined) return [];
  const items = readArray(value, path, issues);
  if (items === undefined) return undefined;
  const start = issues.length;
  const checks = items.map((item, index) => readCheck(item, childPath(path, index), hidden, issues));
  return issues.length > start || checks.some((c) => c === undefined) ? undefined : (checks as ResearchCheck[]);
}

function readCheck(value: unknown, path: string, hidden: HiddenStartingState | undefined, issues: ContentIssue[]): ResearchCheck | undefined {
  const start = issues.length;
  const record = readRecord(value, path, issues);
  if (record === undefined) return undefined;
  rejectUnknownKeys(record, CHECK_KEYS, path, issues);
  const id = readId(record, "id", path, issues);
  const direction = readEnum(record, "direction", path, RESEARCH_DIRECTIONS, issues);
  const question = readText(record, "question", path, issues);
  if (question !== undefined) {
    const word = forbiddenQuestionWord(question);
    if (word !== undefined) {
      issues.push({
        path: childPath(path, "question"),
        message: `must not contain ${JSON.stringify(word)}: a question may not reveal hidden truth or a verdict by its name (§9.3)`,
      });
    }
    limitWords(question, RESEARCH_QUESTION_MAX_WORDS, childPath(path, "question"), issues);
  }
  const evidence = readEvidence(record["evidence"], childPath(path, "evidence"), issues);
  const result = readResult(record["result"], childPath(path, "result"), hidden, issues);
  if (issues.length > start || id === undefined || direction === undefined || question === undefined || evidence === undefined || result === undefined) {
    return undefined;
  }
  return { id, direction, question, evidence, result };
}

function readEvidence(value: unknown, path: string, issues: ContentIssue[]): ResearchEvidence | undefined {
  const record = readRecord(value, path, issues);
  if (record === undefined) return undefined;
  rejectUnknownKeys(record, EVIDENCE_KEYS, path, issues);
  const source = readText(record, "source", path, issues);
  const period = readPeriod(record["period"], childPath(path, "period"), BEFORE_CAMPAIGN, issues);
  return source === undefined || period === undefined ? undefined : { source, period };
}

function readResult(value: unknown, path: string, hidden: HiddenStartingState | undefined, issues: ContentIssue[]): ResearchResult | undefined {
  const record = readRecord(value, path, issues);
  if (record === undefined) return undefined;
  const kind = readEnum(record, "kind", path, ["metric", "text", "unavailable"] as const, issues);
  switch (kind) {
    case "metric": {
      rejectUnknownKeys(record, ["kind", "metric", "value", "distortion"], path, issues);
      const metric = readEnum(record, "metric", path, METRIC_NAMES, issues);
      const found = readInteger(record, "value", path, metricBounds(metric), issues);
      const distortionPath = childPath(path, "distortion");
      const hasDistortion = record["distortion"] !== undefined;
      const distortion = hasDistortion ? readDistortion(record["distortion"], distortionPath, issues) : undefined;
      if (metric !== undefined && found !== undefined && hidden !== undefined) {
        checkDistortionMatchesGap(found, trueMetricValue(hidden, metric), hasDistortion, "the hidden state", distortionPath, issues);
      }
      if (metric === undefined || found === undefined || (hasDistortion && distortion === undefined)) return undefined;
      return { kind, metric, value: found, ...(distortion === undefined ? {} : { distortion }) };
    }
    case "text": {
      rejectUnknownKeys(record, ["kind", "title", "text"], path, issues);
      const title = readText(record, "title", path, issues);
      const text = readText(record, "text", path, issues);
      if (text !== undefined) limitWords(text, RESEARCH_TEXT_MAX_WORDS, childPath(path, "text"), issues);
      return title === undefined || text === undefined ? undefined : { kind, title, text };
    }
    case "unavailable": {
      rejectUnknownKeys(record, ["kind", "reason"], path, issues);
      const reason = readText(record, "reason", path, issues);
      if (reason !== undefined) limitWords(reason, RESEARCH_TEXT_MAX_WORDS, childPath(path, "reason"), issues);
      return reason === undefined ? undefined : { kind, reason };
    }
    default:
      return undefined;
  }
}

function limitWords(text: string, max: number, path: string, issues: ContentIssue[]): void {
  const count = wordCount(text);
  if (count > max) issues.push({ path, message: `must be at most ${max} words (§5 content budget), got ${count}` });
}
