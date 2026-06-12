import { describe, it, expect } from 'vitest';
import {
  cloneDocument,
  deepEqual,
  getPath,
  isPlainObject,
  parseOlderThan,
  setPath,
  unsetPath,
} from '../../../src/utils/object-paths.js';

describe('getPath / setPath / unsetPath', () => {
  it('lit et écrit des chemins pointés', () => {
    const obj: Record<string, unknown> = {};
    setPath(obj, '_metadata.__schemaVersion', 42);

    expect(obj).toEqual({ _metadata: { __schemaVersion: 42 } });
    expect(getPath(obj, '_metadata.__schemaVersion')).toBe(42);
    expect(getPath(obj, 'missing.path')).toBeUndefined();
  });

  it('supprime une feuille et élague les parents vides', () => {
    const obj: Record<string, unknown> = { _metadata: { __schemaVersion: 42 }, name: 'x' };
    unsetPath(obj, '_metadata.__schemaVersion');

    expect(obj).toEqual({ name: 'x' });
  });

  it('conserve un parent non vide', () => {
    const obj: Record<string, unknown> = {
      _metadata: { __schemaVersion: 42, owner: 'ops' },
    };
    unsetPath(obj, '_metadata.__schemaVersion');

    expect(obj).toEqual({ _metadata: { owner: 'ops' } });
  });
});

describe('cloneDocument / deepEqual', () => {
  it('clone en profondeur objets, tableaux et dates', () => {
    const original = { a: { b: [1, 2] }, d: new Date('2026-06-12T08:00:00.000Z') };
    const clone = cloneDocument(original);

    expect(clone).toEqual(original);
    expect(clone.a).not.toBe(original.a);
    expect(clone.a.b).not.toBe(original.a.b);
    expect(clone.d).not.toBe(original.d);
  });

  it('compare en profondeur', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(
      deepEqual(new Date('2026-06-12T08:00:00Z'), new Date('2026-06-12T08:00:00Z')),
    ).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it('isPlainObject distingue les instances de classes', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });
});

describe('parseOlderThan', () => {
  const now = new Date('2026-06-12T08:00:00.000Z');

  it('retourne la Date telle quelle', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(parseOlderThan(date, now)).toBe(date);
  });

  it.each([
    ['30d', '2026-05-13T08:00:00.000Z'],
    ['12h', '2026-06-11T20:00:00.000Z'],
    ['45m', '2026-06-12T07:15:00.000Z'],
  ])('parse %s', (input, expected) => {
    expect(parseOlderThan(input, now).toISOString()).toBe(expected);
  });

  it('rejette une durée invalide', () => {
    expect(() => parseOlderThan('30x', now)).toThrowError(TypeError);
  });
});
