import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSchemaVersion } from '../../../src/utils/create-schema-version.js';
import { InvalidMigrationConfigurationError } from '../../../src/errors/index.js';

describe('createSchemaVersion', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('convertit une date ISO en timestamp', () => {
    expect(createSchemaVersion('2026-06-12T08:00:00.000Z')).toBe(1781251200000);
  });

  it('utilise Date.now() si aucune date n’est fournie', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-26T08:00:00.000Z'));

    expect(createSchemaVersion()).toBe(1782460800000);
  });

  it('lève une erreur typée sur une date invalide', () => {
    expect(() => createSchemaVersion('not-a-date')).toThrowError(
      InvalidMigrationConfigurationError,
    );
  });
});
