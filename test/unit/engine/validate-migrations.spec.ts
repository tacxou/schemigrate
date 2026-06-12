import { describe, it, expect } from 'vitest';
import { validateMigrations } from '../../../src/engine/validate-migrations.js';
import { InvalidMigrationConfigurationError } from '../../../src/errors/index.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V2,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

const up = async (doc: Record<string, unknown>) => doc;

describe('validateMigrations', () => {
  it('accepte une chaîne valide', () => {
    expect(() =>
      validateMigrations(containerMigrations, { currentVersion: CONTAINER_SCHEMA_V3 }),
    ).not.toThrow();
  });

  it('accepte une liste vide', () => {
    expect(() => validateMigrations([])).not.toThrow();
  });

  it('rejette un from non numérique', () => {
    expect(() =>
      validateMigrations([{ from: 'a' as unknown as number, to: 2, up }]),
    ).toThrowError(InvalidMigrationConfigurationError);
  });

  it('rejette to <= from', () => {
    expect(() =>
      validateMigrations([{ from: CONTAINER_SCHEMA_V2, to: CONTAINER_SCHEMA_V1, up }]),
    ).toThrowError(InvalidMigrationConfigurationError);
  });

  it('rejette from === to', () => {
    expect(() =>
      validateMigrations([{ from: CONTAINER_SCHEMA_V1, to: CONTAINER_SCHEMA_V1, up }]),
    ).toThrowError(InvalidMigrationConfigurationError);
  });

  it('rejette une migration sans up', () => {
    expect(() =>
      validateMigrations([
        { from: CONTAINER_SCHEMA_V1, to: CONTAINER_SCHEMA_V2 } as never,
      ]),
    ).toThrowError(InvalidMigrationConfigurationError);
  });

  it('rejette deux migrations avec le même from (merge de branches)', () => {
    expect(() =>
      validateMigrations([
        { from: CONTAINER_SCHEMA_V1, to: CONTAINER_SCHEMA_V2, up },
        { from: CONTAINER_SCHEMA_V1, to: CONTAINER_SCHEMA_V3, up },
      ]),
    ).toThrowError(/Duplicate migration 'from'/);
  });

  it('rejette deux migrations avec le même to', () => {
    expect(() =>
      validateMigrations([
        { from: CONTAINER_SCHEMA_V1, to: CONTAINER_SCHEMA_V3, up },
        { from: CONTAINER_SCHEMA_V2, to: CONTAINER_SCHEMA_V3, up },
      ]),
    ).toThrowError(InvalidMigrationConfigurationError);
  });

  it('rejette une chaîne avec un trou', () => {
    expect(() =>
      validateMigrations([
        { from: CONTAINER_SCHEMA_V1, to: CONTAINER_SCHEMA_V1 + 1, up },
        { from: CONTAINER_SCHEMA_V2, to: CONTAINER_SCHEMA_V3, up },
      ]),
    ).toThrowError(/gap/);
  });

  it('rejette une currentVersion différente du dernier to', () => {
    expect(() =>
      validateMigrations(containerMigrations, { currentVersion: CONTAINER_SCHEMA_V2 }),
    ).toThrowError(InvalidMigrationConfigurationError);
  });
});
