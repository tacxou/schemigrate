import { describe, it, expect, vi } from 'vitest';
import {
  SchemigrateHealthCheckError,
  SchemigrateHealthIndicator,
  type SchemigrateHealthResult,
} from '../../../src/nestjs/schemigrate.health.js';
import { InvalidMigrationConfigurationError } from '../../../src/errors/index.js';
import { CONTAINER_SCHEMA_V3 } from '../../fixtures/versions.js';

type StatusOverrides = Partial<{
  outdatedDocuments: number;
  newerDocuments: number;
  failedDocuments: number;
}>;

function modelWithStatus(modelName: string, overrides: StatusOverrides = {}) {
  return {
    modelName,
    getMigrationStatus: vi.fn().mockResolvedValue({
      model: modelName,
      currentVersion: CONTAINER_SCHEMA_V3,
      outdatedDocuments: 0,
      currentDocuments: 10,
      newerDocuments: 0,
      failedDocuments: 0,
      inProgressDocuments: 0,
      ...overrides,
    }),
  } as never;
}

/** Captures the error (terminus HealthCheckError or the structural fallback). */
async function catchError(
  promise: Promise<unknown>,
): Promise<{ causes: SchemigrateHealthResult }> {
  try {
    await promise;
    throw new Error('expected the health check to reject');
  } catch (error) {
    return error as { causes: SchemigrateHealthResult };
  }
}

describe('SchemigrateHealthIndicator (SPEC §41)', () => {
  it('retourne status up quand tout est à jour', async () => {
    const indicator = new SchemigrateHealthIndicator();

    const result = await indicator.isHealthy('schemigrate', {
      models: [modelWithStatus('Container')],
    });

    expect(result.schemigrate.status).toBe('up');
    expect(result.schemigrate.models).toMatchObject({
      Container: { currentVersion: CONTAINER_SCHEMA_V3, outdatedDocuments: 0 },
    });
  });

  it('lève (status down) en présence de documents obsolètes', async () => {
    const indicator = new SchemigrateHealthIndicator();

    const error = await catchError(
      indicator.isHealthy('schemigrate', {
        models: [modelWithStatus('Container', { outdatedDocuments: 12 })],
      }),
    );

    expect(error.causes).toMatchObject({
      schemigrate: { status: 'down', models: { Container: { outdatedDocuments: 12 } } },
    });
  });

  it('lève sur documents trop récents', async () => {
    const indicator = new SchemigrateHealthIndicator();
    const error = await catchError(
      indicator.isHealthy('schemigrate', {
        models: [modelWithStatus('Container', { newerDocuments: 3 })],
      }),
    );
    expect(error.causes.schemigrate.status).toBe('down');
  });

  it('failOnOutdated: false tolère les documents obsolètes', async () => {
    const indicator = new SchemigrateHealthIndicator();
    const result = await indicator.isHealthy('schemigrate', {
      models: [modelWithStatus('Container', { outdatedDocuments: 5 })],
      failOnOutdated: false,
    });
    expect(result.schemigrate.status).toBe('up');
  });

  it('failOnFailed: true signale les marqueurs failed', async () => {
    const indicator = new SchemigrateHealthIndicator();
    const error = await catchError(
      indicator.isHealthy('schemigrate', {
        models: [modelWithStatus('Container', { failedDocuments: 2 })],
        failOnFailed: true,
      }),
    );
    expect(error.causes.schemigrate.status).toBe('down');
  });

  it('agrège plusieurs modèles', async () => {
    const indicator = new SchemigrateHealthIndicator();
    const result = await indicator.isHealthy('schemigrate', {
      models: [modelWithStatus('Container'), modelWithStatus('Wagon')],
    });
    expect(Object.keys(result.schemigrate.models as object)).toEqual(['Container', 'Wagon']);
  });

  it('rejette un modèle sans plugin schemigrate', async () => {
    const indicator = new SchemigrateHealthIndicator();
    await expect(
      indicator.isHealthy('schemigrate', {
        models: [{ modelName: 'Bare' } as never],
      }),
    ).rejects.toBeInstanceOf(InvalidMigrationConfigurationError);
  });
});

describe('SchemigrateHealthCheckError (fallback sans terminus)', () => {
  it('porte le message et les causes', () => {
    const causes: SchemigrateHealthResult = { schemigrate: { status: 'down' } };
    const error = new SchemigrateHealthCheckError('down', causes);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HealthCheckError');
    expect(error.causes).toBe(causes);
  });
});
