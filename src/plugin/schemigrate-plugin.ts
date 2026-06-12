import type {
  AnyBulkWriteOperation,
  FilterQuery,
  HydratedDocument,
  Model,
  Query,
  Schema,
} from 'mongoose';
import {
  DocumentNotFoundError,
  MissingMigrationSnapshotError,
  MissingSchemaVersionError,
  RollbackExecutionError,
  SchemigrateError,
} from '../errors/index.js';
import { buildMigrationPlan } from '../engine/build-migration-plan.js';
import {
  migrateDocumentWithMeta,
  type MigrateDocumentResult,
} from '../engine/migrate-document.js';
import { validateMigrations } from '../engine/validate-migrations.js';
import { assertReadableVersions } from './read-guard.js';
import { unsetPath as stripPath } from '../utils/object-paths.js';
import {
  cloneDocument,
  getPath,
  isPlainObject,
  parseOlderThan,
  setPath,
} from '../utils/object-paths.js';
import type {
  MigrationSnapshotEntry,
  MigrationSnapshotInfo,
  MigrationState,
  MigrationStatus,
  SchemaVersion,
  SchemigrateAbortOptions,
  SchemigrateBatchOptions,
  SchemigrateBatchResult,
  SchemigrateCleanupOptions,
  SchemigrateCleanupResult,
  SchemigrateMigrationOptions,
  SchemigratePlan,
  SchemigratePluginOptions,
  SchemigrateRollbackOptions,
  ResolvedSchemigrateOptions,
} from '../types.js';

const STATE_PATH = '__migrationState';

type AnyDoc = Record<string, unknown>;
type AnyModel = Model<AnyDoc> & SchemaVersionedModelMethods;

export interface SchemaVersionedDocumentMethods {
  getSchemaVersion(): SchemaVersion | undefined;
  isOutdated(): boolean;
  isCurrentVersion(): boolean;
  isNewerThanSupported(): boolean;
  canMigrateTo(targetVersion: SchemaVersion): boolean;
  migrateTo(targetVersion: SchemaVersion, options?: SchemigrateMigrationOptions): Promise<this>;
  migrateToCurrentVersion(options?: SchemigrateMigrationOptions): Promise<this>;
  listMigrationSnapshots(): MigrationSnapshotInfo[];
  hasMigrationSnapshot(stepKey: string): boolean;
  rollbackMigration(stepKey: string, options?: SchemigrateRollbackOptions): Promise<this>;
  abortMigration(options?: SchemigrateAbortOptions): Promise<this>;
  getMigrationState(): MigrationState | null;
}

export interface SchemaVersionedModelMethods {
  getCurrentSchemaVersion(): SchemaVersion;
  getMigrationPlan(fromVersion: SchemaVersion, toVersion: SchemaVersion): SchemigratePlan;
  migrateDocument(
    rawDocument: AnyDoc,
    targetVersion?: SchemaVersion,
    options?: SchemigrateMigrationOptions,
  ): Promise<AnyDoc>;
  migrateById(
    id: unknown,
    targetVersion?: SchemaVersion,
    options?: SchemigrateMigrationOptions,
  ): Promise<unknown>;
  migrateMany(
    filter: FilterQuery<AnyDoc>,
    targetVersion?: SchemaVersion,
    options?: SchemigrateBatchOptions,
  ): Promise<SchemigrateBatchResult>;
  findOutdatedDocuments(): Promise<AnyDoc[]>;
  findNewerDocuments(): Promise<AnyDoc[]>;
  rollbackMigrationById(
    id: unknown,
    stepKey: string,
    options?: SchemigrateRollbackOptions,
  ): Promise<AnyDoc>;
  rollbackMany(
    filter: FilterQuery<AnyDoc>,
    stepKey: string,
    options?: SchemigrateRollbackOptions,
  ): Promise<SchemigrateBatchResult>;
  cleanupMigrationSnapshots(
    filter: FilterQuery<AnyDoc>,
    options?: SchemigrateCleanupOptions,
  ): Promise<SchemigrateCleanupResult>;
  cleanupMigrationSnapshotById(
    id: unknown,
    stepKey?: string,
    options?: SchemigrateCleanupOptions,
  ): Promise<void>;
  syncToCurrentVersion(options?: SchemigrateBatchOptions): Promise<SchemigrateBatchResult>;
  getMigrationStatus(): Promise<MigrationStatus>;
  abortMigrationById(id: unknown, options?: SchemigrateAbortOptions): Promise<unknown>;
  abortMigrationMany(
    filter: FilterQuery<AnyDoc>,
    options?: SchemigrateAbortOptions,
  ): Promise<SchemigrateBatchResult>;
}

