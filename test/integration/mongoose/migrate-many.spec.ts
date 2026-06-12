import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase } from '../../helpers/mongo-setup.js';
import { createContainerTestModel } from '../../helpers/create-test-model.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V2,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('Mongoose integration — migrateMany', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('migre un lot de documents obsolètes (bulkWrite par défaut)', async () => {
    const Container = createContainerTestModel({}, 'BatchModel');
    await Container.collection.insertMany([
      { name: 'a', port: '80:80', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'b', port: '443:443', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'c', ports: ['8080:80'], __schemaVersion: CONTAINER_SCHEMA_V2 },
    ]);

    const result = await Container.migrateMany(
      { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
      CONTAINER_SCHEMA_V3,
      { batchSize: 2 },
    );

    expect(result.matched).toBe(3);
    expect(result.migrated).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);

    const count = await Container.countDocuments({
      __schemaVersion: CONTAINER_SCHEMA_V3,
    });
    expect(count).toBe(3);
  });

  it('stratégie updateOne : mêmes résultats', async () => {
    const Container = createContainerTestModel({}, 'BatchModel');
    await Container.collection.insertMany([
      { name: 'a', port: '80:80', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'b', port: '443:443', __schemaVersion: CONTAINER_SCHEMA_V1 },
    ]);

    const result = await Container.migrateMany(
      { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
      CONTAINER_SCHEMA_V3,
      { saveStrategy: 'updateOne' },
    );

    expect(result.migrated).toBe(2);
    expect(
      await Container.countDocuments({ __schemaVersion: CONTAINER_SCHEMA_V3 }),
    ).toBe(2);
  });

  it('dry-run : rapport complet, aucune écriture', async () => {
    const Container = createContainerTestModel({}, 'BatchModel');
    await Container.collection.insertMany([
      { name: 'a', port: '80:80', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'b', port: '443:443', __schemaVersion: CONTAINER_SCHEMA_V1 },
    ]);

    const result = await Container.migrateMany(
      { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
      CONTAINER_SCHEMA_V3,
      { dryRun: true },
    );

    expect(result.migrated).toBe(2);
    expect(
      await Container.countDocuments({ __schemaVersion: CONTAINER_SCHEMA_V1 }),
    ).toBe(2);
    expect(
      await Container.countDocuments({ __schemaVersion: CONTAINER_SCHEMA_V3 }),
    ).toBe(0);
  });

  it('continueOnError collecte les erreurs et migre le reste', async () => {
    const flaky = [
      {
        from: CONTAINER_SCHEMA_V1,
        to: CONTAINER_SCHEMA_V2,
        up: async (doc: Record<string, unknown>) => {
          if (doc.name === 'bad') throw new Error('kaboom');
          if (doc.port && !doc.ports) doc.ports = [doc.port];
          delete doc.port;
          return doc;
        },
      },
      {
        from: CONTAINER_SCHEMA_V2,
        to: CONTAINER_SCHEMA_V3,
        up: async (doc: Record<string, unknown>) => doc,
      },
    ];
    const Container = createContainerTestModel({ migrations: flaky }, 'FlakyBatchModel');
    await Container.collection.insertMany([
      { name: 'good', port: '80:80', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'bad', port: '443:443', __schemaVersion: CONTAINER_SCHEMA_V1 },
    ]);

    const result = await Container.migrateMany(
      { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
      CONTAINER_SCHEMA_V3,
      { continueOnError: true },
    );

    expect(result.migrated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);

    const bad = await Container.collection.findOne({ name: 'bad' });
    expect(bad?.__schemaVersion).toBe(CONTAINER_SCHEMA_V1);
    expect(bad?.__migrationState?.status).toBe('failed');
  });

  it('sans continueOnError, la première erreur interrompt le batch', async () => {
    const failing = [
      {
        from: CONTAINER_SCHEMA_V1,
        to: CONTAINER_SCHEMA_V3,
        up: async () => {
          throw new Error('kaboom');
        },
      },
    ];
    const Container = createContainerTestModel({ migrations: failing }, 'AbortBatchModel');
    await Container.collection.insertMany([
      { name: 'a', __schemaVersion: CONTAINER_SCHEMA_V1 },
    ]);

    await expect(
      Container.migrateMany({}, CONTAINER_SCHEMA_V3),
    ).rejects.toMatchObject({ name: 'MigrationExecutionError' });
  });

  it('skippe les documents déjà à la version cible', async () => {
    const Container = createContainerTestModel({}, 'BatchModel');
    await Container.collection.insertMany([
      { name: 'current', __schemaVersion: CONTAINER_SCHEMA_V3 },
      { name: 'old', port: '80:80', __schemaVersion: CONTAINER_SCHEMA_V1 },
    ]);

    const result = await Container.migrateMany({}, CONTAINER_SCHEMA_V3);

    expect(result.matched).toBe(2);
    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('verrou optimiste : un document modifié entre lecture et écriture est skippé', async () => {
    const slow = [
      {
        from: CONTAINER_SCHEMA_V1,
        to: CONTAINER_SCHEMA_V3,
        up: async (doc: Record<string, unknown>) => {
          // Simulate a concurrent migration while this one is in memory.
          await Container.collection.updateOne(
            { _id: doc._id as never },
            { $set: { __schemaVersion: CONTAINER_SCHEMA_V3, concurrent: true } },
          );
          return doc;
        },
      },
    ];
    const Container = createContainerTestModel({ migrations: slow }, 'RaceModel');
    await Container.collection.insertMany([
      { name: 'raced', __schemaVersion: CONTAINER_SCHEMA_V1 },
    ]);

    const result = await Container.migrateMany({}, CONTAINER_SCHEMA_V3);

    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(1);

    const raw = await Container.collection.findOne({ name: 'raced' });
    expect(raw?.concurrent).toBe(true);
  });

  it('syncToCurrentVersion migre tous les documents obsolètes', async () => {
    const Container = createContainerTestModel({}, 'BatchModel');
    await Container.collection.insertMany([
      { name: 'a', port: '80:80', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'b', __schemaVersion: CONTAINER_SCHEMA_V3 },
    ]);

    const result = await Container.syncToCurrentVersion();

    expect(result.matched).toBe(1);
    expect(result.migrated).toBe(1);
    expect(
      await Container.countDocuments({ __schemaVersion: CONTAINER_SCHEMA_V3 }),
    ).toBe(2);
  });
});
