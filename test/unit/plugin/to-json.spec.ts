import { describe, it, expect } from 'vitest';
import { stripReservedFields } from '../../../src/plugin/to-json.js';

describe('stripReservedFields', () => {
  it('masque les champs réservés __* par défaut', () => {
    const output = stripReservedFields({
      name: 'nginx',
      __schemaVersion: 1782460800000,
      __migrationSnapshots: {},
      __createdByVersion: '1.4.0',
    });

    expect(output).toEqual({ name: 'nginx' });
  });

  it('compose avec une transform applicative existante', () => {
    const output = stripReservedFields(
      { name: 'nginx', secret: 'hidden', __schemaVersion: 1782460800000 },
      (doc) => {
        const { secret: _secret, ...rest } = doc;
        return rest;
      },
    );

    expect(output).toEqual({ name: 'nginx' });
  });

  it('masque la feuille d’un chemin imbriqué sans toucher au conteneur', () => {
    const output = stripReservedFields(
      { name: 'nginx', _metadata: { __schemaVersion: 1, owner: 'ops' } },
      undefined,
      ['_metadata.__schemaVersion'],
    );

    expect(output).toEqual({ name: 'nginx', _metadata: { owner: 'ops' } });
  });

  it('retire le conteneur devenu vide après masquage', () => {
    const output = stripReservedFields(
      { name: 'nginx', _metadata: { __schemaVersion: 1 } },
      undefined,
      ['_metadata.__schemaVersion'],
    );

    expect(output).toEqual({ name: 'nginx' });
  });
});
