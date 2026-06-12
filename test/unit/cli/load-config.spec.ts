import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadCliConfig,
  SchemigrateConfigError,
  validateCliConfig,
} from '../../../src/cli/load-config.js';
import { defineSchemigrateConfig } from '../../../src/cli/define-config.js';
import { CONTAINER_SCHEMA_V3 } from '../../fixtures/versions.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'schemigrate-cli-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('defineSchemigrateConfig', () => {
  it('retourne la config telle quelle (identité typée)', () => {
    const config = defineSchemigrateConfig({
      uri: 'mongodb://localhost',
      models: [{ name: 'Container', currentVersion: CONTAINER_SCHEMA_V3, migrations: [] }],
    });
    expect(config.models[0].name).toBe('Container');
  });
});

describe('validateCliConfig', () => {
  it('rejette une config sans models', () => {
    expect(() => validateCliConfig({})).toThrowError(SchemigrateConfigError);
    expect(() => validateCliConfig({ models: [] })).toThrowError(SchemigrateConfigError);
  });

  it('rejette un modèle sans name / currentVersion / migrations', () => {
    expect(() => validateCliConfig({ models: [{}] })).toThrowError(/name/);
    expect(() =>
      validateCliConfig({ models: [{ name: 'X' }] }),
    ).toThrowError(/currentVersion/);
    expect(() =>
      validateCliConfig({ models: [{ name: 'X', currentVersion: 1 }] }),
    ).toThrowError(/migrations/);
  });

  it('accepte une config valide', () => {
    const config = validateCliConfig({
      models: [{ name: 'X', currentVersion: 1, migrations: [] }],
    });
    expect(config.models).toHaveLength(1);
  });
});

describe('loadCliConfig', () => {
  it('charge un schemigrate.config.mjs depuis le cwd', async () => {
    const dir = createTempDir();
    writeFileSync(
      join(dir, 'schemigrate.config.mjs'),
      `export default {
        uri: 'mongodb://localhost:27017/test',
        models: [{ name: 'Container', currentVersion: ${CONTAINER_SCHEMA_V3}, migrations: [] }],
      };`,
      'utf8',
    );

    const config = await loadCliConfig(dir);
    expect(config.uri).toBe('mongodb://localhost:27017/test');
    expect(config.models[0].name).toBe('Container');
  });

  it('charge un fichier explicite via --config', async () => {
    const dir = createTempDir();
    writeFileSync(
      join(dir, 'custom.mjs'),
      `export default { models: [{ name: 'X', currentVersion: 1, migrations: [] }] };`,
      'utf8',
    );

    const config = await loadCliConfig(dir, 'custom.mjs');
    expect(config.models[0].name).toBe('X');
  });

  it('échoue avec un message clair si aucun fichier n’existe', async () => {
    const dir = createTempDir();
    await expect(loadCliConfig(dir)).rejects.toThrowError(SchemigrateConfigError);
    await expect(loadCliConfig(dir, 'missing.mjs')).rejects.toThrowError(/not found/);
  });
});
