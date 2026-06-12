import { Injectable } from '@nestjs/common';
import type { Model } from 'mongoose';
import { SchemigrateService } from '../../src/nestjs/index.js';
import { CONTAINER_SCHEMA_V3 } from './versions.js';
import type { Container } from './container.schema.js';

/**
 * Business service from SPEC §35. Constructed manually in tests (the test
 * runner does not emit constructor metadata for property-less DI).
 */
@Injectable()
export class ContainerService {
  constructor(
    private readonly containerModel: Model<Container>,
    private readonly schemigrateService: SchemigrateService,
  ) {}

  async migrateAllContainers() {
    return this.schemigrateService.migrateMany(
      this.containerModel,
      { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
      CONTAINER_SCHEMA_V3,
      {
        batchSize: 100,
        dryRun: false,
        continueOnError: true,
      },
    );
  }
}
