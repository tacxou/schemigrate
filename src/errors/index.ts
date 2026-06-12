import type { SchemaVersion } from '../types.js';

/** Base class for every Schemigrate error. */
export class SchemigrateError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export type OutdatedDocumentRef = {
  documentId?: string;
  documentVersion: SchemaVersion;
};

/** The document has no schema version field. */
export class MissingSchemaVersionError extends SchemigrateError {
  readonly modelName?: string;
  readonly documentId?: string;

  constructor(props: { modelName?: string; documentId?: string }) {
    super(
      `Document${props.documentId ? ` ${props.documentId}` : ''}${
        props.modelName ? ` of model ${props.modelName}` : ''
      } has no schema version field.`,
    );
    this.modelName = props.modelName;
    this.documentId = props.documentId;
  }
}

/** The document uses a schema version newer than the one supported by the software. */
export class UnsupportedSchemaVersionError extends SchemigrateError {
  readonly modelName?: string;
  readonly documentId?: string;
  readonly documentVersion?: SchemaVersion;
  readonly supportedVersion: SchemaVersion;
  /** All offending documents when raised from a multi-result query. */
  readonly documents?: OutdatedDocumentRef[];

  constructor(props: {
    modelName?: string;
    documentId?: string;
    documentVersion?: SchemaVersion;
    supportedVersion: SchemaVersion;
    documents?: OutdatedDocumentRef[];
  }) {
    const count = props.documents?.length ?? 1;
    super(
      count > 1
        ? `${count} documents of model ${props.modelName ?? '?'} use a schema version newer than the supported version ${props.supportedVersion}.`
        : `Document${props.documentId ? ` ${props.documentId}` : ''}${
            props.modelName ? ` of model ${props.modelName}` : ''
          } uses schema version ${props.documentVersion}, newer than the supported version ${props.supportedVersion}.`,
    );
    this.modelName = props.modelName;
    this.documentId = props.documentId;
    this.documentVersion = props.documentVersion;
    this.supportedVersion = props.supportedVersion;
    this.documents = props.documents;
  }
}

/** The document is older than currentVersion. Raised on read — no implicit migration. */
export class OutdatedDocumentError extends SchemigrateError {
  readonly modelName?: string;
  readonly documentId?: string;
  readonly documentVersion?: SchemaVersion;
  readonly currentVersion: SchemaVersion;
  /** All offending documents when raised from a multi-result query. */
  readonly documents?: OutdatedDocumentRef[];

  constructor(props: {
    modelName?: string;
    documentId?: string;
    documentVersion?: SchemaVersion;
    currentVersion: SchemaVersion;
    documents?: OutdatedDocumentRef[];
  }) {
    const count = props.documents?.length ?? 1;
    super(
      count > 1
        ? `${count} documents of model ${props.modelName ?? '?'} are outdated (currentVersion: ${props.currentVersion}). Migrate them explicitly before reading.`
        : `Document${props.documentId ? ` ${props.documentId}` : ''}${
            props.modelName ? ` of model ${props.modelName}` : ''
          } is outdated (version ${props.documentVersion}, currentVersion ${props.currentVersion}). Migrate it explicitly before reading.`,
    );
    this.modelName = props.modelName;
    this.documentId = props.documentId;
    this.documentVersion = props.documentVersion;
    this.currentVersion = props.currentVersion;
    this.documents = props.documents;
  }
}

/** A required migration does not exist. */
export class MissingMigrationError extends SchemigrateError {
  readonly modelName?: string;
  readonly fromVersion: SchemaVersion;
  readonly toVersion: SchemaVersion;

  constructor(props: {
    modelName?: string;
    fromVersion: SchemaVersion;
    toVersion: SchemaVersion;
  }) {
    super(
      `Missing migration from schema version ${props.fromVersion} to ${props.toVersion}${
        props.modelName ? ` for model ${props.modelName}` : ''
      }.`,
    );
    this.modelName = props.modelName;
    this.fromVersion = props.fromVersion;
    this.toVersion = props.toVersion;
  }
}

/** A downgrade migration is required but absent. */
export class MissingDowngradeMigrationError extends SchemigrateError {
  readonly modelName?: string;
  readonly fromVersion: SchemaVersion;
  readonly toVersion: SchemaVersion;

