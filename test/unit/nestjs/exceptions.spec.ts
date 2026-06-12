import { describe, it, expect } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  toNestSchemigrateException,
  OutdatedDocumentException,
  UnsupportedSchemaVersionException,
  MissingMigrationException,
  MigrationExecutionException,
} from '../../../src/nestjs/exceptions.js';
import {
  DocumentNotFoundError,
  DowngradeNotAllowedError,
  MigrationExecutionError,
  MissingMigrationError,
  OutdatedDocumentError,
  UnsupportedSchemaVersionError,
} from '../../../src/errors/index.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

describe('toNestSchemigrateException', () => {
  it('convertit UnsupportedSchemaVersionError en ConflictException', () => {
    const error = new UnsupportedSchemaVersionError({
      modelName: 'Container',
      documentVersion: 9999999999999,
      supportedVersion: CONTAINER_SCHEMA_V3,
    });

    const exception = toNestSchemigrateException(error);
    expect(exception).toBeInstanceOf(ConflictException);
    expect(exception).toBeInstanceOf(UnsupportedSchemaVersionException);
  });

  it('convertit OutdatedDocumentError en ConflictException avec le détail', () => {
    const error = new OutdatedDocumentError({
      modelName: 'Container',
      documentId: '64f',
      documentVersion: CONTAINER_SCHEMA_V1,
      currentVersion: CONTAINER_SCHEMA_V3,
    });

    const exception = toNestSchemigrateException(error);
    expect(exception).toBeInstanceOf(OutdatedDocumentException);
    expect(exception.getStatus()).toBe(409);
    expect(exception.getResponse()).toMatchObject({
      modelName: 'Container',
      documentId: '64f',
      documentVersion: CONTAINER_SCHEMA_V1,
      currentVersion: CONTAINER_SCHEMA_V3,
    });
  });

  it('convertit MissingMigrationError en InternalServerErrorException', () => {
    const exception = toNestSchemigrateException(
      new MissingMigrationError({
        fromVersion: CONTAINER_SCHEMA_V1,
        toVersion: CONTAINER_SCHEMA_V3,
      }),
    );

    expect(exception).toBeInstanceOf(InternalServerErrorException);
    expect(exception).toBeInstanceOf(MissingMigrationException);
  });

  it('convertit MigrationExecutionError en InternalServerErrorException', () => {
    const exception = toNestSchemigrateException(
      new MigrationExecutionError({
        fromVersion: CONTAINER_SCHEMA_V1,
        toVersion: CONTAINER_SCHEMA_V3,
      }),
    );

    expect(exception).toBeInstanceOf(MigrationExecutionException);
  });

  it('convertit DowngradeNotAllowedError en ForbiddenException', () => {
    const exception = toNestSchemigrateException(
      new DowngradeNotAllowedError({
        fromVersion: CONTAINER_SCHEMA_V3,
        toVersion: CONTAINER_SCHEMA_V1,
      }),
    );

    expect(exception).toBeInstanceOf(ForbiddenException);
  });

  it('convertit DocumentNotFoundError en NotFoundException', () => {
    const exception = toNestSchemigrateException(
      new DocumentNotFoundError({ documentId: '64f' }),
    );

    expect(exception).toBeInstanceOf(NotFoundException);
  });

  it('laisse passer une HttpException existante', () => {
    const original = new ConflictException('already');
    expect(toNestSchemigrateException(original)).toBe(original);
  });

  it('convertit une erreur inconnue en InternalServerErrorException', () => {
    const exception = toNestSchemigrateException(new Error('boom'));
    expect(exception).toBeInstanceOf(InternalServerErrorException);
  });
});
