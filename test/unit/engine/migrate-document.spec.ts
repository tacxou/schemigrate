import { describe, it, expect, vi } from 'vitest';
import {
  migrateDocument,
  migrateDocumentWithMeta,
} from '../../../src/engine/migrate-document.js';
import {
  DowngradeNotAllowedError,
  MigrationExecutionError,
  MissingSchemaVersionError,
} from '../../../src/errors/index.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V2,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('migrateDocument', () => {
  it('migre un document de V1 à V3', async () => {
    const input = {
      name: 'nginx',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    };

    const result = await migrateDocument({
      document: input,
      migrations: containerMigrations,
      targetVersion: CONTAINER_SCHEMA_V3,
    });

    expect(result.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
    expect(result.ports).toEqual(['80:80']);
    expect(result.port).toBeUndefined();
    expect(result.network).toEqual({ mode: 'bridge' });
  });

  it('ne mute jamais le document d’entrée', async () => {
    const input = {
      name: 'nginx',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    };

    await migrateDocument({
      document: input,
      migrations: containerMigrations,
      targetVersion: CONTAINER_SCHEMA_V3,
    });

    expect(input.__schemaVersion).toBe(CONTAINER_SCHEMA_V1);
    expect(input.port).toBe('80:80');
  });

  it('respecte le dry-run (mêmes résultats, pas de mutation)', async () => {
    const input = {
      name: 'nginx',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    };

    const result = await migrateDocument({
      document: input,
      migrations: containerMigrations,
      targetVersion: CONTAINER_SCHEMA_V3,
      dryRun: true,
    });

    expect(result.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
    expect(input.__schemaVersion).toBe(CONTAINER_SCHEMA_V1);
  });

  it('capture un snapshot par étape (storeSnapshots: both)', async () => {
    const result = await migrateDocumentWithMeta({
      document: { name: 'nginx', port: '80:80', __schemaVersion: CONTAINER_SCHEMA_V1 },
      migrations: containerMigrations,
      targetVersion: CONTAINER_SCHEMA_V3,
    });

    const stepKey = `${CONTAINER_SCHEMA_V1}_to_${CONTAINER_SCHEMA_V2}`;
    expect(result.snapshots[stepKey]).toMatchObject({
      direction: 'up',
      fromVersion: CONTAINER_SCHEMA_V1,
      toVersion: CONTAINER_SCHEMA_V2,
      data: { port: '80:80' },
    });
    expect(
      (result.document.__migrationSnapshots as Record<string, unknown>)[stepKey],
    ).toBeDefined();
  });

  it('ne capture aucun snapshot avec storeSnapshots: false', async () => {
    const result = await migrateDocumentWithMeta({
      document: { name: 'nginx', port: '80:80', __schemaVersion: CONTAINER_SCHEMA_V1 },
      migrations: containerMigrations,
      targetVersion: CONTAINER_SCHEMA_V3,
      storeSnapshots: false,
    });

    expect(result.snapshots).toEqual({});
    expect(result.document.__migrationSnapshots).toBeUndefined();
  });

  it('refuse le downgrade sans allowDowngrade', async () => {
    await expect(
      migrateDocument({
        document: { name: 'nginx', __schemaVersion: CONTAINER_SCHEMA_V3 },
        migrations: containerMigrations,
        targetVersion: CONTAINER_SCHEMA_V2,
      }),
    ).rejects.toBeInstanceOf(DowngradeNotAllowedError);
  });

  it('exécute un downgrade avec allowDowngrade', async () => {
    const result = await migrateDocument({
      document: {
        name: 'nginx',
        ports: ['80:80'],
        network: { mode: 'bridge' },
        __schemaVersion: CONTAINER_SCHEMA_V3,
      },
      migrations: containerMigrations,
      targetVersion: CONTAINER_SCHEMA_V2,
      allowDowngrade: true,
    });

    expect(result.__schemaVersion).toBe(CONTAINER_SCHEMA_V2);
    expect(result.network).toBeUndefined();
  });

  it('lève MissingSchemaVersionError sans champ de version', async () => {
    await expect(
      migrateDocument({
        document: { name: 'nginx' },
        migrations: containerMigrations,
        targetVersion: CONTAINER_SCHEMA_V3,
      }),
    ).rejects.toBeInstanceOf(MissingSchemaVersionError);
  });

  it('encapsule un échec de migration dans MigrationExecutionError', async () => {
    const failing = [
      {
        from: CONTAINER_SCHEMA_V1,
        to: CONTAINER_SCHEMA_V2,
        description: 'boom',
        up: async () => {
          throw new Error('kaboom');
        },
      },
    ];

    await expect(
      migrateDocument({
        document: { __schemaVersion: CONTAINER_SCHEMA_V1 },
        migrations: failing,
        targetVersion: CONTAINER_SCHEMA_V2,
      }),
    ).rejects.toMatchObject({
      name: 'MigrationExecutionError',
      fromVersion: CONTAINER_SCHEMA_V1,
      toVersion: CONTAINER_SCHEMA_V2,
      migrationDescription: 'boom',
    });
  });

  it('appelle le logger à chaque étape appliquée', async () => {
    const info = vi.fn();

    await migrateDocument({
      document: { name: 'nginx', port: '80:80', __schemaVersion: CONTAINER_SCHEMA_V1 },
      migrations: containerMigrations,
      targetVersion: CONTAINER_SCHEMA_V3,
      logger: { info },
    });

    expect(info).toHaveBeenCalledTimes(2);
  });

  it('fournit le contexte de migration aux fonctions up', async () => {
    const seen: unknown[] = [];
    const migrations = [
      {
        from: CONTAINER_SCHEMA_V1,
        to: CONTAINER_SCHEMA_V2,
        up: async (doc: Record<string, unknown>, context: unknown) => {
          seen.push(context);
          return doc;
        },
      },
    ];

    await migrateDocument({
      document: { __schemaVersion: CONTAINER_SCHEMA_V1 },
      migrations,
      targetVersion: CONTAINER_SCHEMA_V2,
      modelName: 'Container',
      documentId: '64f',
    });

    expect(seen[0]).toMatchObject({
      modelName: 'Container',
      documentId: '64f',
      fromVersion: CONTAINER_SCHEMA_V1,
      toVersion: CONTAINER_SCHEMA_V2,
      targetVersion: CONTAINER_SCHEMA_V2,
      direction: 'up',
      dryRun: false,
    });
  });
});
