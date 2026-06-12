import { describe, it, expect } from 'vitest';
import { resolvePluginOptions } from '../../../src/plugin/schemigrate-plugin.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('resolvePluginOptions', () => {
  it('applique les valeurs par défaut de la SPEC §17', () => {
    const resolved = resolvePluginOptions({
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: containerMigrations,
    });

    expect(resolved).toMatchObject({
      versionPath: '__schemaVersion',
      versionStrategy: 'timestamp',
      autoSave: false,
      allowDowngrade: false,
      unknownVersionStrategy: 'throw',
      storeSnapshots: 'both',
      snapshotsPath: '__migrationSnapshots',
      hideInToJSON: true,
      autoRunOnBootstrap: false,
      createIndexes: true,
    });
  });

  it('defaultVersion = plus petit from des migrations déclarées', () => {
    const resolved = resolvePluginOptions({
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: containerMigrations,
    });

    expect(resolved.defaultVersion).toBe(CONTAINER_SCHEMA_V1);
  });

  it('defaultVersion = currentVersion sans migrations', () => {
    const resolved = resolvePluginOptions({
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: [],
    });

    expect(resolved.defaultVersion).toBe(CONTAINER_SCHEMA_V3);
  });

  it('backupBeforeDowngrade est un alias de storeSnapshots: down', () => {
    const resolved = resolvePluginOptions({
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: containerMigrations,
      backupBeforeDowngrade: true,
    });

    expect(resolved.storeSnapshots).toBe('down');
  });

  it('storeSnapshots explicite prime sur backupBeforeDowngrade', () => {
    const resolved = resolvePluginOptions({
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: containerMigrations,
      backupBeforeDowngrade: true,
      storeSnapshots: 'both',
    });

    expect(resolved.storeSnapshots).toBe('both');
  });

  it('backupPath est un alias de snapshotsPath', () => {
    const resolved = resolvePluginOptions({
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: containerMigrations,
      backupPath: '__backup',
    });

    expect(resolved.snapshotsPath).toBe('__backup');
  });
});
