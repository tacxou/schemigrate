import { Injectable } from '@nestjs/common';
import { buildMigrationPlan } from '../engine/build-migration-plan.js';
import { validateMigrations } from '../engine/validate-migrations.js';
import { InvalidMigrationConfigurationError } from '../errors/index.js';
import type { SchemaVersion, SchemigratePlan } from '../types.js';
import type { SchemigrateFeatureOptions } from './schemigrate.interfaces.js';

/**
 * Per-model migration registry (SPEC §36). Populated by
 * SchemigrateModule.forFeature(); migrations are validated at registration.
 */
@Injectable()
export class SchemigrateRegistry {
  private readonly features = new Map<string, SchemigrateFeatureOptions>();

  register(feature: SchemigrateFeatureOptions): void {
    if (!feature?.modelName) {
      throw new InvalidMigrationConfigurationError(
        'SchemigrateModule.forFeature(): modelName is required.',
      );
    }
    if (this.features.has(feature.modelName)) {
      throw new InvalidMigrationConfigurationError(
        `SchemigrateModule.forFeature(): model '${feature.modelName}' is already registered.`,
        { modelName: feature.modelName },
      );
    }
    validateMigrations(feature.migrations ?? [], {
      modelName: feature.modelName,
      currentVersion: feature.currentVersion,
    });
    this.features.set(feature.modelName, feature);
  }

  has(modelName: string): boolean {
    return this.features.has(modelName);
  }

  getFeature(modelName: string): SchemigrateFeatureOptions {
    const feature = this.features.get(modelName);
    if (!feature) {
      throw new InvalidMigrationConfigurationError(
        `Model '${modelName}' is not registered in SchemigrateModule.forFeature().`,
        { modelName },
      );
    }
    return feature;
  }

  getModelNames(): string[] {
    return [...this.features.keys()];
  }

  getCurrentVersion(modelName: string): SchemaVersion {
    return this.getFeature(modelName).currentVersion;
  }

  getMigrationPlan(
    modelName: string,
    fromVersion: SchemaVersion,
    toVersion: SchemaVersion,
  ): SchemigratePlan {
    const feature = this.getFeature(modelName);
    return buildMigrationPlan(feature.migrations, fromVersion, toVersion, { modelName });
  }
}
