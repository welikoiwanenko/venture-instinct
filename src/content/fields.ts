// Field readers for authored content (docs/design-doc.md §14.2). Each reader checks one
// field of an already snapshotted record, pushes a path-specific issue on failure and
// returns `undefined`, so a caller can report every problem in one pass.

import { isPlainRecord } from "../data/plain-data.ts";

export interface ContentIssue {
  /** Dotted path with `[index]` for array items, e.g. "scenario.content.companies[0].id". */
  readonly path: string;
  readonly message: string;
}

export const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ID_MAX_LENGTH = 64;

export function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent === "" ? key : `${parent}.${key}`;
}

export function readRecord(
  value: unknown,
  path: string,
  issues: ContentIssue[],
): Record<string, unknown> | undefined {
  if (value === undefined) {
    issues.push({ path, message: "is required" });
    return undefined;
  }
  if (!isPlainRecord(value)) {
    issues.push({ path, message: `must be an object, got ${describe(value)}` });
    return undefined;
  }
  return value;
}

export function readArray(
  value: unknown,
  path: string,
  issues: ContentIssue[],
  hint?: string,
): readonly unknown[] | undefined {
  if (value === undefined) {
    issues.push({ path, message: hint === undefined ? "is required" : `is required: ${hint}` });
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push({ path, message: `must be an array, got ${describe(value)}` });
    return undefined;
  }
  return value;
}

/** A non-empty string without surrounding spaces. `hint` explains why a missing field matters. */
export function readText(
  record: Record<string, unknown>,
  key: string,
  parent: string,
  issues: ContentIssue[],
  hint?: string,
): string | undefined {
  const path = childPath(parent, key);
  const value = record[key];
  if (value === undefined) {
    issues.push({ path, message: hint === undefined ? "is required" : `is required: ${hint}` });
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    issues.push({ path, message: `must be a non-empty string without surrounding spaces, got ${describe(value)}` });
    return undefined;
  }
  return value;
}

/** A stable lower-case kebab-case identifier, e.g. "co-relaybase". */
export function readId(
  record: Record<string, unknown>,
  key: string,
  parent: string,
  issues: ContentIssue[],
): string | undefined {
  const path = childPath(parent, key);
  const value = record[key];
  if (value === undefined) {
    issues.push({ path, message: "is required" });
    return undefined;
  }
  if (typeof value !== "string" || value.length > ID_MAX_LENGTH || !ID_PATTERN.test(value)) {
    issues.push({
      path,
      message: `must be a lower-case kebab-case id of at most ${ID_MAX_LENGTH} characters, got ${describe(value)}`,
    });
    return undefined;
  }
  return value;
}

/**
 * A safe integer in [min, max]. `unit` names the scale in messages ("cents", "basis
 * points"), so a fractional or out-of-range value explains what was expected.
 */
export function readInteger(
  record: Record<string, unknown>,
  key: string,
  parent: string,
  range: { readonly min: number; readonly max?: number; readonly unit?: string },
  issues: ContentIssue[],
  hint?: string,
): number | undefined {
  const path = childPath(parent, key);
  const value = record[key];
  const unit = range.unit === undefined ? "" : ` ${range.unit}`;
  if (value === undefined) {
    issues.push({ path, message: hint === undefined ? "is required" : `is required: ${hint}` });
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    issues.push({ path, message: `must be a whole number of${unit === "" ? " units" : unit}, got ${describe(value)}` });
    return undefined;
  }
  if (value < range.min || (range.max !== undefined && value > range.max)) {
    const bounds = range.max === undefined ? `at least ${range.min}` : `between ${range.min} and ${range.max}`;
    issues.push({ path, message: `must be ${bounds}${unit}, got ${value}` });
    return undefined;
  }
  return value;
}

export function readEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  parent: string,
  allowed: readonly T[],
  issues: ContentIssue[],
): T | undefined {
  const path = childPath(parent, key);
  const value = record[key];
  if (value === undefined) {
    issues.push({ path, message: "is required" });
    return undefined;
  }
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    issues.push({ path, message: `must be one of ${allowed.join(", ")}; got ${describe(value)}` });
    return undefined;
  }
  return value as T;
}

export function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  parent: string,
  issues: ContentIssue[],
  skip: (key: string) => boolean = () => false,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key) && !skip(key)) {
      issues.push({ path: childPath(parent, key), message: "is not a known field" });
    }
  }
}

export function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  return typeof value;
}
