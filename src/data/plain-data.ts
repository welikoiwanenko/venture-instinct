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

export interface Snapshot {
  /**
   * The copy. When there are issues it is partial: a rejected accessor is left
   * out, so the remaining fields can still be validated. Hash it only when
   * `issues` is empty.
   */
  readonly value: unknown;
  readonly issues: readonly SnapshotIssue[];
}

/**
 * Copies arrays and plain objects (own enumerable string keys only), keeping every
 * other value as is, so later checks still see and reject values such as NaN,
 * undefined or a Date. Copied objects have a null prototype, so an absent key can
 * never be answered by Object.prototype. Every accessor is reported, not just the
 * first. `path` names the root in issue paths. Never throws.
 */
export function snapshotPlainData(value: unknown, path = ""): Snapshot {
  const issues: SnapshotIssue[] = [];
  try {
    return { value: copy(value, path, new Set(), issues), issues };
  } catch (error) {
    // A Proxy trap may throw anything, including a value whose message or
    // toString throws in turn; report it instead of propagating.
    return { value: undefined, issues: [{ path, message: `cannot be read: ${describeThrown(error)}` }] };
  }
}

/**
 * Snapshot issues first, then the later validation issues that a snapshot issue
 * does not already explain (e.g. "is required" for a rejected getter).
 */
export function withSnapshotIssues<T extends SnapshotIssue>(
  snapshotIssues: readonly SnapshotIssue[],
  later: readonly T[],
): Array<SnapshotIssue | T> {
  const covered = (path: string): boolean =>
    snapshotIssues.some(
      (issue) =>
        issue.path === "" ||
        path === issue.path ||
        path.startsWith(`${issue.path}.`) ||
        path.startsWith(`${issue.path}[`),
    );
  return [...snapshotIssues, ...later.filter((issue) => !covered(issue.path))];
}

/** A description of any thrown value; never throws itself. */
export function describeThrown(error: unknown): string {
  try {
    if (error instanceof Error && typeof error.message === "string") {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
  } catch {
    // Fall through to the constant below.
  }
  return "an unreadable value was thrown";
}

/** Freezes `value` and everything reachable from it; returns it for chaining. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
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
