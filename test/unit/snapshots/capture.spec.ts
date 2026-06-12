import { describe, it, expect } from 'vitest';
import {
  applySnapshotData,
  buildSnapshotEntry,
  buildStepKey,
  captureSnapshotData,
  shouldStoreSnapshot,
} from '../../../src/engine/snapshots.js';
import { CONTAINER_SCHEMA_V1, CONTAINER_SCHEMA_V2 } from '../../fixtures/versions.js';

describe('captureSnapshotData', () => {
  it('capture les champs supprimés', () => {
    const data = captureSnapshotData(
      { name: 'nginx', port: '80:80' },
      { name: 'nginx', ports: ['80:80'] },
    );

    expect(data).toEqual({ port: '80:80' });
  });

  it('capture la valeur d’origine des champs modifiés', () => {
    const data = captureSnapshotData(
      { name: 'nginx', network: { mode: 'host' } },
      { name: 'nginx', network: { mode: 'bridge' } },
    );

    expect(data).toEqual({ network: { mode: 'host' } });
  });

  it('traite undefined comme une suppression', () => {
    const data = captureSnapshotData({ flag: true }, { flag: undefined });
    expect(data).toEqual({ flag: true });
  });

  it('exclut les champs réservés __* et _id', () => {
    const data = captureSnapshotData(
      { _id: 'x', __schemaVersion: CONTAINER_SCHEMA_V1, port: '80:80' },
      {},
    );

    expect(data).toEqual({ port: '80:80' });
  });

  it('ne capture rien si rien ne change', () => {
    expect(captureSnapshotData({ name: 'nginx' }, { name: 'nginx' })).toEqual({});
  });
});

describe('shouldStoreSnapshot', () => {
  it.each([
    ['both', 'up', true],
    ['both', 'down', true],
    ['up', 'up', true],
    ['up', 'down', false],
    ['down', 'down', true],
    ['down', 'up', false],
    [false, 'up', false],
  ] as const)('storeSnapshots=%s direction=%s => %s', (store, direction, expected) => {
    expect(shouldStoreSnapshot(store, direction)).toBe(expected);
  });
});

describe('buildStepKey / buildSnapshotEntry / applySnapshotData', () => {
  it('construit la clé {from}_to_{to}', () => {
    expect(buildStepKey(CONTAINER_SCHEMA_V1, CONTAINER_SCHEMA_V2)).toBe(
      `${CONTAINER_SCHEMA_V1}_to_${CONTAINER_SCHEMA_V2}`,
    );
  });

  it('restaure les champs et retourne la version cible du rollback', () => {
    const entry = buildSnapshotEntry({
      direction: 'up',
      fromVersion: CONTAINER_SCHEMA_V1,
      toVersion: CONTAINER_SCHEMA_V2,
      data: { port: '80:80' },
      migratedAt: new Date('2026-06-19T08:00:05.000Z'),
    });

    expect(entry.migratedAt).toBe('2026-06-19T08:00:05.000Z');

    const doc: Record<string, unknown> = { name: 'nginx', ports: ['80:80'] };
    const version = applySnapshotData(doc, entry);

    expect(doc.port).toBe('80:80');
    expect(version).toBe(CONTAINER_SCHEMA_V1);
  });
});
