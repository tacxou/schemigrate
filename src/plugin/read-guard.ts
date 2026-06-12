import {
  MissingSchemaVersionError,
  OutdatedDocumentError,
  UnsupportedSchemaVersionError,
  type OutdatedDocumentRef,
} from '../errors/index.js';
import { getPath } from '../utils/object-paths.js';
import type { SchemaVersion, UnknownVersionStrategy } from '../types.js';

export type ReadGuardOptions = {
  modelName?: string;
  currentVersion: SchemaVersion;
  versionPath: string;
  defaultVersion: SchemaVersion;
  unknownVersionStrategy: UnknownVersionStrategy;
};

type ReadableDoc = Record<string, unknown> | { get?: (path: string) => unknown };

function readVersion(doc: ReadableDoc, versionPath: string): unknown {
  const maybeGet = (doc as { get?: (path: string) => unknown }).get;
  if (typeof maybeGet === 'function') {
    return maybeGet.call(doc, versionPath);
  }
  return getPath(doc, versionPath);
}

function readId(doc: ReadableDoc): string | undefined {
  const id = (doc as Record<string, unknown>)._id;
  return id === undefined || id === null ? undefined : String(id);
}

/**
 * Read guard (SPEC §16.1): never migrates, never mutates persisted data.
 * Fail-fast on the whole result set, with an error aggregating every
 * offending document.
 *
 * Outdated documents take precedence over newer ones when both are present.
 */
export function assertReadableVersions(
  docs: unknown[],
  options: ReadGuardOptions,
): void {
  const outdated: OutdatedDocumentRef[] = [];
  const newer: OutdatedDocumentRef[] = [];

  for (const raw of docs) {
    if (raw === null || raw === undefined || typeof raw !== 'object') continue;
    const doc = raw as ReadableDoc;

    let version = readVersion(doc, options.versionPath);

    if (version === undefined || version === null) {
      switch (options.unknownVersionStrategy) {
        case 'ignore':
          continue;
        case 'setDefault':
          version = options.defaultVersion;
          break;
        case 'throw':
        default:
          throw new MissingSchemaVersionError({
            modelName: options.modelName,
            documentId: readId(doc),
          });
      }
    }

    if (typeof version !== 'number') {
      throw new MissingSchemaVersionError({
        modelName: options.modelName,
        documentId: readId(doc),
      });
    }

    if (version < options.currentVersion) {
      outdated.push({ documentId: readId(doc), documentVersion: version });
    } else if (version > options.currentVersion) {
      newer.push({ documentId: readId(doc), documentVersion: version });
    }
  }

  if (outdated.length > 0) {
    throw new OutdatedDocumentError({
      modelName: options.modelName,
      documentId: outdated.length === 1 ? outdated[0].documentId : undefined,
      documentVersion: outdated.length === 1 ? outdated[0].documentVersion : undefined,
      currentVersion: options.currentVersion,
      documents: outdated.length > 1 ? outdated : undefined,
    });
  }

  if (newer.length > 0) {
    throw new UnsupportedSchemaVersionError({
      modelName: options.modelName,
      documentId: newer.length === 1 ? newer[0].documentId : undefined,
      documentVersion: newer.length === 1 ? newer[0].documentVersion : undefined,
      supportedVersion: options.currentVersion,
      documents: newer.length > 1 ? newer : undefined,
    });
  }
}
