import { describe, it, expect } from 'vitest';
import { assertReadableVersions } from '../../../src/plugin/read-guard.js';
import {
  MissingSchemaVersionError,
  OutdatedDocumentError,
  UnsupportedSchemaVersionError,
} from '../../../src/errors/index.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V2,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

const baseOptions = {
  modelName: 'Container',
  currentVersion: CONTAINER_SCHEMA_V3,
  versionPath: '__schemaVersion',
  defaultVersion: CONTAINER_SCHEMA_V1,
  unknownVersionStrategy: 'throw' as const,
};

describe('assertReadableVersions', () => {
  it('laisse passer un document à la version courante', () => {
    expect(() =>
      assertReadableVersions([{ __schemaVersion: CONTAINER_SCHEMA_V3 }], baseOptions),
    ).not.toThrow();
  });

  it('lève OutdatedDocumentError sur un document obsolète', () => {
    expect(() =>
      assertReadableVersions(
        [{ _id: '64f', __schemaVersion: CONTAINER_SCHEMA_V1 }],
        baseOptions,
      ),
    ).toThrowError(OutdatedDocumentError);
  });

  it('lève UnsupportedSchemaVersionError sur un document trop récent', () => {
    expect(() =>
      assertReadableVersions(
        [{ __schemaVersion: CONTAINER_SCHEMA_V3 + 1 }],
        baseOptions,
      ),
    ).toThrowError(UnsupportedSchemaVersionError);
  });

  it('agrège tous les documents fautifs sur un résultat multiple', () => {
    let caught: OutdatedDocumentError | undefined;
    try {
      assertReadableVersions(
        [
          { _id: 'a', __schemaVersion: CONTAINER_SCHEMA_V1 },
          { _id: 'b', __schemaVersion: CONTAINER_SCHEMA_V2 },
          { _id: 'c', __schemaVersion: CONTAINER_SCHEMA_V3 },
        ],
        baseOptions,
      );
    } catch (error) {
      caught = error as OutdatedDocumentError;
    }

    expect(caught).toBeInstanceOf(OutdatedDocumentError);
    expect(caught?.documents).toHaveLength(2);
    expect(caught?.documents?.map((d) => d.documentId)).toEqual(['a', 'b']);
  });

  it('priorise OutdatedDocumentError quand obsolètes et trop récents coexistent', () => {
    expect(() =>
      assertReadableVersions(
        [
          { __schemaVersion: CONTAINER_SCHEMA_V1 },
          { __schemaVersion: CONTAINER_SCHEMA_V3 + 1 },
        ],
        baseOptions,
      ),
    ).toThrowError(OutdatedDocumentError);
  });

  it('unknownVersionStrategy=throw lève MissingSchemaVersionError', () => {
    expect(() => assertReadableVersions([{ name: 'nginx' }], baseOptions)).toThrowError(
      MissingSchemaVersionError,
    );
  });

  it('unknownVersionStrategy=ignore laisse passer', () => {
    expect(() =>
      assertReadableVersions([{ name: 'nginx' }], {
        ...baseOptions,
        unknownVersionStrategy: 'ignore',
      }),
    ).not.toThrow();
  });

  it('unknownVersionStrategy=setDefault traite le document comme obsolète', () => {
    expect(() =>
      assertReadableVersions([{ name: 'nginx' }], {
        ...baseOptions,
        unknownVersionStrategy: 'setDefault',
      }),
    ).toThrowError(OutdatedDocumentError);
  });

  it('ignore les valeurs null/undefined dans le résultat', () => {
    expect(() => assertReadableVersions([null, undefined], baseOptions)).not.toThrow();
  });
});
