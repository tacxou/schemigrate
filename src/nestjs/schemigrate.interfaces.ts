import type { LoggerService, ModuleMetadata } from '@nestjs/common';
import type {
  Migration,
  SchemaVersion,
  SchemigrateBatchOptions,
  SchemigrateLogger,
} from '../types.js';

export type SchemigrateModuleOptions = {
  /**
   * Logger configuration (SPEC §38):
   * - `true` → a NestJS `Logger('Schemigrate')` is created;
   * - a NestJS `LoggerService` (e.g. `new Logger('Schemigrate')`) → adapted;
   * - a plain `SchemigrateLogger` → used as-is;
   * - `false` / `undefined` → no logging.
   */
  logger?: boolean | LoggerService | SchemigrateLogger;

  /** Migrate every registered model to currentVersion on bootstrap. Default: false. */
  autoRunOnBootstrap?: boolean;

  /** Batch options used by the bootstrap sync (`syncAllToCurrentVersion`). */
  bootstrapOptions?: SchemigrateBatchOptions;
};

export type SchemigrateModuleAsyncOptions = Pick<ModuleMetadata, 'imports'> & {
  inject?: unknown[];
  useFactory: (
    ...args: never[]
  ) => SchemigrateModuleOptions | Promise<SchemigrateModuleOptions>;
};

/** Per-model registration for SchemigrateModule.forFeature() (SPEC §36). */
export type SchemigrateFeatureOptions = {
  modelName: string;
  currentVersion: SchemaVersion;
  versionPath?: string;
  migrations: Migration[];
};
