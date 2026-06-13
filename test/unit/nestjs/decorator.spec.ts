import { describe, it, expect } from 'vitest';
import { Schema } from 'mongoose';
import {
  Schemigrate,
  applySchemigratePlugin,
  getSchemigrateMetadata,
} from '../../../src/nestjs/schemigrate.decorator.js';
import { InvalidMigrationConfigurationError } from '../../../src/errors/index.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import { CONTAINER_SCHEMA_V3 } from '../../fixtures/versions.js';

describe('@Schemigrate decorator (SPEC §40)', () => {
  it('attache les options de plugin à la classe', () => {
    @Schemigrate({ currentVersion: CONTAINER_SCHEMA_V3, migrations: containerMigrations })
    class Container {}

    const metadata = getSchemigrateMetadata(Container);
    expect(metadata).toMatchObject({
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: containerMigrations,
    });
  });

  it('applySchemigratePlugin applique le plugin au schema', () => {
    @Schemigrate({ currentVersion: CONTAINER_SCHEMA_V3, migrations: containerMigrations })
    class Container {}

    const schema = new Schema({ name: String, port: String, ports: [String] });
    applySchemigratePlugin(schema, Container);

    expect(schema.path('__schemaVersion')).toBeDefined();
    expect(schema.path('__migrationSnapshots')).toBeDefined();
    expect(schema.statics.getCurrentSchemaVersion).toBeTypeOf('function');
    expect(schema.methods.migrateToCurrentVersion).toBeTypeOf('function');
  });

  it('lève si le décorateur est absent', () => {
    class Bare {}
    const schema = new Schema({ name: String });

    expect(() => applySchemigratePlugin(schema, Bare)).toThrowError(
      InvalidMigrationConfigurationError,
    );
  });

  it('retourne le même schema (chaînable)', () => {
    @Schemigrate({ currentVersion: CONTAINER_SCHEMA_V3, migrations: containerMigrations })
    class Container {}

    const schema = new Schema({ name: String });
    expect(applySchemigratePlugin(schema, Container)).toBe(schema);
  });
});
