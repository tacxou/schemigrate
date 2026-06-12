import type {
  Migration,
  SchemaVersion,
  SchemigrateLogger,
  StoreSnapshotsOption,
  UnknownVersionStrategy,
} from '../types.js';

/** Per-model entry of schemigrate.config.ts (SPEC §42.7). */
export type SchemigrateCliModelConfig = {
  /** Model name, used as the CLI argument (e.g. `schemigrate up Container`). */
  name: string;
  /** MongoDB collection. Defaults to the Mongoose pluralization of `name`. */
  collection?: string;
  currentVersion: SchemaVersion;
  migrations: Migration[];
  versionPath?: string;
  snapshotsPath?: string;
  defaultVersion?: SchemaVersion;
  allowDowngrade?: boolean;
  unknownVersionStrategy?: UnknownVersionStrategy;
  storeSnapshots?: StoreSnapshotsOption;
};

export type SchemigrateCliConfig = {
  /** MongoDB connection string. Can be overridden with `--uri`. */
  uri?: string;
  models: SchemigrateCliModelConfig[];
  logger?: SchemigrateLogger;
};

/**
 * Identity helper providing type-safety and discoverability for
 * schemigrate.config.ts (SPEC §42.7).
 */
export function defineSchemigrateConfig(config: SchemigrateCliConfig): SchemigrateCliConfig {
  return config;
}
