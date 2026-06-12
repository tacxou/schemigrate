import { unsetPath } from '../utils/object-paths.js';

export type ToJsonTransform = (doc: Record<string, unknown>) => Record<string, unknown>;

export const DEFAULT_RESERVED_PATHS = [
  '__schemaVersion',
  '__createdByVersion',
  '__updatedByVersion',
  '__migrationSnapshots',
  '__migrationState',
];

/**
 * Removes Schemigrate reserved fields from a serialized output (SPEC §8.1).
 *
 * When a custom transform is provided (the application's own toJSON
 * transform), it is applied first, then the reserved fields are stripped —
 * the plugin composes with the existing transform instead of replacing it.
 *
 * For nested reserved paths (e.g. `_metadata.__schemaVersion`), only the
 * reserved leaf is removed; the container object is kept unless it becomes
 * empty.
 */
export function stripReservedFields(
  output: Record<string, unknown>,
  transform?: ToJsonTransform,
  reservedPaths: string[] = DEFAULT_RESERVED_PATHS,
): Record<string, unknown> {
  let result = output;

  if (typeof transform === 'function') {
    const transformed = transform(result);
    if (transformed !== undefined && transformed !== null) {
      result = transformed;
    }
  }

  for (const path of reservedPaths) {
    unsetPath(result, path);
  }

  return result;
}
