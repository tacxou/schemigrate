import {
  DowngradeNotAllowedError,
  MigrationExecutionError,
  MissingSchemaVersionError,
} from '../errors/index.js';
import {
  cloneDocument,
  deepEqual,
  getPath,
  isPlainObject,
  setPath,
} from '../utils/object-paths.js';
import { buildMigrationPlan, findMigrationForStep } from './build-migration-plan.js';
import {
  buildSnapshotEntry,
  buildStepKey,
  captureSnapshotData,
  shouldStoreSnapshot,
} from './snapshots.js';
import type {
  Migration,
  MigrationContext,
  MigrationSnapshotEntry,
  SchemaVersion,
  SchemigrateLogger,
  SchemigratePlan,
  StoreSnapshotsOption,
} from '../types.js';

export type MigrateDocumentInput = {
  document: Record<string, unknown>;
  migrations: Migration[];
  targetVersion: SchemaVersion;
  versionPath?: string;
  snapshotsPath?: string;
  storeSnapshots?: StoreSnapshotsOption;
  allowDowngrade?: boolean;
  dryRun?: boolean;
  modelName?: string;
  documentId?: string;
  logger?: SchemigrateLogger;
};

export type MigrateDocumentResult = {
  document: Record<string, unknown>;
  fromVersion: SchemaVersion;
  targetVersion: SchemaVersion;
  plan: SchemigratePlan;
  snapshots: Record<string, MigrationSnapshotEntry>;
  /** Top-level fields whose value changed between input and output. */
  changedFields: Record<string, unknown>;
  /** Top-level fields removed between input and output. */
  removedFields: string[];
};

/**
 * Executes a full migration plan on a POJO, entirely in memory (SPEC §15.0).
 * The input document is never mutated; persistence is the caller's concern.
 */
export async function migrateDocumentWithMeta(
  input: MigrateDocumentInput,
): Promise<MigrateDocumentResult> {
  const versionPath = input.versionPath ?? '__schemaVersion';
  const snapshotsPath = input.snapshotsPath ?? '__migrationSnapshots';
  const storeSnapshots = input.storeSnapshots ?? 'both';
  const dryRun = input.dryRun ?? false;

  const original = input.document;
  const rawVersion = getPath(original, versionPath);

  if (typeof rawVersion !== 'number') {
    throw new MissingSchemaVersionError({
      modelName: input.modelName,
      documentId: input.documentId,
    });
  }

  const fromVersion = rawVersion;
  const targetVersion = input.targetVersion;

  if (targetVersion < fromVersion && !input.allowDowngrade) {
    throw new DowngradeNotAllowedError({
      modelName: input.modelName,
      fromVersion,
      toVersion: targetVersion,
    });
  }

  const plan = buildMigrationPlan(input.migrations, fromVersion, targetVersion, {
    modelName: input.modelName,
  });

  let working = cloneDocument(original);
  const snapshots: Record<string, MigrationSnapshotEntry> = {};

  for (const step of plan) {
    const migration = findMigrationForStep(input.migrations, step);
    const fn = step.direction === 'up' ? migration?.up : migration?.down;
    if (!migration || typeof fn !== 'function') {
      // buildMigrationPlan already guarantees this; defensive guard.
      throw new MigrationExecutionError({
        modelName: input.modelName,
        documentId: input.documentId,
        fromVersion: step.from,
        toVersion: step.to,
        migrationDescription: step.description,
      });
    }

    const before = cloneDocument(working);
    const context: MigrationContext = {
      modelName: input.modelName,
      documentId: input.documentId,
      fromVersion: step.from,
      toVersion: step.to,
      targetVersion,
      direction: step.direction,
      dryRun,
      logger: input.logger,
    };

    let result: unknown;
    try {
      result = await fn(working, context);
    } catch (cause) {
      throw new MigrationExecutionError({
        modelName: input.modelName,
        documentId: input.documentId,
        fromVersion: step.from,
        toVersion: step.to,
        migrationDescription: step.description,
        cause,
      });
    }

    if (isPlainObject(result)) {
      working = result;
    }

    if (shouldStoreSnapshot(storeSnapshots, step.direction)) {
      const data = captureSnapshotData(before, working);
      snapshots[buildStepKey(step.from, step.to)] = buildSnapshotEntry({
        direction: step.direction,
        fromVersion: step.from,
        toVersion: step.to,
        data,
      });
    }

    setPath(working, versionPath, step.to);

    input.logger?.info?.(
      `[Schemigrate] ${input.modelName ?? 'document'}: applied migration ${step.from} -> ${step.to}`,
      { documentId: input.documentId, direction: step.direction, dryRun },
    );
  }

  if (Object.keys(snapshots).length > 0) {
    const existing = getPath(working, snapshotsPath);
    const merged = {
      ...(isPlainObject(existing) ? existing : {}),
      ...snapshots,
    };
    setPath(working, snapshotsPath, merged);
  }

  const { changedFields, removedFields } = diffTopLevel(original, working);

  return {
    document: working,
    fromVersion,
    targetVersion,
    plan,
    snapshots,
    changedFields,
    removedFields,
  };
}

/**
 * Convenience wrapper returning only the migrated document (SPEC §46.4).
 */
export async function migrateDocument(
  input: MigrateDocumentInput,
): Promise<Record<string, unknown>> {
  const result = await migrateDocumentWithMeta(input);
  return result.document;
}

function diffTopLevel(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { changedFields: Record<string, unknown>; removedFields: string[] } {
  const changedFields: Record<string, unknown> = {};
  const removedFields: string[] = [];

  for (const [key, value] of Object.entries(after)) {
    if (key === '_id') continue;
    if (value === undefined) continue;
    if (!(key in before) || !deepEqual(before[key], value)) {
      changedFields[key] = value;
    }
  }

  for (const key of Object.keys(before)) {
    if (key === '_id') continue;
    if (!(key in after) || after[key] === undefined) {
      removedFields.push(key);
    }
  }

  return { changedFields, removedFields };
}
