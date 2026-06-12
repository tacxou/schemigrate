import { describe, it, expect } from 'vitest';
import * as schemigrate from '../../src/index.js';

describe('@tacxou/schemigrate — surface du point d’entrée', () => {
  it('exporte le plugin, le moteur, le helper et les erreurs', () => {
    expect(schemigrate.schemigratePlugin).toBeTypeOf('function');
    expect(schemigrate.createSchemaVersion).toBeTypeOf('function');
    expect(schemigrate.migrateDocument).toBeTypeOf('function');
    expect(schemigrate.buildMigrationPlan).toBeTypeOf('function');
    expect(schemigrate.validateMigrations).toBeTypeOf('function');
    expect(schemigrate.stripReservedFields).toBeTypeOf('function');
    expect(schemigrate.SchemigrateError).toBeTypeOf('function');
    expect(schemigrate.OutdatedDocumentError).toBeTypeOf('function');
    expect(schemigrate.UnsupportedSchemaVersionError).toBeTypeOf('function');
    expect(schemigrate.MissingMigrationError).toBeTypeOf('function');
  });

  it('ne réexporte pas l’intégration NestJS (SPEC §7)', () => {
    const keys = Object.keys(schemigrate);
    expect(keys.some((key) => /nest/i.test(key))).toBe(false);
  });
});
