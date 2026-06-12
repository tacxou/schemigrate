import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase } from '../../helpers/mongo-setup.js';
import { createContainerTestModel } from '../../helpers/create-test-model.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V2,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('Mongoose integration — status, abort, find*Documents', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('getMigrationStatus compte chaque catégorie', async () => {
    const Container = createContainerTestModel({}, 'StatusModel');
    await Container.collection.insertMany([
      { name: 'old1', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'old2', __schemaVersion: CONTAINER_SCHEMA_V2 },
      { name: 'current', __schemaVersion: CONTAINER_SCHEMA_V3 },
      { name: 'future', __schemaVersion: CONTAINER_SCHEMA_V3 + 1000 },
      {
        name: 'broken',
        __schemaVersion: CONTAINER_SCHEMA_V1,
        __migrationState: { status: 'failed' },
      },
    ]);

    const status = await Container.getMigrationStatus();

    expect(status).toMatchObject({
      model: 'StatusModel',
      currentVersion: CONTAINER_SCHEMA_V3,
      outdatedDocuments: 3,
      currentDocuments: 1,
      newerDocuments: 1,
      failedDocuments: 1,
      inProgressDocuments: 0,
    });
  });

  it('findOutdatedDocuments / findNewerDocuments retournent des POJOs sans lever', async () => {
    const Container = createContainerTestModel({}, 'StatusModel');
    await Container.collection.insertMany([
      { name: 'old', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'current', __schemaVersion: CONTAINER_SCHEMA_V3 },
      { name: 'future', __schemaVersion: CONTAINER_SCHEMA_V3 + 1000 },
    ]);

    const outdated = await Container.findOutdatedDocuments();
    const newer = await Container.findNewerDocuments();

    expect(outdated).toHaveLength(1);
    expect(outdated[0].name).toBe('old');
    expect(newer).toHaveLength(1);
    expect(newer[0].name).toBe('future');
  });

  it('abortMigrationMany nettoie les marqueurs failed', async () => {
    const Container = createContainerTestModel({}, 'StatusModel');
    await Container.collection.insertMany([
      {
        name: 'failed1',
        __schemaVersion: CONTAINER_SCHEMA_V1,
        __migrationState: { status: 'failed' },
      },
      {
        name: 'failed2',
        __schemaVersion: CONTAINER_SCHEMA_V1,
        __migrationState: { status: 'failed' },
      },
      { name: 'clean', __schemaVersion: CONTAINER_SCHEMA_V3 },
    ]);

    const result = await Container.abortMigrationMany({
      '__migrationState.status': 'failed',
    });

    expect(result.matched).toBe(2);
    expect(result.migrated).toBe(2);

    const remaining = await Container.countDocuments({
      '__migrationState.status': 'failed',
    });
    expect(remaining).toBe(0);
  });

  it('abortMigrationMany en dry-run compte sans modifier', async () => {
    const Container = createContainerTestModel({}, 'StatusModel');
    await Container.collection.insertOne({
      name: 'failed',
      __schemaVersion: CONTAINER_SCHEMA_V1,
      __migrationState: { status: 'failed' },
    });

    const result = await Container.abortMigrationMany({}, { dryRun: true });

    expect(result.matched).toBe(1);
    expect(
      await Container.countDocuments({ '__migrationState.status': 'failed' }),
    ).toBe(1);
  });

  it('doc.abortMigration nettoie le marqueur sur le document', async () => {
    const Container = createContainerTestModel({}, 'StatusModel');
    const { insertedId } = await Container.collection.insertOne({
      name: 'failed',
      __schemaVersion: CONTAINER_SCHEMA_V3,
      __migrationState: { status: 'failed' },
    });

    const doc = await Container.findById(insertedId);
    expect(doc!.getMigrationState()?.status).toBe('failed');

    await doc!.abortMigration();

    const raw = await Container.collection.findOne({ _id: insertedId });
    expect(raw?.__migrationState).toBeUndefined();
    expect(doc!.getMigrationState()).toBeNull();
  });

  it('une migration réussie nettoie un marqueur failed précédent', async () => {
    const Container = createContainerTestModel({}, 'StatusModel');
    const { insertedId } = await Container.collection.insertOne({
      name: 'retry',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
      __migrationState: { status: 'failed' },
    });

    await Container.migrateById(insertedId, CONTAINER_SCHEMA_V3);

    const raw = await Container.collection.findOne({ _id: insertedId });
    expect(raw?.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
    expect(raw?.__migrationState).toBeUndefined();
  });
});
