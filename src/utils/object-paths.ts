/**
 * Helpers to read/write dotted paths on plain objects (POJOs) and to
 * clone/compare migration documents without depending on Mongoose.
 *
 * Non-plain class instances (ObjectId, Buffer, Decimal128…) are treated as
 * opaque immutable values: passed through by reference when cloning, and
 * compared via their `equals()` method or value identity.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function getPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (!isPlainObject(current[segment])) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = value;
}

/** Removes a dotted path; prunes parent objects that become empty. */
export function unsetPath(obj: Record<string, unknown>, path: string): void {
  const segments = path.split('.');
  const parents: Record<string, unknown>[] = [];
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const next = current[segments[i]];
    if (!isPlainObject(next)) return;
    parents.push(current);
    current = next;
  }

  delete current[segments[segments.length - 1]];

  for (let i = segments.length - 2; i >= 0; i--) {
    const parent = i === 0 ? obj : parents[i - 1];
    const child = parent[segments[i]];
    if (isPlainObject(child) && Object.keys(child).length === 0) {
      delete parent[segments[i]];
    } else {
      break;
    }
  }
}

/** Deep clone of plain objects, arrays and dates; opaque values pass by reference. */
export function cloneDocument<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map((item) => cloneDocument(item)) as T;
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = cloneDocument(item);
    }
    return result as T;
  }
  // Opaque BSON-like value (ObjectId, Buffer, Decimal128…): keep by reference.
  return value;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const maybeEquals = (a as { equals?: (other: unknown) => boolean }).equals;
    if (typeof maybeEquals === 'function') {
      return maybeEquals.call(a, b);
    }
    return String(a) === String(b);
  }
  return false;
}

/** Parses '30d', '12h', '45m' or a Date into a cutoff Date relative to now. */
export function parseOlderThan(olderThan: Date | string, now: Date = new Date()): Date {
  if (olderThan instanceof Date) return olderThan;

  const match = /^(\d+)([dhm])$/.exec(olderThan);
  if (!match) {
    throw new TypeError(
      `Invalid olderThan duration '${olderThan}'. Expected a Date or '<n>d' | '<n>h' | '<n>m'.`,
    );
  }

  const amount = Number(match[1]);
  const unitMs = { d: 86_400_000, h: 3_600_000, m: 60_000 }[match[2] as 'd' | 'h' | 'm'];
  return new Date(now.getTime() - amount * unitMs);
}
