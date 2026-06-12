// @tacxou/schemigrate — main entry point.
// The NestJS integration is NOT re-exported here: import it explicitly
// from '@tacxou/schemigrate/nestjs' (SPEC §7, §30).

export { schemigratePlugin, resolvePluginOptions } from './plugin/schemigrate-plugin.js';
export type {
  SchemaVersionedDocument,
  SchemaVersionedDocumentMethods,
  SchemaVersionedModel,
  SchemaVersionedModelMethods,
} from './plugin/schemigrate-plugin.js';

export { stripReservedFields, DEFAULT_RESERVED_PATHS } from './plugin/to-json.js';
export { assertReadableVersions } from './plugin/read-guard.js';
export type { ReadGuardOptions } from './plugin/read-guard.js';

export { buildMigrationPlan } from './engine/build-migration-plan.js';
export { validateMigrations } from './engine/validate-migrations.js';
export { migrateDocument, migrateDocumentWithMeta } from './engine/migrate-document.js';
export type { MigrateDocumentInput, MigrateDocumentResult } from './engine/migrate-document.js';
export {
  buildStepKey,
  captureSnapshotData,
  buildSnapshotEntry,
  shouldStoreSnapshot,
  applySnapshotData,
} from './engine/snapshots.js';

export { createSchemaVersion } from './utils/create-schema-version.js';

export {
  SchemigrateError,
  MissingSchemaVersionError,
  UnsupportedSchemaVersionError,
  OutdatedDocumentError,
  MissingMigrationError,
  MissingDowngradeMigrationError,
  DowngradeNotAllowedError,
  MigrationExecutionError,
  InvalidMigrationConfigurationError,
  MissingMigrationSnapshotError,
  RollbackExecutionError,
  DocumentNotFoundError,
} from './errors/index.js';
export type { OutdatedDocumentRef } from './errors/index.js';

export type {
  SchemaVersion,
  SchemigrateLogger,
  MigrationDirection,
  MigrationContext,
  MigrationFn,
  Migration,
  SchemigratePlanStep,
  SchemigratePlan,
  StoreSnapshotsOption,
  UnknownVersionStrategy,
  SchemigratePluginOptions,
  ResolvedSchemigrateOptions,
  SchemigrateMigrationOptions,
  SchemigrateBatchOptions,
  SchemigrateBatchResult,
  MigrationSnapshotInfo,
  MigrationSnapshotEntry,
  SchemigrateRollbackOptions,
  SchemigrateCleanupOptions,
  SchemigrateCleanupResult,
  SchemigrateAbortOptions,
  MigrationStatus,
  MigrationStateStatus,
  MigrationState,
  SchemigrateDryRunResult,
} from './types.js';
