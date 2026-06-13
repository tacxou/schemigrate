import { describe, it, expect, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import {
  HealthCheckService,
  TerminusModule,
  type HealthCheckResult,
} from '@nestjs/terminus';
import type { Model } from 'mongoose';
import { getMongoUri } from '../../helpers/mongo-setup.js';
import { schemigratePlugin } from '../../../src/plugin/schemigrate-plugin.js';
import { SchemigrateHealthIndicator } from '../../../src/nestjs/schemigrate.health.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import { Container, ContainerSchema } from '../../fixtures/container.schema.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('NestJS integration — Terminus healthcheck (SPEC §41)', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  async function setup(): Promise<{
    model: Model<Container>;
    health: HealthCheckService;
    indicator: SchemigrateHealthIndicator;
  }> {
    const schema = ContainerSchema.clone();
    schema.plugin(schemigratePlugin, {
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: containerMigrations,
    });

    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(getMongoUri(), { dbName: `nest-health-${Date.now()}` }),
        MongooseModule.forFeature([{ name: Container.name, schema }]),
        TerminusModule,
      ],
      providers: [SchemigrateHealthIndicator],
    }).compile();

    return {
      model: moduleRef.get<Model<Container>>(getModelToken(Container.name)),
      health: moduleRef.get(HealthCheckService),
      indicator: moduleRef.get(SchemigrateHealthIndicator),
    };
  }

  it('rapporte ok quand tout est à jour', async () => {
    const { model, health, indicator } = await setup();
    await model.collection.insertOne({ name: 'a', __schemaVersion: CONTAINER_SCHEMA_V3 });

    const result: HealthCheckResult = await health.check([
      () => indicator.isHealthy('schemigrate', { models: [model] }),
    ]);

    expect(result.status).toBe('ok');
    expect(result.details.schemigrate.status).toBe('up');
  });

  it('rapporte error et détaille les documents obsolètes', async () => {
    const { model, health, indicator } = await setup();
    await model.collection.insertOne({ name: 'old', __schemaVersion: CONTAINER_SCHEMA_V1 });

    const result = await health
      .check([() => indicator.isHealthy('schemigrate', { models: [model] })])
      .catch((error: { response: HealthCheckResult }) => error.response);

    expect(result.status).toBe('error');
    const detail = result.error?.schemigrate as
      | { status: string; models: Record<string, { outdatedDocuments: number }> }
      | undefined;
    expect(detail?.status).toBe('down');
    expect(detail?.models.Container.outdatedDocuments).toBe(1);
  });
});
