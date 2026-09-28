// Canonical JSON for hashing and comparing deterministic data (docs/design-doc.md §18).
// Object keys are sorted by UTF-16 code units (never localeCompare), there is no
// whitespace, and only plain JSON values are accepted, so the same data always
// yields the same bytes regardless of insertion order, locale or time zone.

import { createHash } from "node:crypto";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Throws TypeError on anything JSON cannot represent exactly (NaN, undefined, Date, Map, cycles...). */
export function canonicalJson(value: unknown): string {
  return write(value, "$", new Set());
}

/** `sha256:<hex>` of the canonical JSON of `value`. */
export function canonicalHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function write(value: unknown, path: string, ancestors: Set<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path}: ${value} has no JSON representation`);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path}: ${typeof value} has no JSON representation`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${path}: circular reference`);
  }
  ancestors.add(value);
  let out: string;
  if (Array.isArray(value)) {
    out = `[${value.map((item: unknown, index) => write(item, `${path}[${index}]`, ancestors)).join(",")}]`;
  } else {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`${path}: only plain objects are allowed`);
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareCodeUnits);
    out = `{${keys.map((key) => `${JSON.stringify(key)}:${write(record[key], `${path}.${key}`, ancestors)}`).join(",")}}`;
  }
  ancestors.delete(value);
  return out;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
