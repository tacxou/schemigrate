import { Injectable } from '@nestjs/common';
import type { Model } from 'mongoose';
import { InvalidMigrationConfigurationError } from '../errors/index.js';
import type { SchemaVersionedModel } from '../plugin/schemigrate-plugin.js';
import type { SchemaVersion } from '../types.js';

/**
 * Terminus-compatible result shape (SPEC §41). Mirrors
 * `@nestjs/terminus`'s `HealthIndicatorResult` so this indicator can be used
 * inside `HealthCheckService.check([...])` without importing Terminus —
 * `@nestjs/terminus` stays a fully optional peer dependency.
 */
export type SchemigrateHealthResult = Record<
  string,
  { status: 'up' | 'down'; [key: string]: unknown }
>;

export type SchemigrateModelHealth = {
  currentVersion: SchemaVersion;
  outdatedDocuments: number;
  newerDocuments: number;
  failedDocuments: number;
};

export type SchemigrateHealthOptions = {
  /** Models (carrying the schemigrate plugin) to inspect. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  models: Array<Model<any>>;
  /** Report `down` when outdated documents exist. Default: true. */
  failOnOutdated?: boolean;
  /** Report `down` when newer-than-supported documents exist. Default: true. */
  failOnNewer?: boolean;
  /** Report `down` when failed migration markers exist. Default: false. */
  failOnFailed?: boolean;
};

/**
 * Error shape understood by Terminus: `HealthCheckService` reads `.causes`
 * from a rejected indicator to build the `down` details. Structurally
 * compatible with `@nestjs/terminus`'s `HealthCheckError`.
 */
export class SchemigrateHealthCheckError extends Error {
  constructor(
    message: string,
    readonly causes: SchemigrateHealthResult,
  ) {
    super(message);
    this.name = 'HealthCheckError';
  }
}

/**
 * Builds the error thrown on an unhealthy check. When `@nestjs/terminus` is
 * installed, its real `HealthCheckError` is used (Terminus uses `instanceof`
 * to recognize it); otherwise a structurally-compatible fallback is returned.
 * Resolved lazily so `@nestjs/terminus` stays a fully optional peer.
 */
async function buildHealthError(
  message: string,
  causes: SchemigrateHealthResult,
): Promise<Error> {
  try {
    const terminus = (await import('@nestjs/terminus')) as {
      HealthCheckError?: new (m: string, c: unknown) => Error;
    };
    if (typeof terminus.HealthCheckError === 'function') {
      return new terminus.HealthCheckError(message, causes);
    }
  } catch {
    // @nestjs/terminus not installed — fall back to the structural error.
  }
  return new SchemigrateHealthCheckError(message, causes);
}

/**
 * Health indicator (SPEC §41): detects outdated, newer-than-supported and
 * failed documents per model and exposes a status for monitoring.
 *
 * ```ts
 * @Get('health')
 * @HealthCheck()
 * check() {
 *   return this.health.check([
 *     () => this.schemigrateHealth.isHealthy('schemigrate', { models: [this.containerModel] }),
 *   ]);
 * }
 * ```
 */
@Injectable()
export class SchemigrateHealthIndicator {
  async isHealthy(
    key: string,
    options: SchemigrateHealthOptions,
  ): Promise<SchemigrateHealthResult> {
    const failOnOutdated = options.failOnOutdated ?? true;
    const failOnNewer = options.failOnNewer ?? true;
    const failOnFailed = options.failOnFailed ?? false;

    const models: Record<string, SchemigrateModelHealth> = {};
    let healthy = true;

    for (const model of options.models) {
      const versioned = model as unknown as SchemaVersionedModel<Record<string, unknown>>;
      if (typeof versioned.getMigrationStatus !== 'function') {
        throw new InvalidMigrationConfigurationError(
          `Model '${model?.modelName ?? '?'}' does not have the schemigrate plugin applied.`,
          { modelName: model?.modelName },
        );
      }

      const status = await versioned.getMigrationStatus();
      models[status.model] = {
        currentVersion: status.currentVersion,
        outdatedDocuments: status.outdatedDocuments,
        newerDocuments: status.newerDocuments,
        failedDocuments: status.failedDocuments,
      };

      if (failOnOutdated && status.outdatedDocuments > 0) healthy = false;
      if (failOnNewer && status.newerDocuments > 0) healthy = false;
      if (failOnFailed && status.failedDocuments > 0) healthy = false;
    }

    const result: SchemigrateHealthResult = {
      [key]: { status: healthy ? 'up' : 'down', models },
    };

    if (!healthy) {
      throw await buildHealthError(`${key} is not healthy`, result);
    }
    return result;
  }
}
