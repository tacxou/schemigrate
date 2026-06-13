// @tacxou/schemigrate/nestjs — optional NestJS integration (SPEC §30).
// Import explicitly from this subpath; it is never re-exported from the
// main entry point and the core never depends on @nestjs/*.

export { SchemigrateModule } from './schemigrate.module.js';
export { SchemigrateService } from './schemigrate.service.js';
export { SchemigrateRegistry } from './schemigrate.registry.js';
export { SchemigrateBootstrapService } from './schemigrate-bootstrap.service.js';

export {
  SCHEMIGRATE_MODULE_OPTIONS,
  SCHEMIGRATE_LOGGER,
} from './schemigrate.constants.js';

export type {
  SchemigrateModuleOptions,
  SchemigrateModuleAsyncOptions,
  SchemigrateFeatureOptions,
} from './schemigrate.interfaces.js';

export { adaptNestLogger, resolveModuleLogger } from './nest-logger.adapter.js';

export {
  Schemigrate,
  getSchemigrateMetadata,
  applySchemigratePlugin,
} from './schemigrate.decorator.js';

export {
  SchemigrateHealthIndicator,
  SchemigrateHealthCheckError,
} from './schemigrate.health.js';
export type {
  SchemigrateHealthResult,
  SchemigrateModelHealth,
  SchemigrateHealthOptions,
} from './schemigrate.health.js';

export {
  OutdatedDocumentException,
  UnsupportedSchemaVersionException,
  MissingSchemaVersionException,
  MissingMigrationException,
  MigrationExecutionException,
  DowngradeNotAllowedException,
  toNestSchemigrateException,
} from './exceptions.js';
