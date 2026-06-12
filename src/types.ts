import type { SchemigrateError } from './errors/index.js';

/** Structure version: a Unix timestamp in milliseconds (UTC) by default. */
export type SchemaVersion = number;

export type SchemigrateLogger = {
  debug?: (message: string, meta?: unknown) => void;
  info?: (message: string, meta?: unknown) => void;
  warn?: (message: string, meta?: unknown) => void;
  error?: (message: string, meta?: unknown) => void;
};

export type MigrationDirection = 'up' | 'down';

export type MigrationContext = {
  modelName?: string;
  documentId?: string;
  fromVersion: SchemaVersion;
  toVersion: SchemaVersion;
  targetVersion: SchemaVersion;
  direction: MigrationDirection;
  dryRun: boolean;
  logger?: SchemigrateLogger;
};

export type MigrationFn = (
  doc: Record<string, unknown>,
  context: MigrationContext,
) => unknown | Promise<unknown>;

export type Migration = {
  from: SchemaVersion;
  to: SchemaVersion;
  up: MigrationFn;
  down?: MigrationFn;
  description?: string;
};

export type SchemigratePlanStep = {
  from: SchemaVersion;
  to: SchemaVersion;
  direction: MigrationDirection;
  description?: string;
};

export type SchemigratePlan = SchemigratePlanStep[];

export type StoreSnapshotsOption = 'up' | 'down' | 'both' | false;

export type UnknownVersionStrategy = 'throw' | 'ignore' | 'setDefault';

export type SchemigratePluginOptions = {
  currentVersion: SchemaVersion;

  versionPath?: string;

  migrations: Migration[];

  defaultVersion?: SchemaVersion;

  versionStrategy?: 'timestamp' | 'sequential';

  autoSave?: boolean;

  allowDowngrade?: boolean;

  unknownVersionStrategy?: UnknownVersionStrategy;

  storeSnapshots?: StoreSnapshotsOption;

  snapshotsPath?: string;

  /** @deprecated use storeSnapshots: 'down' */
  backupBeforeDowngrade?: boolean;

  /** @deprecated use snapshotsPath */
  backupPath?: string;

  logger?: SchemigrateLogger;

  hideInToJSON?: boolean;

  autoRunOnBootstrap?: boolean;

  /** Creates indexes on versionPath and __migrationState.status. Default: true. */
  createIndexes?: boolean;
};

export type ResolvedSchemigrateOptions = Required<
  Pick<
    SchemigratePluginOptions,
    | 'currentVersion'
    | 'versionPath'
    | 'migrations'
    | 'versionStrategy'
    | 'autoSave'
    | 'allowDowngrade'
    | 'unknownVersionStrategy'
    | 'storeSnapshots'
    | 'snapshotsPath'
    | 'hideInToJSON'
    | 'autoRunOnBootstrap'
    | 'createIndexes'
  >
> & {
  defaultVersion: SchemaVersion;
  logger?: SchemigrateLogger;
};

export type SchemigrateMigrationOptions = {
  save?: boolean;
  dryRun?: boolean;
  allowDowngrade?: boolean;
  storeSnapshots?: StoreSnapshotsOption;
};

export type SchemigrateBatchOptions = {
  batchSize?: number;
  dryRun?: boolean;
  continueOnError?: boolean;
  saveStrategy?: 'updateOne' | 'bulkWrite';
  allowDowngrade?: boolean;
  storeSnapshots?: StoreSnapshotsOption;
};

export type SchemigrateBatchResult = {
  matched: number;
  migrated: number;
  skipped: number;
  failed: number;
  errors: SchemigrateError[];
};

export type MigrationSnapshotInfo = {
  stepKey: string;
  direction: MigrationDirection;
  fromVersion: SchemaVersion;
  toVersion: SchemaVersion;
  migratedAt: string;
  data: Record<string, unknown>;
};

export type MigrationSnapshotEntry = Omit<MigrationSnapshotInfo, 'stepKey'>;

export type SchemigrateRollbackOptions = {
  save?: boolean;
  dryRun?: boolean;
  /** Keep the snapshot after a successful rollback. Default: false. */
  keepSnapshot?: boolean;
};

export type SchemigrateCleanupOptions = {
  stepKey?: string;
  /** A Date, or a relative duration: '<n>d' (days), '<n>h' (hours), '<n>m' (minutes). */
  olderThan?: Date | string;
  direction?: MigrationDirection;
  dryRun?: boolean;
  batchSize?: number;
};

export type SchemigrateCleanupResult = {
  matched: number;
  cleaned: number;
  skipped: number;
  dryRun: boolean;
};

export type SchemigrateAbortOptions = {
  save?: boolean;
  dryRun?: boolean;
  targetVersion?: SchemaVersion;
};

export type MigrationStatus = {
  model: string;
  currentVersion: SchemaVersion;
  outdatedDocuments: number;
  currentDocuments: number;
  newerDocuments: number;
  failedDocuments: number;
  inProgressDocuments: number;
};

export type MigrationStateStatus = 'running' | 'failed' | 'completed';

export type MigrationState = {
  status: MigrationStateStatus;
  direction: MigrationDirection;
  fromVersion: SchemaVersion;
  targetVersion: SchemaVersion;
  startedAt: string;
  failedAt?: string;
  lastCompletedStep?: string;
  currentStep?: string;
  error?: {
    name: string;
    message: string;
  };
};

export type SchemigrateDryRunResult = {
  documentId?: string;
  fromVersion: SchemaVersion;
  targetVersion: SchemaVersion;
  plan: SchemigratePlan;
  snapshotsPreview: Record<string, MigrationSnapshotInfo>;
  changesPreview: Record<string, unknown>;
};