export type SchemaVersionedDocument<T = AnyDoc> = HydratedDocument<T> &
  SchemaVersionedDocumentMethods;

export type SchemaVersionedModel<T = AnyDoc> = Model<
  T,
  Record<string, never>,
  SchemaVersionedDocumentMethods
> &
  SchemaVersionedModelMethods;

export function resolvePluginOptions(
  options: SchemigratePluginOptions,
): ResolvedSchemigrateOptions {
  const migrations = options.migrations ?? [];

  const storeSnapshots =
    options.storeSnapshots !== undefined
      ? options.storeSnapshots
      : options.backupBeforeDowngrade
        ? 'down'
        : 'both';

  const minFrom = migrations.reduce<number | undefined>(
    (min, m) => (min === undefined || m.from < min ? m.from : min),
    undefined,
  );

  return {
    currentVersion: options.currentVersion,
    versionPath: options.versionPath ?? '__schemaVersion',
    migrations,
    versionStrategy: options.versionStrategy ?? 'timestamp',
    autoSave: options.autoSave ?? false,
    allowDowngrade: options.allowDowngrade ?? false,
    unknownVersionStrategy: options.unknownVersionStrategy ?? 'throw',
    storeSnapshots,
    snapshotsPath: options.snapshotsPath ?? options.backupPath ?? '__migrationSnapshots',
    hideInToJSON: options.hideInToJSON ?? true,
    autoRunOnBootstrap: options.autoRunOnBootstrap ?? false,
    createIndexes: options.createIndexes ?? true,
    defaultVersion: options.defaultVersion ?? minFrom ?? options.currentVersion,
    logger: options.logger,
  };
}

function buildNestedSchemaDef(path: string, type: unknown): Record<string, unknown> {
  const segments = path.split('.');
  let def: unknown = type;
  for (let i = segments.length - 1; i >= 0; i--) {
    def = { [segments[i]]: def };
  }
  return def as Record<string, unknown>;
}

function emptyBatchResult(): SchemigrateBatchResult {
  return { matched: 0, migrated: 0, skipped: 0, failed: 0, errors: [] };
}