  constructor(props: {
    modelName?: string;
    fromVersion: SchemaVersion;
    toVersion: SchemaVersion;
  }) {
    super(
      `Missing down migration from schema version ${props.fromVersion} to ${props.toVersion}${
        props.modelName ? ` for model ${props.modelName}` : ''
      }.`,
    );
    this.modelName = props.modelName;
    this.fromVersion = props.fromVersion;
    this.toVersion = props.toVersion;
  }
}

/** Downgrade requested while allowDowngrade is false. */
export class DowngradeNotAllowedError extends SchemigrateError {
  readonly modelName?: string;
  readonly fromVersion: SchemaVersion;
  readonly toVersion: SchemaVersion;

  constructor(props: {
    modelName?: string;
    fromVersion: SchemaVersion;
    toVersion: SchemaVersion;
  }) {
    super(
      `Downgrade from ${props.fromVersion} to ${props.toVersion}${
        props.modelName ? ` for model ${props.modelName}` : ''
      } requires allowDowngrade: true.`,
    );
    this.modelName = props.modelName;
    this.fromVersion = props.fromVersion;
    this.toVersion = props.toVersion;
  }
}

/** A migration failed during its execution. */
export class MigrationExecutionError extends SchemigrateError {
  readonly modelName?: string;
  readonly documentId?: string;
  readonly fromVersion: SchemaVersion;
  readonly toVersion: SchemaVersion;
  readonly migrationDescription?: string;

  constructor(props: {
    modelName?: string;
    documentId?: string;
    fromVersion: SchemaVersion;
    toVersion: SchemaVersion;
    migrationDescription?: string;
    cause?: unknown;
  }) {
    super(
      `Migration ${props.fromVersion} -> ${props.toVersion}${
        props.modelName ? ` for model ${props.modelName}` : ''
      }${props.documentId ? ` (document ${props.documentId})` : ''} failed${
        props.migrationDescription ? `: ${props.migrationDescription}` : ''
      }.`,
      { cause: props.cause },
    );
    this.modelName = props.modelName;
    this.documentId = props.documentId;
    this.fromVersion = props.fromVersion;
    this.toVersion = props.toVersion;
    this.migrationDescription = props.migrationDescription;
  }
}

/** The plugin configuration or the migration list is invalid. */
export class InvalidMigrationConfigurationError extends SchemigrateError {
  readonly modelName?: string;

  constructor(message: string, props?: { modelName?: string }) {
    super(message);
    this.modelName = props?.modelName;
  }
}

/** A rollback was requested but the snapshot for the targeted step is absent. */
export class MissingMigrationSnapshotError extends SchemigrateError {
  readonly modelName?: string;
  readonly documentId?: string;
  readonly stepKey: string;

  constructor(props: {
    modelName?: string;
    documentId?: string;
    stepKey: string;
  }) {
    super(
      `Missing migration snapshot '${props.stepKey}'${
        props.documentId ? ` on document ${props.documentId}` : ''
      }${props.modelName ? ` of model ${props.modelName}` : ''}.`,
    );
    this.modelName = props.modelName;
    this.documentId = props.documentId;
    this.stepKey = props.stepKey;
  }
}

/** Restoring a snapshot failed during its execution. */
export class RollbackExecutionError extends SchemigrateError {
  readonly modelName?: string;
  readonly documentId?: string;
  readonly stepKey: string;

  constructor(props: {
    modelName?: string;
    documentId?: string;
    stepKey: string;
    cause?: unknown;
  }) {
    super(
      `Rollback of step '${props.stepKey}'${
        props.documentId ? ` on document ${props.documentId}` : ''
      }${props.modelName ? ` of model ${props.modelName}` : ''} failed.`,
      { cause: props.cause },
    );
    this.modelName = props.modelName;
    this.documentId = props.documentId;
    this.stepKey = props.stepKey;
  }
}

/** A document targeted by an operation was not found. */
export class DocumentNotFoundError extends SchemigrateError {
  readonly modelName?: string;
  readonly documentId: string;

  constructor(props: { modelName?: string; documentId: string }) {
    super(
      `Document ${props.documentId}${
        props.modelName ? ` of model ${props.modelName}` : ''
      } was not found.`,
    );
    this.modelName = props.modelName;
    this.documentId = props.documentId;
  }
}
