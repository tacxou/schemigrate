import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { SchemigrateService } from '../../../src/nestjs/schemigrate.service.js';
import { SchemigrateRegistry } from '../../../src/nestjs/schemigrate.registry.js';
import { InvalidMigrationConfigurationError } from '../../../src/errors/index.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

function createModelMock(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    migrateMany: vi.fn().mockResolvedValue({
      matched: 2,
      migrated: 2,
      skipped: 0,
      failed: 0,
      errors: [],
    }),
    migrateById: vi.fn().mockResolvedValue({}),
    migrateDocument: vi.fn().mockResolvedValue({}),
    getMigrationStatus: vi.fn().mockResolvedValue({ model: 'Container' }),
    syncToCurrentVersion: vi.fn().mockResolvedValue({ migrated: 0, errors: [] }),
    dryRun: vi.fn().mockResolvedValue([]),
    abortMigrationMany: vi.fn().mockResolvedValue({ matched: 0, errors: [] }),
  };
}

describe('SchemigrateService', () => {
  it('délègue migrateMany au modèle', async () => {
    const modelMock = createModelMock();

    const moduleRef = await Test.createTestingModule({
      providers: [
        SchemigrateService,
        { provide: getModelToken('Container'), useValue: modelMock },
      ],
    }).compile();

    const service = moduleRef.get(SchemigrateService);
    const model = moduleRef.get<Model<unknown>>(getModelToken('Container'));

    const result = await service.migrateMany(
      model,
      { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
      CONTAINER_SCHEMA_V3,
    );

    expect(modelMock.migrateMany).toHaveBeenCalledOnce();
    expect(modelMock.migrateMany).toHaveBeenCalledWith(
      { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
      CONTAINER_SCHEMA_V3,
      undefined,
    );
    expect(result.migrated).toBe(2);
    await moduleRef.close();
  });

  it('délègue migrateById, status, sync, dryRun et abort', async () => {
    const modelMock = createModelMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SchemigrateService,
        { provide: getModelToken('Container'), useValue: modelMock },
      ],
    }).compile();

    const service = moduleRef.get(SchemigrateService);
    const model = moduleRef.get<Model<unknown>>(getModelToken('Container'));

    await service.migrateById(model, '64f', CONTAINER_SCHEMA_V3);
    await service.getMigrationStatus(model);
    await service.syncToCurrentVersion(model, { batchSize: 10 });
    await service.dryRun(model, {});
    await service.abortMigrationMany(model, {});

    expect(modelMock.migrateById).toHaveBeenCalledWith('64f', CONTAINER_SCHEMA_V3, undefined);
    expect(modelMock.getMigrationStatus).toHaveBeenCalledOnce();
    expect(modelMock.syncToCurrentVersion).toHaveBeenCalledWith({ batchSize: 10 });
    expect(modelMock.dryRun).toHaveBeenCalledOnce();
    expect(modelMock.abortMigrationMany).toHaveBeenCalledOnce();
    await moduleRef.close();
  });

  it('rejette un modèle sans plugin schemigrate', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SchemigrateService,
        { provide: getModelToken('Bare'), useValue: { modelName: 'Bare' } },
      ],
    }).compile();

    const service = moduleRef.get(SchemigrateService);
    const model = moduleRef.get<Model<unknown>>(getModelToken('Bare'));

    await expect(service.migrateMany(model, {})).rejects.toBeInstanceOf(
      InvalidMigrationConfigurationError,
    );
    await moduleRef.close();
  });

  it('getMigrationPlan passe par le registre forFeature', async () => {
    const registry = new SchemigrateRegistry();
    registry.register({
      modelName: 'Container',
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: containerMigrations,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        SchemigrateService,
        { provide: SchemigrateRegistry, useValue: registry },
      ],
    }).compile();

    const service = moduleRef.get(SchemigrateService);
    const plan = service.getMigrationPlan(
      'Container',
      CONTAINER_SCHEMA_V1,
      CONTAINER_SCHEMA_V3,
    );

    expect(plan).toHaveLength(2);
    await moduleRef.close();
  });

  it('getMigrationPlan échoue sans registre', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [SchemigrateService],
    }).compile();

    const service = moduleRef.get(SchemigrateService);
    expect(() =>
      service.getMigrationPlan('Container', CONTAINER_SCHEMA_V1, CONTAINER_SCHEMA_V3),
    ).toThrowError(InvalidMigrationConfigurationError);
    await moduleRef.close();
  });
});
