import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase } from '../../helpers/mongo-setup.js';
import { createContainerTestModel } from '../../helpers/create-test-model.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('Mongoose integration — plugin de base', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('stampe __schemaVersion = currentVersion à la création (save)', async () => {
    const Container = createContainerTestModel({}, 'PluginBase');

    const doc = await Container.create({ name: 'nginx', ports: ['80:80'] });

    expect(doc.get('__schemaVersion')).toBe(CONTAINER_SCHEMA_V3);

    const raw = await Container.collection.findOne({ _id: doc._id });
    expect(raw?.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
  });

  it('respecte une version explicite à la création (fixtures legacy)', async () => {
    const Container = createContainerTestModel({}, 'PluginBase');

    const doc = await Container.create({
      name: 'legacy',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    const raw = await Container.collection.findOne({ _id: doc._id });
    expect(raw?.__schemaVersion).toBe(CONTAINER_SCHEMA_V1);
  });

  it('stampe les documents insérés via insertMany', async () => {
    const Container = createContainerTestModel({}, 'PluginBase');

    await Container.insertMany([{ name: 'a' }, { name: 'b' }]);

    const count = await Container.countDocuments({
      __schemaVersion: CONTAINER_SCHEMA_V3,
    });
    expect(count).toBe(2);
  });

  it('stampe via $setOnInsert sur un upsert', async () => {
    const Container = createContainerTestModel({}, 'PluginBase');

    await Container.updateOne(
      { name: 'upserted' },
      { $set: { image: 'nginx:latest' } },
      { upsert: true },
    );

    const raw = await Container.collection.findOne({ name: 'upserted' });
    expect(raw?.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
  });

  it('masque les champs réservés dans toJSON par défaut', async () => {
    const Container = createContainerTestModel({}, 'PluginBase');

    const doc = await Container.create({ name: 'nginx' });
    const json = doc.toJSON() as Record<string, unknown>;

    expect(json.name).toBe('nginx');
    expect(json.__schemaVersion).toBeUndefined();
    expect(json.__migrationSnapshots).toBeUndefined();
    expect(json.__migrationState).toBeUndefined();
  });

  it('expose les champs réservés si hideInToJSON: false', async () => {
    const Container = createContainerTestModel({ hideInToJSON: false }, 'PluginVisible');

    const doc = await Container.create({ name: 'nginx' });
    const json = doc.toJSON() as Record<string, unknown>;

    expect(json.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
  });

  it('expose getCurrentSchemaVersion et les helpers d’instance', async () => {
    const Container = createContainerTestModel({}, 'PluginBase');

    expect(Container.getCurrentSchemaVersion()).toBe(CONTAINER_SCHEMA_V3);

    const doc = await Container.create({ name: 'nginx' });
    expect(doc.getSchemaVersion()).toBe(CONTAINER_SCHEMA_V3);
    expect(doc.isCurrentVersion()).toBe(true);
    expect(doc.isOutdated()).toBe(false);
    expect(doc.isNewerThanSupported()).toBe(false);
    expect(doc.canMigrateTo(CONTAINER_SCHEMA_V3)).toBe(true);
    expect(doc.canMigrateTo(9999999999999)).toBe(false);
  });

  it('ne touche jamais à __v', async () => {
    const Container = createContainerTestModel({}, 'PluginBase');

    const doc = await Container.create({
      name: 'legacy',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });
    const versionKeyBefore = (await Container.collection.findOne({ _id: doc._id }))?.__v;

    await Container.migrateById(doc._id, CONTAINER_SCHEMA_V3);

    const raw = await Container.collection.findOne({ _id: doc._id });
    expect(raw?.__v).toBe(versionKeyBefore);
  });
});
