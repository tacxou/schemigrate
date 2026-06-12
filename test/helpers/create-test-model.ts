import mongoose, { Schema } from 'mongoose';
import { schemigratePlugin } from '../../src/plugin/schemigrate-plugin.js';
import type { SchemaVersionedModel } from '../../src/plugin/schemigrate-plugin.js';
import type { SchemigratePluginOptions } from '../../src/types.js';
import { containerMigrations } from '../fixtures/container.migrations.js';
import { CONTAINER_SCHEMA_V3 } from '../fixtures/versions.js';

export type ContainerShape = {
  name?: string;
  image?: string;
  port?: string;
  ports?: string[];
  network?: { mode?: string };
};

let counter = 0;

/**
 * Creates a fresh test model with the schemigrate plugin applied.
 * Legacy fields (`port`) are kept in the schema only so that fixtures can be
 * seeded through Mongoose; the engine itself works on raw POJOs.
 */
export function createContainerTestModel(
  overrides: Partial<SchemigratePluginOptions> = {},
  name?: string,
): SchemaVersionedModel<ContainerShape> {
  const modelName = name ?? `ContainerTest${counter++}`;

  if (mongoose.models[modelName]) {
    return mongoose.models[modelName] as unknown as SchemaVersionedModel<ContainerShape>;
  }

  const schema = new Schema({
    name: String,
    image: String,
    port: String,
    ports: [String],
    network: { mode: String },
  });

  schema.plugin(schemigratePlugin, {
    currentVersion: CONTAINER_SCHEMA_V3,
    migrations: containerMigrations,
    ...overrides,
  });

  return mongoose.model(modelName, schema) as unknown as SchemaVersionedModel<ContainerShape>;
}
