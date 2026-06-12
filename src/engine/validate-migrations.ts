import { InvalidMigrationConfigurationError } from '../errors/index.js';
import type { Migration, SchemaVersion } from '../types.js';

export type ValidateMigrationsOptions = {
  modelName?: string;
  currentVersion?: SchemaVersion;
  allowDowngrade?: boolean;
};

/**
 * Validates a migration chain at plugin initialization (SPEC §25).
 *
 * Rules:
 * - `from` and `to` must be numbers;
 * - `to` must be strictly greater than `from`;
 * - every `to` must be unique;
 * - every `from` must be unique (an ambiguous path is the typical symptom of a branch merge);
 * - an `up` function must exist;
 * - the sorted chain must be contiguous (each `from` equals the previous `to`);
 * - when allowDowngrade is enabled, missing `down` functions are reported as a warning-level
 *   configuration error only at downgrade time, not here (a partial down chain is legal).
 */
export function validateMigrations(
  migrations: Migration[],
  options: ValidateMigrationsOptions = {},
): void {
  const { modelName, currentVersion } = options;

  const fail = (message: string): never => {
    throw new InvalidMigrationConfigurationError(message, { modelName });
  };

  if (!Array.isArray(migrations)) {
    fail('migrations must be an array.');
  }

  const seenFrom = new Set<SchemaVersion>();
  const seenTo = new Set<SchemaVersion>();

  for (const migration of migrations) {
    if (typeof migration.from !== 'number' || Number.isNaN(migration.from)) {
      fail(`Migration 'from' must be a number (got ${String(migration.from)}).`);
    }
    if (typeof migration.to !== 'number' || Number.isNaN(migration.to)) {
      fail(`Migration 'to' must be a number (got ${String(migration.to)}).`);
    }
    if (migration.from === migration.to) {
      fail(`Migration 'from' and 'to' must differ (both are ${migration.from}).`);
    }
    if (migration.to < migration.from) {
      fail(
        `Migration 'to' (${migration.to}) must be strictly greater than 'from' (${migration.from}).`,
      );
    }
    if (typeof migration.up !== 'function') {
      fail(`Migration ${migration.from} -> ${migration.to} has no 'up' function.`);
    }
    if (migration.down !== undefined && typeof migration.down !== 'function') {
      fail(`Migration ${migration.from} -> ${migration.to} has an invalid 'down' (not a function).`);
    }
    if (seenFrom.has(migration.from)) {
      fail(
        `Duplicate migration 'from' version ${migration.from}: the migration path is ambiguous (typical after a branch merge — rebase one of the migrations).`,
      );
    }
    if (seenTo.has(migration.to)) {
      fail(`Duplicate migration 'to' version ${migration.to}.`);
    }
    seenFrom.add(migration.from);
    seenTo.add(migration.to);
  }

  // Chain continuity: sorted by `from`, each step must start where the previous ended.
  const sorted = [...migrations].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from !== sorted[i - 1].to) {
      fail(
        `Missing migration from schema version ${sorted[i - 1].to} to ${sorted[i].from}: the migration chain has a gap.`,
      );
    }
  }

  if (currentVersion !== undefined && sorted.length > 0) {
    const lastTo = sorted[sorted.length - 1].to;
    if (lastTo !== currentVersion) {
      fail(
        `currentVersion (${currentVersion}) must equal the last migration 'to' (${lastTo}).`,
      );
    }
  }
}
