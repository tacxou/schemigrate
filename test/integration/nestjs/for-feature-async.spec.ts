import { describe, it, expect, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { getMongoUri } from '../../helpers/mongo-setup.js';
import { schemigratePlugin } from '../../../src/plugin/schemigrate-plugin.js';
import { SchemigrateModule } from '../../../src/nestjs/schemigrate.module.js';
import { SchemigrateService } from '../../../src/nestjs/schemigrate.service.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import { Container, ContainerSchema } from '../../fixtures/container.schema.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('NestJS integration — forFeatureAsync + ConfigService', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it('applique le plugin via ConfigService (SPEC §33)', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ CONTAINER_SCHEMA_VERSION: CONTAINER_SCHEMA_V3 })],
        }),
        MongooseModule.forRoot(getMongoUri(), { dbName: `nest-ffa-${Date.now()}` }),
        MongooseModule.forFeatureAsync([
          {
            name: Container.name,
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
              const schema = ContainerSchema.clone();
              schema.plugin(schemigratePlugin, {
                currentVersion: config.get<number>('CONTAINER_SCHEMA_VERSION')!,
                versionPath: '__schemaVersion',
                migrations: containerMigrations,
              });
              return schema;
            },
          },
        ]),
        SchemigrateModule.forRoot({ logger: false }),
      ],
    }).compile();

    const service = moduleRef.get(SchemigrateService);
    expect(service).toBeDefined();

    const model = moduleRef.get<Model<Container>>(getModelToken(Container.name));
    await model.collection.insertOne({
      name: 'legacy',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    const result = await service.migrateMany(model, {}, CONTAINER_SCHEMA_V3, {
      continueOnError: true,
    });

    expect(result.migrated).toBe(1);
    expect(
      await model.countDocuments({ __schemaVersion: CONTAINER_SCHEMA_V3 }),
    ).toBe(1);
  });
});
