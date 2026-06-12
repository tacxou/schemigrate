import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { SchemigrateRegistry } from '../../../src/nestjs/schemigrate.registry.js';
import {
  adaptNestLogger,
  resolveModuleLogger,
} from '../../../src/nestjs/nest-logger.adapter.js';
import {
  InvalidMigrationConfigurationError,
  MissingMigrationError,
} from '../../../src/errors/index.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('SchemigrateRegistry', () => {
  function createRegistry(): SchemigrateRegistry {
    const registry = new SchemigrateRegistry();
    registry.register({
      modelName: 'Container',
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: containerMigrations,
    });
    return registry;
  }

  it('enregistre et expose les modèles', () => {
    const registry = createRegistry();

    expect(registry.has('Container')).toBe(true);
    expect(registry.getModelNames()).toEqual(['Container']);
    expect(registry.getCurrentVersion('Container')).toBe(CONTAINER_SCHEMA_V3);
  });

  it('calcule un plan de migration', () => {
    const registry = createRegistry();
    const plan = registry.getMigrationPlan(
      'Container',
      CONTAINER_SCHEMA_V1,
      CONTAINER_SCHEMA_V3,
    );
    expect(plan).toHaveLength(2);
  });

  it('détecte les migrations manquantes via le plan', () => {
    const registry = createRegistry();
    expect(() =>
      registry.getMigrationPlan('Container', CONTAINER_SCHEMA_V1, 9999999999999),
    ).toThrowError(MissingMigrationError);
  });

  it('rejette un doublon de modèle', () => {
    const registry = createRegistry();
    expect(() =>
      registry.register({
        modelName: 'Container',
        currentVersion: CONTAINER_SCHEMA_V3,
        migrations: containerMigrations,
      }),
    ).toThrowError(InvalidMigrationConfigurationError);
  });

  it('rejette un modèle inconnu', () => {
    const registry = createRegistry();
    expect(() => registry.getFeature('Nope')).toThrowError(
      InvalidMigrationConfigurationError,
    );
  });
});

describe('resolveModuleLogger (SPEC §38)', () => {
  it('logger: false / undefined → pas de logger', () => {
    expect(resolveModuleLogger(false)).toBeUndefined();
    expect(resolveModuleLogger(undefined)).toBeUndefined();
  });

  it('logger: true → Logger NestJS adapté', () => {
    const logger = resolveModuleLogger(true);
    expect(logger?.info).toBeTypeOf('function');
    expect(logger?.warn).toBeTypeOf('function');
  });

  it('logger: instance Logger NestJS → adapté', () => {
    const logger = resolveModuleLogger(new Logger('Schemigrate'));
    expect(logger?.info).toBeTypeOf('function');
  });

  it('logger: SchemigrateLogger simple → utilisé tel quel', () => {
    const custom = { info: vi.fn() };
    const logger = resolveModuleLogger(custom);
    expect(logger).toBe(custom);
  });

  it('adaptNestLogger route info/warn/error/debug vers le LoggerService', () => {
    const nestLogger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const adapted = adaptNestLogger(nestLogger);
    adapted.info?.('hello');
    adapted.warn?.('warn', { a: 1 });
    adapted.error?.('error');
    adapted.debug?.('debug');

    expect(nestLogger.log).toHaveBeenCalledWith('hello');
    expect(nestLogger.warn).toHaveBeenCalledWith('warn', { a: 1 });
    expect(nestLogger.error).toHaveBeenCalledWith('error');
    expect(nestLogger.debug).toHaveBeenCalledWith('debug');
  });
});
