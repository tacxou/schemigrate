import { deepEqual, isPlainObject } from '../utils/object-paths.js';
import type { MigrationDirection, MigrationSnapshotEntry, SchemaVersion } from '../types.js';

export function buildStepKey(from: SchemaVersion, to: SchemaVersion): string {
  return `${from}_to_${to}`;
}

/**
 * Captures the data needed to roll back one migration step (SPEC §15.1).
 *
 * Diff before/after: only the original values of top-level fields that were
 * modified or removed are stored. Nested changes are detected via deep
 * equality; the snapshot stores the original top-level value. Reserved `__*`
 * fields are never included. A field set to `undefined` counts as removed.
 */
export function captureSnapshotData(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const [key, originalValue] of Object.entries(before)) {
    if (key.startsWith('__') || key === '_id') continue;
    if (originalValue === undefined) continue;

    const newValue = isPlainObject(after) ? after[key] : undefined;
    const removed = newValue === undefined || !(key in after);

    if (removed || !deepEqual(originalValue, newValue)) {
      data[key] = originalValue;
    }
  }

  return data;
}

export function buildSnapshotEntry(props: {
  direction: MigrationDirection;
  fromVersion: SchemaVersion;
  toVersion: SchemaVersion;
  data: Record<string, unknown>;
  migratedAt?: Date;
}): MigrationSnapshotEntry {
  return {
    direction: props.direction,
    fromVersion: props.fromVersion,
    toVersion: props.toVersion,
    migratedAt: (props.migratedAt ?? new Date()).toISOString(),
    data: props.data,
  };
}

export function shouldStoreSnapshot(
  storeSnapshots: 'up' | 'down' | 'both' | false,
  direction: MigrationDirection,
): boolean {
  if (storeSnapshots === false) return false;
  if (storeSnapshots === 'both') return true;
  return storeSnapshots === direction;
}

/**
 * Applies a snapshot onto a document: restores the saved fields and returns
 * the version the document must be reset to (snapshot.fromVersion).
 */
export function applySnapshotData(
  document: Record<string, unknown>,
  snapshot: MigrationSnapshotEntry,
): SchemaVersion {
  for (const [key, value] of Object.entries(snapshot.data)) {
    document[key] = value;
  }
  return snapshot.fromVersion;
}