export function schemigratePlugin(
  schema: Schema,
  pluginOptions: SchemigratePluginOptions,
): void {
  if (!pluginOptions || typeof pluginOptions.currentVersion !== 'number') {
    throw new SchemigrateError(
      'schemigratePlugin: options.currentVersion (number) is required.',
    );
  }

  const opts = resolvePluginOptions(pluginOptions);
  validateMigrations(opts.migrations, { currentVersion: opts.currentVersion });

  const { versionPath, snapshotsPath, currentVersion, migrations, logger } = opts;

  // --- Reserved fields -----------------------------------------------------

  if (!schema.path(versionPath)) {
    schema.add(buildNestedSchemaDef(versionPath, { type: Number }) as Parameters<Schema['add']>[0]);
  }
  if (!schema.path(snapshotsPath)) {
    schema.add(buildNestedSchemaDef(snapshotsPath, { type: Object }) as Parameters<Schema['add']>[0]);
  }
  if (!schema.path(STATE_PATH)) {
    schema.add({ [STATE_PATH]: { type: Object } });
  }
  if (!schema.path('__createdByVersion')) {
    schema.add({ __createdByVersion: { type: String } });
  }
  if (!schema.path('__updatedByVersion')) {
    schema.add({ __updatedByVersion: { type: String } });
  }

  if (opts.createIndexes) {
    schema.index({ [versionPath]: 1 });
    schema.index({ [`${STATE_PATH}.status`]: 1 });
  }

  // --- toJSON masking ------------------------------------------------------

  if (opts.hideInToJSON) {
    const reservedPaths = [
      ...new Set([
        versionPath,
        snapshotsPath,
        STATE_PATH,
        '__createdByVersion',
        '__updatedByVersion',
      ]),
    ];
    const previous = (schema.get('toJSON') ?? {}) as Record<string, unknown>;
    const previousTransform = previous.transform;

    schema.set('toJSON', {
      ...previous,
      transform(doc: unknown, ret: Record<string, unknown>, options: unknown) {
        let output = ret;
        if (typeof previousTransform === 'function') {
          const transformed = previousTransform(doc, ret, options);
          if (transformed !== undefined && transformed !== null) {
            output = transformed as Record<string, unknown>;
          }
        }
        for (const path of reservedPaths) {
          stripPath(output, path);
        }
        return output;
      },
    });
  }

  // --- Read guard (SPEC §16.1 / §27) ---------------------------------------

  const guardedOps = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndReplace',
    'findOneAndDelete',
  ] as const;

  schema.post(guardedOps as unknown as RegExp, function (this: Query<unknown, AnyDoc>, res: unknown) {
    if (res === null || res === undefined) return;
    const queryOptions = this.getOptions() as { schemigrateCheck?: boolean };
    if (queryOptions.schemigrateCheck === false) return;

    assertReadableVersions(Array.isArray(res) ? res : [res], {
      modelName: this.model?.modelName,
      currentVersion,
      versionPath,
      defaultVersion: opts.defaultVersion,
      unknownVersionStrategy: opts.unknownVersionStrategy,
    });
  });

  // --- Version stamping on creation (SPEC §10.1) ---------------------------

  schema.pre('save', function (next) {
    if (this.isNew) {
      const version = this.get(versionPath);
      if (version === undefined || version === null) {
        this.set(versionPath, currentVersion);
      }
    }
    next();
  });

  schema.pre('insertMany', function (next: (err?: Error) => void, docs: unknown) {
    if (Array.isArray(docs)) {
      for (const doc of docs) {
        if (doc === null || typeof doc !== 'object') continue;
        const target = doc as { get?: (p: string) => unknown; set?: (p: string, v: unknown) => void };
        const existing =
          typeof target.get === 'function'
            ? target.get(versionPath)
            : getPath(doc, versionPath);
        if (existing === undefined || existing === null) {
          if (typeof target.set === 'function') {
            target.set(versionPath, currentVersion);
          } else {
            setPath(doc as AnyDoc, versionPath, currentVersion);
          }
        }
      }
    }
    next();
  });

  schema.pre(
    ['findOneAndUpdate', 'updateOne', 'updateMany', 'replaceOne'],
    function (this: Query<unknown, AnyDoc>, next: (err?: Error) => void) {
      const queryOptions = this.getOptions() as { upsert?: boolean };
      if (!queryOptions.upsert) return next();

      const update = this.getUpdate();
      if (!update || Array.isArray(update)) return next();
      const u = update as Record<string, AnyDoc | unknown>;

      const isReplacement = !Object.keys(u).some((key) => key.startsWith('$'));
      if (isReplacement) {
        if (getPath(u, versionPath) === undefined) {
          setPath(u as AnyDoc, versionPath, currentVersion);
        }
        return next();
      }

      const set = (u.$set ?? {}) as AnyDoc;
      const setOnInsert = (u.$setOnInsert ?? {}) as AnyDoc;
      const alreadyHandled =
        set[versionPath] !== undefined || setOnInsert[versionPath] !== undefined;

      if (!alreadyHandled) {
        u.$setOnInsert = { ...setOnInsert, [versionPath]: currentVersion };
      }
      next();
    },
  );

  // --- Internal helpers ----------------------------------------------------

  async function readPojoById(model: AnyModel, id: unknown): Promise<AnyDoc | null> {
    return model
      .findById(id)
      .setOptions({ schemigrateCheck: false })
      .lean<AnyDoc>()
      .exec();
  }

  function buildWriteUpdate(result: MigrateDocumentResult): Record<string, AnyDoc> {
    const update: Record<string, AnyDoc> = {};
    if (Object.keys(result.changedFields).length > 0) {
      update.$set = result.changedFields;
    }
    const unset: AnyDoc = {};
    for (const field of result.removedFields) {
      unset[field] = '';
    }
    // Clear any stale failure marker from a previous attempt.
    if (!(STATE_PATH in (update.$set ?? {}))) {
      unset[STATE_PATH] = '';
    }
    if (Object.keys(unset).length > 0) {
      update.$unset = unset;
    }
    return update;
  }

  /** Optimistic-lock write: matches only if the document is still at fromVersion. */
  async function writeMigrated(
    model: AnyModel,
    documentId: unknown,
    result: MigrateDocumentResult,
  ): Promise<boolean> {
    const res = await model.collection.updateOne(
      { _id: documentId, [versionPath]: result.fromVersion } as AnyDoc,
      buildWriteUpdate(result),
    );
    return res.matchedCount === 1;
  }

  async function markFailed(
    model: AnyModel,
    documentId: unknown,
    state: MigrationState,
  ): Promise<void> {
    try {
      await model.collection.updateOne({ _id: documentId } as AnyDoc, {
        $set: { [STATE_PATH]: state },
      });
    } catch (error) {
      logger?.warn?.('[Schemigrate] failed to persist __migrationState marker', { error });
    }
  }

  function buildFailedState(props: {
    fromVersion: SchemaVersion;
    targetVersion: SchemaVersion;
    startedAt: Date;
    error: unknown;
  }): MigrationState {
    const err = props.error as { name?: string; message?: string };
    return {
      status: 'failed',
      direction: props.targetVersion >= props.fromVersion ? 'up' : 'down',
      fromVersion: props.fromVersion,
      targetVersion: props.targetVersion,
      startedAt: props.startedAt.toISOString(),
      failedAt: new Date().toISOString(),
      error: {
        name: err?.name ?? 'Error',
        message: err?.message ?? String(props.error),
      },
    };
  }

  async function migratePojo(
    model: AnyModel,
    pojo: AnyDoc,
    targetVersion: SchemaVersion,
    options: SchemigrateMigrationOptions & { storeSnapshots?: SchemigratePluginOptions['storeSnapshots'] },
  ): Promise<MigrateDocumentResult> {
    return migrateDocumentWithMeta({
      document: pojo,
      migrations,
      targetVersion,
      versionPath,
      snapshotsPath,
      storeSnapshots: options.storeSnapshots ?? opts.storeSnapshots,
      allowDowngrade: options.allowDowngrade ?? opts.allowDowngrade,
      dryRun: options.dryRun ?? false,
      modelName: model.modelName,
      documentId: pojo._id === undefined ? undefined : String(pojo._id),
      logger,
    });
  }

  function applyResultToDoc(doc: AnyDoc & { set?: Function }, result: MigrateDocumentResult): void {
    const set = doc.set as ((p: string, v: unknown, o?: unknown) => void) | undefined;
    for (const [key, value] of Object.entries(result.changedFields)) {
      if (typeof set === 'function') set.call(doc, key, value, { strict: false });
      else doc[key] = value;
    }
    for (const key of result.removedFields) {
      if (typeof set === 'function') set.call(doc, key, undefined, { strict: false });
      else delete doc[key];
    }
  }

  function readSnapshots(pojo: AnyDoc): Record<string, MigrationSnapshotEntry> {
    const raw = getPath(pojo, snapshotsPath);
    return isPlainObject(raw) ? (raw as Record<string, MigrationSnapshotEntry>) : {};
  }

  function buildRollbackUpdate(
    stepKey: string,
    snapshot: MigrationSnapshotEntry,
    keepSnapshot: boolean,
  ): Record<string, AnyDoc> {
    const $set: AnyDoc = { ...snapshot.data };
    setPath($set, versionPath, snapshot.fromVersion);
    // Flatten nested versionPath into a dotted key for the update document.
    const update: Record<string, AnyDoc> = {
      $set: { ...snapshot.data, [versionPath]: snapshot.fromVersion },
    };
    if (!keepSnapshot) {
      update.$unset = { [`${snapshotsPath}.${stepKey}`]: '' };
    }
    return update;
  }

  // --- Instance methods (SPEC §19) -----------------------------------------

  schema.methods.getSchemaVersion = function (): SchemaVersion | undefined {
    const version = this.get(versionPath);
    return typeof version === 'number' ? version : undefined;
  };

  schema.methods.isOutdated = function (): boolean {
    const version = this.get(versionPath);
    return typeof version === 'number' && version < currentVersion;
  };

  schema.methods.isCurrentVersion = function (): boolean {
    return this.get(versionPath) === currentVersion;
  };

  schema.methods.isNewerThanSupported = function (): boolean {
    const version = this.get(versionPath);
    return typeof version === 'number' && version > currentVersion;
  };

  schema.methods.canMigrateTo = function (targetVersion: SchemaVersion): boolean {
    const version = this.get(versionPath);
    if (typeof version !== 'number') return false;
    try {
      buildMigrationPlan(migrations, version, targetVersion);
      return true;
    } catch {
      return false;
    }
  };

  schema.methods.migrateTo = async function (
    targetVersion: SchemaVersion,
    options: SchemigrateMigrationOptions = {},
  ) {
    const model = this.constructor as AnyModel;
    const save = options.save ?? opts.autoSave;
    const dryRun = options.dryRun ?? false;

    const pojo = await readPojoById(model, this._id);
    if (!pojo) {
      throw new DocumentNotFoundError({
        modelName: model.modelName,
        documentId: String(this._id),
      });
    }

    const result = await migratePojo(model, pojo, targetVersion, options);
    if (result.plan.length === 0) return this;

    if (save && !dryRun) {
      const written = await writeMigrated(model, pojo._id, result);
      if (!written) {
        throw new SchemigrateError(
          `Concurrent modification: document ${String(this._id)} of model ${model.modelName} changed between read and write. Retry the migration.`,
        );
      }
    }

    if (!dryRun) {
      applyResultToDoc(this as AnyDoc & { set?: Function }, result);
    }
    return this;
  };

  schema.methods.migrateToCurrentVersion = async function (
    options: SchemigrateMigrationOptions = {},
  ) {
    return this.migrateTo(currentVersion, options);
  };

  schema.methods.listMigrationSnapshots = function (): MigrationSnapshotInfo[] {
    const snapshots = this.get(snapshotsPath);
    if (!isPlainObject(snapshots)) return [];
    return Object.entries(snapshots).map(([stepKey, entry]) => ({
      stepKey,
      ...(entry as MigrationSnapshotEntry),
    }));
  };

  schema.methods.hasMigrationSnapshot = function (stepKey: string): boolean {
    const snapshots = this.get(snapshotsPath);
    return isPlainObject(snapshots) && stepKey in snapshots;
  };

  schema.methods.rollbackMigration = async function (
    stepKey: string,
    options: SchemigrateRollbackOptions = {},
  ) {
    const model = this.constructor as AnyModel;
    const save = options.save ?? opts.autoSave;

    const pojo = await readPojoById(model, this._id);
    if (!pojo) {
      throw new DocumentNotFoundError({
        modelName: model.modelName,
        documentId: String(this._id),
      });
    }

    const snapshot = readSnapshots(pojo)[stepKey];
    if (!snapshot || !isPlainObject(snapshot.data)) {
      throw new MissingMigrationSnapshotError({
        modelName: model.modelName,
        documentId: String(this._id),
        stepKey,
      });
    }

    if (options.dryRun) return this;

    try {
      if (save) {
        await model.collection.updateOne(
          { _id: pojo._id } as AnyDoc,
          buildRollbackUpdate(stepKey, snapshot, options.keepSnapshot ?? false),
        );
      }
      for (const [key, value] of Object.entries(snapshot.data)) {
        this.set(key, value, { strict: false });
      }
      this.set(versionPath, snapshot.fromVersion);
      if (!options.keepSnapshot) {
        const snapshots = { ...readSnapshots(pojo) };
        delete snapshots[stepKey];
        this.set(snapshotsPath, snapshots, { strict: false });
      }
    } catch (cause) {
      throw new RollbackExecutionError({
        modelName: model.modelName,
        documentId: String(this._id),
        stepKey,
        cause,
      });
    }
    return this;
  };

  schema.methods.abortMigration = async function (options: SchemigrateAbortOptions = {}) {
    const model = this.constructor as AnyModel;
    const save = options.save ?? true;
    const state = this.get(STATE_PATH) as MigrationState | undefined;

    if (!state || (state.status !== 'failed' && state.status !== 'running')) {
      return this;
    }
    if (options.dryRun) return this;

    if (save) {
      await model.collection.updateOne({ _id: this._id } as AnyDoc, {
        $unset: { [STATE_PATH]: '' },
      });
    }
    this.set(STATE_PATH, undefined, { strict: false });
    return this;
  };

  schema.methods.getMigrationState = function (): MigrationState | null {
    const state = this.get(STATE_PATH);
    return isPlainObject(state) ? (state as MigrationState) : null;
  };

  // --- Static methods (SPEC §20) -------------------------------------------

  schema.statics.getCurrentSchemaVersion = function (): SchemaVersion {
    return currentVersion;
  };

  schema.statics.getMigrationPlan = function (
    fromVersion: SchemaVersion,
    toVersion: SchemaVersion,
  ): SchemigratePlan {
    return buildMigrationPlan(migrations, fromVersion, toVersion, {
      modelName: this.modelName,
    });
  };

  schema.statics.migrateDocument = async function (
    rawDocument: AnyDoc,
    targetVersion?: SchemaVersion,
    options: SchemigrateMigrationOptions = {},
  ): Promise<AnyDoc> {
    const result = await migratePojo(
      this as AnyModel,
      rawDocument,
      targetVersion ?? currentVersion,
      options,
    );
    return result.document;
  };

  schema.statics.migrateById = async function (
    id: unknown,
    targetVersion?: SchemaVersion,
    options: SchemigrateMigrationOptions = {},
  ): Promise<unknown> {
    const model = this as AnyModel;
    const target = targetVersion ?? currentVersion;
    const dryRun = options.dryRun ?? false;
    const save = options.save ?? true;

    const pojo = await readPojoById(model, id);
    if (!pojo) {
      throw new DocumentNotFoundError({
        modelName: model.modelName,
        documentId: String(id),
      });
    }

    const startedAt = new Date();
    let result: MigrateDocumentResult;
    try {
      result = await migratePojo(model, pojo, target, options);
    } catch (error) {
      const version = getPath(pojo, versionPath);
      if (!dryRun && typeof version === 'number') {
        await markFailed(
          model,
          pojo._id,
          buildFailedState({ fromVersion: version, targetVersion: target, startedAt, error }),
        );
      }
      throw error;
    }

    if (dryRun || !save || result.plan.length === 0) {
      return result.document;
    }

    const written = await writeMigrated(model, pojo._id, result);
    if (!written) {
      throw new SchemigrateError(
        `Concurrent modification: document ${String(id)} of model ${model.modelName} changed between read and write. Retry the migration.`,
      );
    }

    return model.findById(id).setOptions({ schemigrateCheck: false }).exec();
  };

  schema.statics.migrateMany = async function (
    filter: FilterQuery<AnyDoc>,
    targetVersion?: SchemaVersion,
    options: SchemigrateBatchOptions = {},
  ): Promise<SchemigrateBatchResult> {
    const model = this as AnyModel;
    const target = targetVersion ?? currentVersion;
    const batchSize = options.batchSize ?? 100;
    const dryRun = options.dryRun ?? false;
    const continueOnError = options.continueOnError ?? false;
    const saveStrategy = options.saveStrategy ?? 'bulkWrite';

    const result = emptyBatchResult();
    const startedAt = new Date();

    const cursor = model
      .find(filter)
      .setOptions({ schemigrateCheck: false })
      .lean<AnyDoc>()
      .cursor();

    let pendingOps: AnyBulkWriteOperation<AnyDoc>[] = [];

    const flushBulk = async (): Promise<void> => {
      if (pendingOps.length === 0) return;
      const ops = pendingOps;
      pendingOps = [];
      const bulkResult = await model.collection.bulkWrite(
        ops as unknown as Parameters<typeof model.collection.bulkWrite>[0],
        { ordered: false },
      );
      result.migrated += bulkResult.matchedCount;
      result.skipped += ops.length - bulkResult.matchedCount;
    };

    for await (const pojo of cursor) {
      result.matched += 1;

      let version = getPath(pojo, versionPath);
      if (typeof version !== 'number') {
        if (opts.unknownVersionStrategy === 'ignore') {
          result.skipped += 1;
          continue;
        }
        if (opts.unknownVersionStrategy === 'setDefault') {
          setPath(pojo, versionPath, opts.defaultVersion);
          version = opts.defaultVersion;
        } else {
          const error = new MissingSchemaVersionError({
            modelName: model.modelName,
            documentId: String(pojo._id),
          });
          result.failed += 1;
          result.errors.push(error);
          if (!continueOnError) {
            await flushBulk();
            throw error;
          }
          continue;
        }
      }

      const fromVersion = version as number;

      if (fromVersion === target) {
        result.skipped += 1;
        continue;
      }

      let migrated: MigrateDocumentResult;
      try {
        migrated = await migratePojo(model, pojo, target, options);
      } catch (error) {
        result.failed += 1;
        result.errors.push(
          error instanceof SchemigrateError
            ? error
            : new SchemigrateError(String(error), { cause: error }),
        );
        if (!dryRun) {
          await markFailed(
            model,
            pojo._id,
            buildFailedState({ fromVersion, targetVersion: target, startedAt, error }),
          );
        }
        if (!continueOnError) {
          await flushBulk();
          throw error;
        }
        continue;
      }

      if (dryRun) {
        result.migrated += 1;
        continue;
      }

      if (saveStrategy === 'updateOne') {
        const written = await writeMigrated(model, pojo._id, migrated);
        if (written) result.migrated += 1;
        else result.skipped += 1;
      } else {
        pendingOps.push({
          updateOne: {
            filter: { _id: pojo._id, [versionPath]: migrated.fromVersion } as AnyDoc,
            update: buildWriteUpdate(migrated),
          },
        });
        if (pendingOps.length >= batchSize) {
          await flushBulk();
        }
      }
    }

    await flushBulk();

    logger?.info?.(
      `[Schemigrate] ${model.modelName}: migrateMany completed`,
      { ...result, errors: result.errors.length, dryRun },
    );

    return result;
  };

  schema.statics.findOutdatedDocuments = async function (): Promise<AnyDoc[]> {
    return (this as AnyModel)
      .find({ [versionPath]: { $lt: currentVersion } })
      .setOptions({ schemigrateCheck: false })
      .lean<AnyDoc[]>()
      .exec();
  };

  schema.statics.findNewerDocuments = async function (): Promise<AnyDoc[]> {
    return (this as AnyModel)
      .find({ [versionPath]: { $gt: currentVersion } })
      .setOptions({ schemigrateCheck: false })
      .lean<AnyDoc[]>()
      .exec();
  };

  schema.statics.rollbackMigrationById = async function (
    id: unknown,
    stepKey: string,
    options: SchemigrateRollbackOptions = {},
  ): Promise<AnyDoc> {
    const model = this as AnyModel;
    const pojo = await readPojoById(model, id);
    if (!pojo) {
      throw new DocumentNotFoundError({
        modelName: model.modelName,
        documentId: String(id),
      });
    }

    const snapshot = readSnapshots(pojo)[stepKey];
    if (!snapshot || !isPlainObject(snapshot.data)) {
      throw new MissingMigrationSnapshotError({
        modelName: model.modelName,
        documentId: String(id),
        stepKey,
      });
    }

    const restored = cloneDocument(pojo);
    for (const [key, value] of Object.entries(snapshot.data)) {
      restored[key] = value;
    }
    setPath(restored, versionPath, snapshot.fromVersion);
    if (!options.keepSnapshot) {
      stripPath(restored, `${snapshotsPath}.${stepKey}`);
    }

    if (options.dryRun) return restored;

    try {
      await model.collection.updateOne(
        { _id: pojo._id } as AnyDoc,
        buildRollbackUpdate(stepKey, snapshot, options.keepSnapshot ?? false),
      );
    } catch (cause) {
      throw new RollbackExecutionError({
        modelName: model.modelName,
        documentId: String(id),
        stepKey,
        cause,
      });
    }

    return restored;
  };

  schema.statics.rollbackMany = async function (
    filter: FilterQuery<AnyDoc>,
    stepKey: string,
    options: SchemigrateRollbackOptions = {},
  ): Promise<SchemigrateBatchResult> {
    const model = this as AnyModel;
    const result = emptyBatchResult();

    const docs: AnyDoc[] = await model
      .find({
        $and: [filter, { [`${snapshotsPath}.${stepKey}`]: { $exists: true } }],
      })
      .setOptions({ schemigrateCheck: false })
      .lean<AnyDoc[]>()
      .exec();

    for (const pojo of docs) {
      result.matched += 1;
      try {
        await (model as unknown as SchemaVersionedModelMethods).rollbackMigrationById(
          pojo._id,
          stepKey,
          options,
        );
        result.migrated += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push(
          error instanceof SchemigrateError
            ? error
            : new SchemigrateError(String(error), { cause: error }),
        );
      }
    }

    return result;
  };

  schema.statics.cleanupMigrationSnapshots = async function (
    filter: FilterQuery<AnyDoc>,
    options: SchemigrateCleanupOptions = {},
  ): Promise<SchemigrateCleanupResult> {
    const model = this as AnyModel;
    const dryRun = options.dryRun ?? false;
    const cutoff =
      options.olderThan === undefined ? undefined : parseOlderThan(options.olderThan);

    const docs: AnyDoc[] = await model
      .find({
        $and: [filter ?? {}, { [snapshotsPath]: { $exists: true, $ne: null } }],
      })
      .setOptions({ schemigrateCheck: false })
      .lean<AnyDoc[]>()
      .exec();

    let cleaned = 0;
    let skipped = 0;

    for (const pojo of docs) {
      const snapshots = readSnapshots(pojo);
      const keysToRemove = Object.entries(snapshots)
        .filter(([stepKey, entry]) => {
          if (options.stepKey !== undefined && stepKey !== options.stepKey) return false;
          if (options.direction !== undefined && entry.direction !== options.direction) {
            return false;
          }
          if (cutoff !== undefined) {
            const migratedAt = new Date(entry.migratedAt);
            if (Number.isNaN(migratedAt.getTime()) || migratedAt >= cutoff) return false;
          }
          return true;
        })
        .map(([stepKey]) => stepKey);

      if (keysToRemove.length === 0) {
        skipped += 1;
        continue;
      }

      if (!dryRun) {
        const unset: AnyDoc = {};
        for (const key of keysToRemove) {
          unset[`${snapshotsPath}.${key}`] = '';
        }
        await model.collection.updateOne({ _id: pojo._id } as AnyDoc, { $unset: unset });
      }
      cleaned += 1;
    }

    return { matched: docs.length, cleaned, skipped, dryRun };
  };

  schema.statics.cleanupMigrationSnapshotById = async function (
    id: unknown,
    stepKey?: string,
    options: SchemigrateCleanupOptions = {},
  ): Promise<void> {
    const model = this as AnyModel;
    if (options.dryRun) return;

    if (stepKey === undefined) {
      await model.collection.updateOne({ _id: id } as AnyDoc, {
        $unset: { [snapshotsPath]: '' },
      });
      return;
    }
    await model.collection.updateOne({ _id: id } as AnyDoc, {
      $unset: { [`${snapshotsPath}.${stepKey}`]: '' },
    });
  };

  schema.statics.syncToCurrentVersion = async function (
    options: SchemigrateBatchOptions = {},
  ): Promise<SchemigrateBatchResult> {
    const model = this as AnyModel & SchemaVersionedModelMethods;
    const clauses: AnyDoc[] = [{ [versionPath]: { $lt: currentVersion } }];
    if (opts.unknownVersionStrategy === 'setDefault') {
      clauses.push({ [versionPath]: { $exists: false } });
    }
    return model.migrateMany({ $or: clauses }, currentVersion, options);
  };

  schema.statics.getMigrationStatus = async function (): Promise<MigrationStatus> {
    const model = this as AnyModel;
    const [outdated, current, newer, failed, running] = await Promise.all([
      model.countDocuments({ [versionPath]: { $lt: currentVersion } }),
      model.countDocuments({ [versionPath]: currentVersion }),
      model.countDocuments({ [versionPath]: { $gt: currentVersion } }),
      model.countDocuments({ [`${STATE_PATH}.status`]: 'failed' }),
      model.countDocuments({ [`${STATE_PATH}.status`]: 'running' }),
    ]);

    return {
      model: model.modelName,
      currentVersion,
      outdatedDocuments: outdated,
      currentDocuments: current,
      newerDocuments: newer,
      failedDocuments: failed,
      inProgressDocuments: running,
    };
  };

  schema.statics.abortMigrationById = async function (
    id: unknown,
    options: SchemigrateAbortOptions = {},
  ): Promise<unknown> {
    const model = this as AnyModel;
    if (!options.dryRun) {
      await model.collection.updateOne(
        { _id: id, [`${STATE_PATH}.status`]: { $in: ['failed', 'running'] } } as AnyDoc,
        { $unset: { [STATE_PATH]: '' } },
      );
    }
    return model.findById(id).setOptions({ schemigrateCheck: false }).exec();
  };

  schema.statics.abortMigrationMany = async function (
    filter: FilterQuery<AnyDoc>,
    options: SchemigrateAbortOptions = {},
  ): Promise<SchemigrateBatchResult> {
    const model = this as AnyModel;
    const result = emptyBatchResult();
    const fullFilter = {
      $and: [filter ?? {}, { [`${STATE_PATH}.status`]: { $in: ['failed', 'running'] } }],
    };

    if (options.dryRun) {
      result.matched = await model.countDocuments(fullFilter);
      return result;
    }

    const updateResult = await model.collection.updateMany(
      fullFilter as AnyDoc,
      { $unset: { [STATE_PATH]: '' } },
    );
    result.matched = updateResult.matchedCount;
    result.migrated = updateResult.modifiedCount;
    result.skipped = updateResult.matchedCount - updateResult.modifiedCount;
    return result;
  };
}
