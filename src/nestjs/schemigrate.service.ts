import { Inject, Injectable, Optional } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection, FilterQuery, Model } from 'mongoose';
import { InvalidMigrationConfigurationError } from '../errors/index.js';
import type { SchemaVersionedModel } from '../plugin/schemigrate-plugin.js';
import type {
  MigrationStatus,
  SchemaVersion,
  SchemigrateAbortOptions,
  SchemigrateBatchOptions,
  SchemigrateBatchResult,
  SchemigrateDryRunResult,
  SchemigrateLogger,
  SchemigrateMigrationOptions,
  SchemigratePlan,
} from '../types.js';
import { SCHEMIGRATE_LOGGER } from './schemigrate.constants.js';
import { SchemigrateRegistry } from './schemigrate.registry.js';

type AnyVersionedModel = SchemaVersionedModel<Record<string, unknown>>;

/**
 * Orchestration façade (SPEC §35): delegates to the statics installed by the
 * schemigrate plugin on each model, and to the forFeature registry for
 * model-name based lookups.
 */
@Injectable()
export class SchemigrateService {
  constructor(
    @Optional()
    @Inject(SchemigrateRegistry)
    private readonly registry?: SchemigrateRegistry,

    @Optional()
    @Inject(getConnectionToken())
    private readonly connection?: Connection,

    @Optional()
    @Inject(SCHEMIGRATE_LOGGER)
    private readonly logger?: SchemigrateLogger,
  ) {}

  private asVersionedModel<T>(model: Model<T>): AnyVersionedModel {
    const candidate = model as unknown as AnyVersionedModel;
    if (typeof candidate.migrateMany !== 'function') {
      throw new InvalidMigrationConfigurationError(
        `Model '${model?.modelName ?? '?'}' does not have the schemigrate plugin applied.`,
        { modelName: model?.modelName },
      );
    }
    return candidate;
  }

  async migrateDocument<T>(
    model: Model<T>,
    document: Record<string, unknown>,
    targetVersion?: SchemaVersion,
    options?: SchemigrateMigrationOptions,
  ): Promise<Record<string, unknown>> {
    return this.asVersionedModel(model).migrateDocument(document, targetVersion, options);
  }

  async migrateById<T>(
    model: Model<T>,
    id: unknown,
    targetVersion?: SchemaVersion,
    options?: SchemigrateMigrationOptions,
  ): Promise<unknown> {
    return this.asVersionedModel(model).migrateById(id, targetVersion, options);
  }

  async migrateMany<T>(
    model: Model<T>,
    filter: FilterQuery<T>,
    targetVersion?: SchemaVersion,
    options?: SchemigrateBatchOptions,
  ): Promise<SchemigrateBatchResult> {
    return this.asVersionedModel(model).migrateMany(
      filter as FilterQuery<Record<string, unknown>>,
      targetVersion,
      options,
    );
  }

  getMigrationPlan(
    modelName: string,
    fromVersion: SchemaVersion,
    toVersion: SchemaVersion,
  ): SchemigratePlan {
    if (!this.registry) {
      throw new InvalidMigrationConfigurationError(
        'getMigrationPlan(modelName, …) requires SchemigrateModule.forFeature() registrations.',
        { modelName },
      );
    }
    return this.registry.getMigrationPlan(modelName, fromVersion, toVersion);
  }

  async getMigrationStatus<T>(model: Model<T>): Promise<MigrationStatus> {
    return this.asVersionedModel(model).getMigrationStatus();
  }

  async syncToCurrentVersion<T>(
    model: Model<T>,
    options?: SchemigrateBatchOptions,
  ): Promise<SchemigrateBatchResult> {
    return this.asVersionedModel(model).syncToCurrentVersion(options);
  }

  /**
   * Migrates every resolvable model to its currentVersion (SPEC §35, §37).
   * Models come from the forFeature registry when populated, otherwise every
   * connection model carrying the plugin is synced.
   */
  async syncAllToCurrentVersion(
    options?: SchemigrateBatchOptions,
  ): Promise<Record<string, SchemigrateBatchResult>> {
    const results: Record<string, SchemigrateBatchResult> = {};

    for (const model of this.resolveRegisteredModels()) {
      results[model.modelName] = await model.syncToCurrentVersion(options);
      this.logger?.info?.(
        `[Schemigrate] ${model.modelName}: bootstrap sync completed`,
        { ...results[model.modelName], errors: results[model.modelName].errors.length },
      );
    }

    return results;
  }

  async dryRun<T>(
    model: Model<T>,
    filter: FilterQuery<T>,
    targetVersion?: SchemaVersion,
  ): Promise<SchemigrateDryRunResult[]> {
    return this.asVersionedModel(model).dryRun(
      filter as FilterQuery<Record<string, unknown>>,
      targetVersion,
    );
  }

  async abortMigrationMany<T>(
    model: Model<T>,
    filter: FilterQuery<T>,
    options?: SchemigrateAbortOptions,
  ): Promise<SchemigrateBatchResult> {
    return this.asVersionedModel(model).abortMigrationMany(
      filter as FilterQuery<Record<string, unknown>>,
      options,
    );
  }

  private resolveRegisteredModels(): AnyVersionedModel[] {
    if (!this.connection) {
      this.logger?.warn?.(
        '[Schemigrate] syncAllToCurrentVersion: no Mongoose connection injected — nothing to sync.',
      );
      return [];
    }

    const registered = this.registry?.getModelNames() ?? [];
    const models: AnyVersionedModel[] = [];

    const candidates =
      registered.length > 0
        ? registered.map((name) => this.connection?.models[name])
        : Object.values(this.connection.models);

    for (const model of candidates) {
      if (!model) continue;
      const candidate = model as unknown as AnyVersionedModel;
      if (typeof candidate.syncToCurrentVersion === 'function') {
        models.push(candidate);
      } else {
        this.logger?.warn?.(
          `[Schemigrate] model '${model.modelName}' is registered but has no schemigrate plugin — skipped.`,
        );
      }
    }

    return models;
  }
}
