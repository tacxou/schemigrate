import { describe, it, expect } from 'vitest';
import { buildMigrationPlan } from '../../../src/engine/build-migration-plan.js';
import {
  MissingDowngradeMigrationError,
  MissingMigrationError,
} from '../../../src/errors/index.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V2,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('buildMigrationPlan', () => {
  it('construit un plan up sur plusieurs étapes', () => {
    const plan = buildMigrationPlan(
      containerMigrations,
      CONTAINER_SCHEMA_V1,
      CONTAINER_SCHEMA_V3,
    );

    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      from: CONTAINER_SCHEMA_V1,
      to: CONTAINER_SCHEMA_V2,
      direction: 'up',
    });
    expect(plan[1]).toMatchObject({
      from: CONTAINER_SCHEMA_V2,
      to: CONTAINER_SCHEMA_V3,
      direction: 'up',
    });
  });

  it('retourne un plan vide si from === to', () => {
    expect(
      buildMigrationPlan(containerMigrations, CONTAINER_SCHEMA_V3, CONTAINER_SCHEMA_V3),
    ).toEqual([]);
  });

  it('construit un plan down sur plusieurs étapes', () => {
    const plan = buildMigrationPlan(
      containerMigrations,
      CONTAINER_SCHEMA_V3,
      CONTAINER_SCHEMA_V1,
    );

    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      from: CONTAINER_SCHEMA_V3,
      to: CONTAINER_SCHEMA_V2,
      direction: 'down',
    });
    expect(plan[1]).toMatchObject({
      from: CONTAINER_SCHEMA_V2,
      to: CONTAINER_SCHEMA_V1,
      direction: 'down',
    });
  });

  it('lève MissingMigrationError si une étape up manque', () => {
    expect(() =>
      buildMigrationPlan(containerMigrations, CONTAINER_SCHEMA_V1, 9999999999999),
    ).toThrowError(MissingMigrationError);
  });

  it('lève MissingDowngradeMigrationError si down est absent', () => {
    const noDown = containerMigrations.map(({ down: _down, ...rest }) => rest);

    expect(() =>
      buildMigrationPlan(noDown, CONTAINER_SCHEMA_V3, CONTAINER_SCHEMA_V2),
    ).toThrowError(MissingDowngradeMigrationError);
  });
});
