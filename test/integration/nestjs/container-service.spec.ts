import { describe, it, expect, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { getMongoUri } from '../../helpers/mongo-setup.js';
import { schemigratePlugin } from '../../../src/plugin/schemigrate-plugin.js';
import { SchemigrateModule } from '../../../src/nestjs/schemigrate.module.js';
import { SchemigrateService } from '../../../src/nestjs/schemigrate.service.js';
import { OutdatedDocumentError } from '../../../src/errors/index.js';
import { toNestSchemigrateException, OutdatedDocumentException } from '../../../src/nestjs/exceptions.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import { Container, ContainerSchema } from '../../fixtures/container.schema.js';
import { ContainerService } from '../../fixtures/container.service.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('NestJS integration — ContainerService', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  async function createModule(): Promise<TestingModule> {
    const schema = ContainerSchema.clone();
    schema.plugin(schemigratePlugin, {
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: containerMigrations,
    });

    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(getMongoUri(), { dbName: `nest-svc-${Date.now()}` }),
        MongooseModule.forFeature([{ name: Container.name, schema }]),
        SchemigrateModule.forRoot({ logger: false }),
      ],
    }).compile();

    return moduleRef;
  }

  it('migre des containers via SchemigrateService injecté', async () => {
    const ref = await createModule();
    const model = ref.get<Model<Container>>(getModelToken(Container.name));
    const service = new ContainerService(model, ref.get(SchemigrateService));

    await model.collection.insertOne({
      name: 'nginx',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    const result = await service.migrateAllContainers();

    expect(result.migrated).toBe(1);
    expect(
      await model.countDocuments({ __schemaVersion: CONTAINER_SCHEMA_V3 }),
    ).toBe(1);
  });

  it('dry-run via le service : rapport détaillé, aucune écriture', async () => {
    const ref = await createModule();
    const model = ref.get<Model<Container>>(getModelToken(Container.name));
    const service = ref.get(SchemigrateService);

    await model.collection.insertOne({
      name: 'nginx',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    const results = await service.dryRun(model, {}, CONTAINER_SCHEMA_V3);

    expect(results).toHaveLength(1);
    expect(results[0].fromVersion).toBe(CONTAINER_SCHEMA_V1);
    expect(results[0].plan).toHaveLength(2);
    expect(results[0].changesPreview.ports).toEqual(['80:80']);

    expect(
      await model.countDocuments({ __schemaVersion: CONTAINER_SCHEMA_V1 }),
    ).toBe(1);
  });

  it('la lecture d’un document obsolète se convertit en OutdatedDocumentException', async () => {
    const ref = await createModule();
    const model = ref.get<Model<Container>>(getModelToken(Container.name));

    const { insertedId } = await model.collection.insertOne({
      name: 'legacy',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    const caught = await model
      .findById(insertedId)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(OutdatedDocumentError);

    const exception = toNestSchemigrateException(caught);
    expect(exception).toBeInstanceOf(OutdatedDocumentException);
    expect(exception.getStatus()).toBe(409);
  });

  it('getMigrationStatus via le service', async () => {
    const ref = await createModule();
    const model = ref.get<Model<Container>>(getModelToken(Container.name));
    const service = ref.get(SchemigrateService);

    await model.collection.insertMany([
      { name: 'old', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'current', __schemaVersion: CONTAINER_SCHEMA_V3 },
    ]);

    const status = await service.getMigrationStatus(model);

    expect(status).toMatchObject({
      model: Container.name,
      currentVersion: CONTAINER_SCHEMA_V3,
      outdatedDocuments: 1,
      currentDocuments: 1,
    });
  });
});
