import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase } from '../../helpers/mongo-setup.js';
import { createContainerTestModel } from '../../helpers/create-test-model.js';
import { MissingMigrationSnapshotError } from '../../../src/errors/index.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V2,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

const STEP_1_2 = `${CONTAINER_SCHEMA_V1}_to_${CONTAINER_SCHEMA_V2}`;
const STEP_2_3 = `${CONTAINER_SCHEMA_V2}_to_${CONTAINER_SCHEMA_V3}`;

describe('Mongoose integration — snapshots, rollback, cleanup', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  async function seedAndMigrate(Container: ReturnType<typeof createContainerTestModel>) {
    const { insertedId } = await Container.collection.insertOne({
      name: 'nginx',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });
    await Container.migrateById(insertedId, CONTAINER_SCHEMA_V3);
    return insertedId;
  }

  it('persiste un snapshot par étape dans __migrationSnapshots', async () => {
    const Container = createContainerTestModel({}, 'SnapModel');
    const id = await seedAndMigrate(Container);

    const raw = await Container.collection.findOne({ _id: id });
    expect(raw?.__migrationSnapshots?.[STEP_1_2]).toMatchObject({
      direction: 'up',
      fromVersion: CONTAINER_SCHEMA_V1,
      toVersion: CONTAINER_SCHEMA_V2,
      data: { port: '80:80' },
    });
    // V2 -> V3 only adds `network`: nothing to restore, empty snapshot data.
    expect(raw?.__migrationSnapshots?.[STEP_2_3]).toMatchObject({
      direction: 'up',
      fromVersion: CONTAINER_SCHEMA_V2,
      toVersion: CONTAINER_SCHEMA_V3,
      data: {},
    });
  });

  it('rollbackMigrationById restaure les données et la version', async () => {
    const Container = createContainerTestModel({}, 'SnapModel');
    const id = await seedAndMigrate(Container);

    await Container.rollbackMigrationById(id, STEP_1_2);

    const raw = await Container.collection.findOne({ _id: id });
    expect(raw?.__schemaVersion).toBe(CONTAINER_SCHEMA_V1);
    expect(raw?.port).toBe('80:80');
    expect(raw?.__migrationSnapshots?.[STEP_1_2]).toBeUndefined();
  });

  it('rollback avec keepSnapshot conserve le snapshot', async () => {
    const Container = createContainerTestModel({}, 'SnapModel');
    const id = await seedAndMigrate(Container);

    await Container.rollbackMigrationById(id, STEP_1_2, { keepSnapshot: true });

    const raw = await Container.collection.findOne({ _id: id });
    expect(raw?.__migrationSnapshots?.[STEP_1_2]).toBeDefined();
  });

  it('rollback en dry-run ne modifie pas la base', async () => {
    const Container = createContainerTestModel({}, 'SnapModel');
    const id = await seedAndMigrate(Container);

    await Container.rollbackMigrationById(id, STEP_1_2, { dryRun: true });

    const raw = await Container.collection.findOne({ _id: id });
    expect(raw?.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
  });

  it('lève MissingMigrationSnapshotError si le snapshot est absent', async () => {
    const Container = createContainerTestModel({}, 'SnapModel');
    const { insertedId } = await Container.collection.insertOne({
      name: 'no-snap',
      __schemaVersion: CONTAINER_SCHEMA_V3,
    });

    await expect(
      Container.rollbackMigrationById(insertedId, STEP_1_2),
    ).rejects.toBeInstanceOf(MissingMigrationSnapshotError);
  });

  it('doc.listMigrationSnapshots / hasMigrationSnapshot exposent les snapshots', async () => {
    const Container = createContainerTestModel({}, 'SnapModel');
    const id = await seedAndMigrate(Container);

    const doc = await Container.findById(id);
    const snapshots = doc!.listMigrationSnapshots();

    expect(snapshots.map((s) => s.stepKey).sort()).toEqual([STEP_1_2, STEP_2_3]);
    expect(doc!.hasMigrationSnapshot(STEP_1_2)).toBe(true);
    expect(doc!.hasMigrationSnapshot('nope')).toBe(false);
  });

  it('cleanupMigrationSnapshots --older-than nettoie les snapshots anciens', async () => {
    const Container = createContainerTestModel({}, 'SnapModel');
    const id = await seedAndMigrate(Container);

    // Backdate one snapshot to 40 days ago.
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await Container.collection.updateOne(
      { _id: id },
      { $set: { [`__migrationSnapshots.${STEP_1_2}.migratedAt`]: old } },
    );

    const result = await Container.cleanupMigrationSnapshots({}, { olderThan: '30d' });

    expect(result).toMatchObject({ matched: 1, cleaned: 1, skipped: 0, dryRun: false });

    const raw = await Container.collection.findOne({ _id: id });
    expect(raw?.__migrationSnapshots?.[STEP_1_2]).toBeUndefined();
    expect(raw?.__migrationSnapshots?.[STEP_2_3]).toBeDefined();
  });

  it('cleanup en dry-run ne supprime rien', async () => {
    const Container = createContainerTestModel({}, 'SnapModel');
    const id = await seedAndMigrate(Container);

    const result = await Container.cleanupMigrationSnapshots(
      {},
      { stepKey: STEP_1_2, dryRun: true },
    );

    expect(result).toMatchObject({ cleaned: 1, dryRun: true });

    const raw = await Container.collection.findOne({ _id: id });
    expect(raw?.__migrationSnapshots?.[STEP_1_2]).toBeDefined();
  });

  it('le nettoyage ne touche ni les champs métier ni __schemaVersion', async () => {
    const Container = createContainerTestModel({}, 'SnapModel');
    const id = await seedAndMigrate(Container);

    await Container.cleanupMigrationSnapshotById(id);

    const raw = await Container.collection.findOne({ _id: id });
    expect(raw?.__migrationSnapshots).toBeUndefined();
    expect(raw?.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
    expect(raw?.ports).toEqual(['80:80']);
    expect(raw?.network).toEqual({ mode: 'bridge' });
  });
});
