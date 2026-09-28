// One-shot snapshots of untrusted input (docs/design-doc.md §18). Validation,
// metadata and hashes must all describe the same data, so each input is read
// exactly once into a private copy and everything else works on that copy.
// Accessor properties (getters) are rejected without being called: a getter can
// return a different value on every read, or throw.

export interface SnapshotIssue {
  /** Dotted path with `[index]` for array items; the root is `path` as passed in. */
  readonly path: string;
  readonly message: string;
}

export type SnapshotResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issues: readonly SnapshotIssue[] };

/**
 * Copies arrays and plain objects (own enumerable string keys only), keeping every
 * other value as is, so later checks still see and reject values such as NaN,
 * undefined or a Date. Copied objects have a null prototype, so an absent key can
 * never be answered by Object.prototype. Every accessor is reported, not just the
 * first. `path` names the root in issue paths.
 */
export function snapshotPlainData(value: unknown, path = ""): SnapshotResult {
  const issues: SnapshotIssue[] = [];
  let copied: unknown;
  try {
    copied = copy(value, path, new Set(), issues);
  } catch (error) {
    // A Proxy trap may throw anything; report it instead of propagating.
    return {
      ok: false,
      issues: [{ path, message: `cannot be read: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: copied };
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function copy(value: unknown, path: string, ancestors: Set<object>, issues: SnapshotIssue[]): unknown {
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    return value;
  }
  if (ancestors.has(value)) {
    issues.push({ path, message: "contains a circular reference" });
    return undefined;
  }
  ancestors.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    const length = value.length;
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      // A hole stays a hole, so canonical JSON rejects it as before.
      const itemPath = `${path}[${index}]`;
      if (descriptor !== undefined && isData(descriptor, itemPath, issues)) {
        items[index] = copy(descriptor.value, itemPath, ancestors, issues);
      }
    }
    items.length = length;
    out = items;
  } else {
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      const childPath = path === "" ? key : `${path}.${key}`;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !isData(descriptor, childPath, issues)) {
        continue;
      }
      Object.defineProperty(record, key, {
        value: copy(descriptor.value, childPath, ancestors, issues),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    out = record;
  }
  ancestors.delete(value);
  return out;
}

function isData(descriptor: PropertyDescriptor, path: string, issues: SnapshotIssue[]): boolean {
  if ("value" in descriptor) {
    return true;
  }
  issues.push({ path, message: "must be a data property, not a getter or setter" });
  return false;
}
