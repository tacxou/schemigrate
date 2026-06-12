import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase } from '../../helpers/mongo-setup.js';
import { createContainerTestModel } from '../../helpers/create-test-model.js';
import {
  DocumentNotFoundError,
  DowngradeNotAllowedError,
} from '../../../src/errors/index.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V2,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('Mongoose integration — migration de document', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('migre et persiste un document via migrateToCurrentVersion({ save: true })', async () => {
    const Container = createContainerTestModel({}, 'MigrateDocModel');

    const container = await Container.create({
      name: 'nginx',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    await container.migrateToCurrentVersion({ save: true });

    const reloaded = await Container.collection.findOne({ _id: container._id });
    expect(reloaded?.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
    expect(reloaded?.ports).toEqual(['80:80']);
    expect(reloaded?.port).toBeUndefined();
    expect(reloaded?.network).toEqual({ mode: 'bridge' });
  });

  it('migrateById persiste et retourne le document à jour', async () => {
    const Container = createContainerTestModel({}, 'MigrateDocModel');
    const { insertedId } = await Container.collection.insertOne({
      name: 'legacy',
      port: '443:443',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    const migrated = (await Container.migrateById(
      insertedId,
      CONTAINER_SCHEMA_V3,
    )) as { get: (p: string) => unknown };

    expect(migrated.get('__schemaVersion')).toBe(CONTAINER_SCHEMA_V3);

    const raw = await Container.collection.findOne({ _id: insertedId });
    expect(raw?.ports).toEqual(['443:443']);
  });

  it('migrateById en dry-run ne modifie pas la base', async () => {
    const Container = createContainerTestModel({}, 'MigrateDocModel');
    const { insertedId } = await Container.collection.insertOne({
      name: 'legacy',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    const preview = (await Container.migrateById(insertedId, CONTAINER_SCHEMA_V3, {
      dryRun: true,
    })) as Record<string, unknown>;

    expect(preview.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);

    const raw = await Container.collection.findOne({ _id: insertedId });
    expect(raw?.__schemaVersion).toBe(CONTAINER_SCHEMA_V1);
    expect(raw?.port).toBe('80:80');
  });

  it('migrateById lève DocumentNotFoundError sur un id inconnu', async () => {
    const Container = createContainerTestModel({}, 'MigrateDocModel');

    await expect(
      Container.migrateById('64f000000000000000000000', CONTAINER_SCHEMA_V3),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
  });

  it('migrateById enregistre un marqueur failed sans toucher aux champs métier', async () => {
    const failing = [
      {
        from: CONTAINER_SCHEMA_V1,
        to: CONTAINER_SCHEMA_V2,
        up: async () => {
          throw new Error('kaboom');
        },
      },
      {
        from: CONTAINER_SCHEMA_V2,
        to: CONTAINER_SCHEMA_V3,
        up: async (doc: Record<string, unknown>) => doc,
      },
    ];
    const Container = createContainerTestModel({ migrations: failing }, 'FailingModel');
    const { insertedId } = await Container.collection.insertOne({
      name: 'legacy',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    await expect(
      Container.migrateById(insertedId, CONTAINER_SCHEMA_V3),
    ).rejects.toMatchObject({ name: 'MigrationExecutionError' });

    const raw = await Container.collection.findOne({ _id: insertedId });
    expect(raw?.__schemaVersion).toBe(CONTAINER_SCHEMA_V1);
    expect(raw?.port).toBe('80:80');
    expect(raw?.__migrationState?.status).toBe('failed');
    expect(raw?.__migrationState?.error?.name).toBe('MigrationExecutionError');
  });

  it('le downgrade explicite fonctionne avec allowDowngrade', async () => {
    const Container = createContainerTestModel(
      { allowDowngrade: true },
      'DowngradeModel',
    );
    const { insertedId } = await Container.collection.insertOne({
      name: 'nginx',
      ports: ['80:80'],
      network: { mode: 'bridge' },
      __schemaVersion: CONTAINER_SCHEMA_V3,
    });

    await Container.migrateById(insertedId, CONTAINER_SCHEMA_V2);

    const raw = await Container.collection.findOne({ _id: insertedId });
    expect(raw?.__schemaVersion).toBe(CONTAINER_SCHEMA_V2);
    expect(raw?.network).toBeUndefined();
  });

  it('le downgrade est refusé sans allowDowngrade', async () => {
    const Container = createContainerTestModel({}, 'MigrateDocModel');
    const { insertedId } = await Container.collection.insertOne({
      name: 'nginx',
      ports: ['80:80'],
      __schemaVersion: CONTAINER_SCHEMA_V3,
    });

    await expect(
      Container.migrateById(insertedId, CONTAINER_SCHEMA_V2),
    ).rejects.toBeInstanceOf(DowngradeNotAllowedError);
  });

  it('Model.migrateDocument migre un POJO sans toucher à la base', async () => {
    const Container = createContainerTestModel({}, 'MigrateDocModel');

    const migrated = await Container.migrateDocument({
      name: 'nginx',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    expect(migrated.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
    expect(migrated.ports).toEqual(['80:80']);
    expect(await Container.countDocuments({})).toBe(0);
  });
});
