import mongoose, { Schema, type Connection } from 'mongoose';
import { schemigratePlugin, type SchemaVersionedModel } from '../plugin/schemigrate-plugin.js';
import { SchemigrateError } from '../errors/index.js';
import type { SchemigrateCliConfig, SchemigrateCliModelConfig } from './define-config.js';

export type CliModelEntry = {
  model: SchemaVersionedModel<Record<string, unknown>>;
  config: SchemigrateCliModelConfig;
};

export type CliRuntime = {
  connection: Connection;
  entries: Map<string, CliModelEntry>;
  getEntry(name: string): CliModelEntry;
  close(): Promise<void>;
};

/**
 * Builds the CLI runtime: one dedicated connection and, per configured model,
 * a `strict: false` schema carrying the schemigrate plugin. The CLI thus
 * operates at collection level (POJOs, SPEC §11/§42.7) while reusing the
 * exact same engine and statics as the application plugin.
 */
export async function createCliRuntime(
  config: SchemigrateCliConfig,
  uriOverride?: string,
): Promise<CliRuntime> {
  const uri = uriOverride ?? config.uri;
  if (!uri) {
    throw new SchemigrateError(
      'No MongoDB URI: set `uri` in schemigrate.config or pass --uri.',
    );
  }

  const connection = await mongoose
    .createConnection(uri, { serverSelectionTimeoutMS: 10_000 })
    .asPromise();

  const entries = new Map<string, CliModelEntry>();

  for (const modelConfig of config.models) {
    const schema = new Schema(
      {},
      {
        strict: false,
        minimize: false,
        ...(modelConfig.collection ? { collection: modelConfig.collection } : {}),
      },
    );

    schema.plugin(schemigratePlugin, {
      currentVersion: modelConfig.currentVersion,
      migrations: modelConfig.migrations,
      versionPath: modelConfig.versionPath,
      snapshotsPath: modelConfig.snapshotsPath,
      defaultVersion: modelConfig.defaultVersion,
      allowDowngrade: modelConfig.allowDowngrade,
      unknownVersionStrategy: modelConfig.unknownVersionStrategy,
      storeSnapshots: modelConfig.storeSnapshots,
      logger: config.logger,
      // CLI models are throwaway: indexes belong to the application.
      createIndexes: false,
    });

    const model = connection.model(
      modelConfig.name,
      schema,
    ) as unknown as SchemaVersionedModel<Record<string, unknown>>;

    entries.set(modelConfig.name, { model, config: modelConfig });
  }

  return {
    connection,
    entries,
    getEntry(name: string): CliModelEntry {
      const entry = entries.get(name);
      if (!entry) {
        throw new SchemigrateError(
          `Unknown model '${name}'. Configured models: ${[...entries.keys()].join(', ')}.`,
        );
      }
      return entry;
    },
    async close(): Promise<void> {
      await connection.close();
    },
  };
}
