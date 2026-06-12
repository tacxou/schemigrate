import { InvalidMigrationConfigurationError } from '../errors/index.js';
import type { SchemaVersion } from '../types.js';

/**
 * Creates a structure version from an ISO date, or from Date.now() when omitted.
 *
 * createSchemaVersion('2026-06-12T08:00:00.000Z') // => 1781251200000
 * createSchemaVersion()                            // => Date.now()
 */
export function createSchemaVersion(isoDate?: string): SchemaVersion {
  if (isoDate === undefined) {
    return Date.now();
  }

  const timestamp = Date.parse(isoDate);

  if (Number.isNaN(timestamp)) {
    throw new InvalidMigrationConfigurationError(
      `createSchemaVersion(): invalid ISO date '${isoDate}'.`,
    );
  }

  return timestamp;
}
