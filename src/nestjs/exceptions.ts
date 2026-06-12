import {
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentNotFoundError,
  DowngradeNotAllowedError,
  InvalidMigrationConfigurationError,
  MigrationExecutionError,
  MissingDowngradeMigrationError,
  MissingMigrationError,
  MissingMigrationSnapshotError,
  MissingSchemaVersionError,
  OutdatedDocumentError,
  RollbackExecutionError,
  UnsupportedSchemaVersionError,
} from '../errors/index.js';

/** A read hit a document older than currentVersion — migrate it explicitly first. */
export class OutdatedDocumentException extends ConflictException {
  constructor(error: OutdatedDocumentError) {
    super({
      message: error.message,
      error: 'OutdatedDocument',
      modelName: error.modelName,
      documentId: error.documentId,
      documentVersion: error.documentVersion,
      currentVersion: error.currentVersion,
      documents: error.documents,
    });
    this.cause = error;
  }
}

/** A read hit a document newer than the supported schema version. */
export class UnsupportedSchemaVersionException extends ConflictException {
  constructor(error: UnsupportedSchemaVersionError) {
    super({
      message: error.message,
      error: 'UnsupportedSchemaVersion',
      modelName: error.modelName,
      documentId: error.documentId,
      documentVersion: error.documentVersion,
      supportedVersion: error.supportedVersion,
      documents: error.documents,
    });
    this.cause = error;
  }
}

/** A document has no schema version field. */
export class MissingSchemaVersionException extends ConflictException {
  constructor(error: MissingSchemaVersionError) {
    super({
      message: error.message,
      error: 'MissingSchemaVersion',
      modelName: error.modelName,
      documentId: error.documentId,
    });
    this.cause = error;
  }
}

/** A required migration (or downgrade migration) is missing or misconfigured. */
export class MissingMigrationException extends InternalServerErrorException {
  constructor(
    error:
      | MissingMigrationError
      | MissingDowngradeMigrationError
      | MissingMigrationSnapshotError
      | InvalidMigrationConfigurationError,
  ) {
    super({
      message: error.message,
      error: error.name,
      modelName: error.modelName,
    });
    this.cause = error;
  }
}

/** A migration or rollback failed during its execution. */
export class MigrationExecutionException extends InternalServerErrorException {
  constructor(error: MigrationExecutionError | RollbackExecutionError) {
    super({
      message: error.message,
      error: error.name,
      modelName: error.modelName,
      documentId: error.documentId,
    });
    this.cause = error;
  }
}

/** A downgrade was requested without allowDowngrade: true. */
export class DowngradeNotAllowedException extends ForbiddenException {
  constructor(error: DowngradeNotAllowedError) {
    super({
      message: error.message,
      error: 'DowngradeNotAllowed',
      modelName: error.modelName,
      fromVersion: error.fromVersion,
      toVersion: error.toVersion,
    });
    this.cause = error;
  }
}

/**
 * Converts any Schemigrate (or unknown) error into a NestJS HttpException
 * (SPEC §39). HttpExceptions pass through untouched.
 */
export function toNestSchemigrateException(error: unknown): HttpException {
  if (error instanceof HttpException) return error;

  if (error instanceof OutdatedDocumentError) {
    return new OutdatedDocumentException(error);
  }
  if (error instanceof UnsupportedSchemaVersionError) {
    return new UnsupportedSchemaVersionException(error);
  }
  if (error instanceof MissingSchemaVersionError) {
    return new MissingSchemaVersionException(error);
  }
  if (error instanceof DowngradeNotAllowedError) {
    return new DowngradeNotAllowedException(error);
  }
  if (error instanceof DocumentNotFoundError) {
    return new NotFoundException({
      message: error.message,
      error: 'DocumentNotFound',
      modelName: error.modelName,
      documentId: error.documentId,
    });
  }
  if (
    error instanceof MissingMigrationError ||
    error instanceof MissingDowngradeMigrationError ||
    error instanceof MissingMigrationSnapshotError ||
    error instanceof InvalidMigrationConfigurationError
  ) {
    return new MissingMigrationException(error);
  }
  if (error instanceof MigrationExecutionError || error instanceof RollbackExecutionError) {
    return new MigrationExecutionException(error);
  }

  return new InternalServerErrorException({
    message: error instanceof Error ? error.message : String(error),
    error: 'SchemigrateError',
  });
}
