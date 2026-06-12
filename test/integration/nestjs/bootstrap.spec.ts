import { describe, it, expect, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { getMongoUri } from '../../helpers/mongo-setup.js';
import { schemigratePlugin } from '../../../src/plugin/schemigrate-plugin.js';
import { SchemigrateModule } from '../../../src/nestjs/schemigrate.module.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import { Container, ContainerSchema } from '../../fixtures/container.schema.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('NestJS integration — autoRunOnBootstrap (SPEC §37)', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  async function bootstrapApp(autoRunOnBootstrap: boolean): Promise<Model<Container>> {
    const schema = ContainerSchema.clone();
    schema.plugin(schemigratePlugin, {
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: containerMigrations,
    });

    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(getMongoUri(), { dbName: `nest-boot-${Date.now()}` }),
        MongooseModule.forFeature([{ name: Container.name, schema }]),
        SchemigrateModule.forRoot({ logger: false, autoRunOnBootstrap }),
        SchemigrateModule.forFeature([
          {
            modelName: Container.name,
            currentVersion: CONTAINER_SCHEMA_V3,
            migrations: containerMigrations,
          },
        ]),
      ],
    }).compile();

    const model = moduleRef.get<Model<Container>>(getModelToken(Container.name));

    // Seed BEFORE bootstrap so the opt-in sync has something to migrate.
    await model.collection.insertOne({
      name: 'legacy',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    // Triggers onApplicationBootstrap (no HTTP adapter needed).
    await moduleRef.init();

    return model;
  }

  it('autoRunOnBootstrap: true migre les documents obsolètes au démarrage', async () => {
    const model = await bootstrapApp(true);

    expect(
      await model.countDocuments({ __schemaVersion: CONTAINER_SCHEMA_V3 }),
    ).toBe(1);
    expect(
      await model.countDocuments({ __schemaVersion: CONTAINER_SCHEMA_V1 }),
    ).toBe(0);
  });

  it('autoRunOnBootstrap: false (défaut) ne migre rien', async () => {
    const model = await bootstrapApp(false);

    expect(
      await model.countDocuments({ __schemaVersion: CONTAINER_SCHEMA_V1 }),
    ).toBe(1);
  });
});
