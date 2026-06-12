import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase } from '../../helpers/mongo-setup.js';
import { createContainerTestModel } from '../../helpers/create-test-model.js';
import {
  MissingSchemaVersionError,
  OutdatedDocumentError,
  UnsupportedSchemaVersionError,
} from '../../../src/errors/index.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V2,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('Mongoose integration — garde de lecture', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('findById lève OutdatedDocumentError sur un document obsolète', async () => {
    const Container = createContainerTestModel({}, 'GuardModel');
    const { insertedId } = await Container.collection.insertOne({
      name: 'legacy',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    await expect(Container.findById(insertedId)).rejects.toBeInstanceOf(
      OutdatedDocumentError,
    );
  });

  it('findById lève UnsupportedSchemaVersionError sur un document trop récent', async () => {
    const Container = createContainerTestModel({}, 'GuardModel');
    const { insertedId } = await Container.collection.insertOne({
      name: 'future',
      __schemaVersion: CONTAINER_SCHEMA_V3 + 1000,
    });

    await expect(Container.findById(insertedId)).rejects.toBeInstanceOf(
      UnsupportedSchemaVersionError,
    );
  });

  it('find().lean() lève la même exception', async () => {
    const Container = createContainerTestModel({}, 'GuardModel');
    await Container.collection.insertOne({
      name: 'legacy',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    await expect(Container.find({}).lean()).rejects.toBeInstanceOf(OutdatedDocumentError);
  });

  it('agrège les documents fautifs sur un find multi-résultats', async () => {
    const Container = createContainerTestModel({}, 'GuardModel');
    await Container.collection.insertMany([
      { name: 'a', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'b', __schemaVersion: CONTAINER_SCHEMA_V2 },
      { name: 'c', __schemaVersion: CONTAINER_SCHEMA_V3 },
    ]);

    const error = await Container.find({})
      .lean()
      .then(() => undefined)
      .catch((e: OutdatedDocumentError) => e);

    expect(error).toBeInstanceOf(OutdatedDocumentError);
    expect(error?.documents).toHaveLength(2);
  });

  it('le bypass schemigrateCheck: false désactive la garde pour la requête', async () => {
    const Container = createContainerTestModel({}, 'GuardModel');
    await Container.collection.insertOne({
      name: 'legacy',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    const docs = await Container.find({})
      .setOptions({ schemigrateCheck: false })
      .lean<Record<string, unknown>[]>();

    expect(docs).toHaveLength(1);
    expect(docs[0].__schemaVersion).toBe(CONTAINER_SCHEMA_V1);
  });

  it('lève MissingSchemaVersionError sans champ de version (throw par défaut)', async () => {
    const Container = createContainerTestModel({}, 'GuardModel');
    await Container.collection.insertOne({ name: 'no-version' });

    await expect(Container.findOne({ name: 'no-version' })).rejects.toBeInstanceOf(
      MissingSchemaVersionError,
    );
  });

  it("unknownVersionStrategy: 'ignore' laisse passer un document sans version", async () => {
    const Container = createContainerTestModel(
      { unknownVersionStrategy: 'ignore' },
      'GuardIgnoreModel',
    );
    await Container.collection.insertOne({ name: 'no-version' });

    const doc = await Container.findOne({ name: 'no-version' });
    expect(doc?.name).toBe('no-version');
  });

  it('aucune migration implicite : le document reste intact après un find rejeté', async () => {
    const Container = createContainerTestModel({}, 'GuardModel');
    const { insertedId } = await Container.collection.insertOne({
      name: 'legacy',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    await Container.findById(insertedId).catch(() => undefined);

    const raw = await Container.collection.findOne({ _id: insertedId });
    expect(raw?.__schemaVersion).toBe(CONTAINER_SCHEMA_V1);
    expect(raw?.port).toBe('80:80');
    expect(raw?.ports).toBeUndefined();
  });

  it('findById réussit après une migration explicite', async () => {
    const Container = createContainerTestModel({}, 'GuardModel');
    const { insertedId } = await Container.collection.insertOne({
      name: 'legacy',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    await Container.migrateMany(
      { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
      CONTAINER_SCHEMA_V3,
    );

    const doc = await Container.findById(insertedId);
    expect(doc?.get('__schemaVersion')).toBe(CONTAINER_SCHEMA_V3);
    expect(doc?.ports).toEqual(['80:80']);
  });
});
