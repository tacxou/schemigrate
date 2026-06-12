import { describe, it, expect } from 'vitest';
import { flagAsNumber, flagAsString, parseArgs } from '../../../src/cli/parse-args.js';

describe('parseArgs', () => {
  it('extrait commande, modèle et flags valeur', () => {
    const parsed = parseArgs(['up', 'Container', '--to', '1782460800000', '--batch-size=50']);

    expect(parsed.command).toBe('up');
    expect(parsed.model).toBe('Container');
    expect(parsed.flags.to).toBe('1782460800000');
    expect(parsed.flags['batch-size']).toBe('50');
  });

  it('traite les flags booléens sans consommer le token suivant', () => {
    const parsed = parseArgs(['dry-run', '--all', '--verbose', '--json']);

    expect(parsed.command).toBe('dry-run');
    expect(parsed.model).toBeUndefined();
    expect(parsed.flags).toEqual({ all: true, verbose: true, json: true });
  });

  it('un flag valeur sans valeur devient booléen', () => {
    const parsed = parseArgs(['status', '--config']);
    expect(parsed.flags.config).toBe(true);
  });

  it('supporte --filter avec du JSON', () => {
    const parsed = parseArgs(['abort', 'Container', '--filter', '{"a":1}']);
    expect(parsed.flags.filter).toBe('{"a":1}');
  });
});

describe('flagAsNumber / flagAsString', () => {
  it('convertit une valeur numérique', () => {
    expect(flagAsNumber({ to: '42' }, 'to')).toBe(42);
    expect(flagAsNumber({}, 'to')).toBeUndefined();
  });

  it('rejette une valeur non numérique', () => {
    expect(() => flagAsNumber({ to: 'abc' }, 'to')).toThrowError(TypeError);
  });

  it('rejette un flag valeur utilisé en booléen', () => {
    expect(() => flagAsString({ id: true }, 'id')).toThrowError(TypeError);
    expect(flagAsString({ id: '64f' }, 'id')).toBe('64f');
  });
});
