import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SchemigrateError } from '../errors/index.js';
import type { SchemigrateCliConfig } from './define-config.js';

const CONFIG_CANDIDATES = [
  'schemigrate.config.ts',
  'schemigrate.config.mts',
  'schemigrate.config.mjs',
  'schemigrate.config.js',
  'schemigrate.config.cjs',
];

export class SchemigrateConfigError extends SchemigrateError {}

/**
 * Loads schemigrate.config.* from `cwd` (SPEC §42.7). TypeScript configs rely
 * on Node's native type stripping (Node >= 23.6, or >= 22.6 with
 * --experimental-strip-types); otherwise use a .mjs/.js config.
 */
export async function loadCliConfig(
  cwd: string,
  explicitPath?: string,
): Promise<SchemigrateCliConfig> {
  const path = explicitPath
    ? resolve(cwd, explicitPath)
    : CONFIG_CANDIDATES.map((candidate) => resolve(cwd, candidate)).find((candidate) =>
        existsSync(candidate),
      );

  if (!path || !existsSync(path)) {
    throw new SchemigrateConfigError(
      explicitPath
        ? `Config file not found: ${explicitPath}`
        : `No schemigrate.config.{ts,mts,mjs,js,cjs} found in ${cwd}.`,
    );
  }

  let moduleExports: { default?: SchemigrateCliConfig } & SchemigrateCliConfig;
  try {
    moduleExports = await import(pathToFileURL(path).href);
  } catch (cause) {
    const hint =
      path.endsWith('.ts') || path.endsWith('.mts')
        ? ' Loading a TypeScript config requires Node >= 23.6 (native type stripping); otherwise rename it to schemigrate.config.mjs.'
        : '';
    throw new SchemigrateConfigError(`Failed to load config ${path}.${hint}`, { cause });
  }

  const config = moduleExports.default ?? moduleExports;
  return validateCliConfig(config, path);
}

export function validateCliConfig(
  config: unknown,
  source = 'schemigrate.config',
): SchemigrateCliConfig {
  if (config === null || typeof config !== 'object') {
    throw new SchemigrateConfigError(`${source}: the config must export an object.`);
  }
  const candidate = config as SchemigrateCliConfig;
  if (!Array.isArray(candidate.models) || candidate.models.length === 0) {
    throw new SchemigrateConfigError(
      `${source}: 'models' must be a non-empty array of model configurations.`,
    );
  }
  for (const model of candidate.models) {
    if (!model?.name || typeof model.name !== 'string') {
      throw new SchemigrateConfigError(`${source}: every model entry needs a 'name'.`);
    }
    if (typeof model.currentVersion !== 'number') {
      throw new SchemigrateConfigError(
        `${source}: model '${model.name}' needs a numeric 'currentVersion'.`,
      );
    }
    if (!Array.isArray(model.migrations)) {
      throw new SchemigrateConfigError(
        `${source}: model '${model.name}' needs a 'migrations' array.`,
      );
    }
  }
  return candidate;
}
