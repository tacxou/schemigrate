import {
  MissingDowngradeMigrationError,
  MissingMigrationError,
} from '../errors/index.js';
import type { Migration, SchemaVersion, SchemigratePlan } from '../types.js';

export type BuildMigrationPlanOptions = {
  modelName?: string;
};

/**
 * Computes the ordered list of steps to go from `fromVersion` to `toVersion`.
 * Returns an empty plan when both versions are equal.
 * Never skips an intermediate declared version (SPEC §13, §24).
 */
export function buildMigrationPlan(
  migrations: Migration[],
  fromVersion: SchemaVersion,
  toVersion: SchemaVersion,
  options: BuildMigrationPlanOptions = {},
): SchemigratePlan {
  if (fromVersion === toVersion) return [];

  const direction = toVersion > fromVersion ? 'up' : 'down';
  const plan: SchemigratePlan = [];

  if (direction === 'up') {
    let cursor = fromVersion;
    while (cursor < toVersion) {
      const step = migrations.find((m) => m.from === cursor);
      if (!step || step.to > toVersion) {
        throw new MissingMigrationError({
          modelName: options.modelName,
          fromVersion: cursor,
          toVersion,
        });
      }
      plan.push({
        from: step.from,
        to: step.to,
        direction: 'up',
        description: step.description,
      });
      cursor = step.to;
    }
    return plan;
  }

  let cursor = fromVersion;
  while (cursor > toVersion) {
    const step = migrations.find((m) => m.to === cursor);
    if (!step || step.from < toVersion) {
      throw new MissingMigrationError({
        modelName: options.modelName,
        fromVersion: cursor,
        toVersion,
      });
    }
    if (typeof step.down !== 'function') {
      throw new MissingDowngradeMigrationError({
        modelName: options.modelName,
        fromVersion: step.to,
        toVersion: step.from,
      });
    }
    plan.push({
      from: step.to,
      to: step.from,
      direction: 'down',
      description: step.description,
    });
    cursor = step.from;
  }
  return plan;
}

/** Finds the declared migration backing a plan step. */
export function findMigrationForStep(
  migrations: Migration[],
  step: { from: SchemaVersion; to: SchemaVersion; direction: 'up' | 'down' },
): Migration | undefined {
  return step.direction === 'up'
    ? migrations.find((m) => m.from === step.from && m.to === step.to)
    : migrations.find((m) => m.to === step.from && m.from === step.to);
}
