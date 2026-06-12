import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { resolveModuleLogger } from './nest-logger.adapter.js';
import { SCHEMIGRATE_LOGGER, SCHEMIGRATE_MODULE_OPTIONS } from './schemigrate.constants.js';
import type {
  SchemigrateFeatureOptions,
  SchemigrateModuleAsyncOptions,
  SchemigrateModuleOptions,
} from './schemigrate.interfaces.js';
import { SchemigrateBootstrapService } from './schemigrate-bootstrap.service.js';
import { SchemigrateRegistry } from './schemigrate.registry.js';
import { SchemigrateService } from './schemigrate.service.js';

let featureCounter = 0;

function coreProviders(): Provider[] {
  return [
    {
      provide: SCHEMIGRATE_LOGGER,
      useFactory: (options: SchemigrateModuleOptions) => resolveModuleLogger(options.logger),
      inject: [SCHEMIGRATE_MODULE_OPTIONS],
    },
    SchemigrateRegistry,
    SchemigrateService,
    SchemigrateBootstrapService,
  ];
}

/**
 * NestJS integration of Schemigrate (SPEC §34).
 * Exposed via the `@tacxou/schemigrate/nestjs` subpath only — never
 * re-exported from the main entry point.
 */
@Module({})
export class SchemigrateModule {
  static forRoot(options: SchemigrateModuleOptions = {}): DynamicModule {
    return {
      module: SchemigrateModule,
      global: true,
      providers: [
        { provide: SCHEMIGRATE_MODULE_OPTIONS, useValue: options },
        ...coreProviders(),
      ],
      exports: [SchemigrateService, SchemigrateRegistry, SCHEMIGRATE_MODULE_OPTIONS],
    };
  }

  static forRootAsync(options: SchemigrateModuleAsyncOptions): DynamicModule {
    return {
      module: SchemigrateModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        {
          provide: SCHEMIGRATE_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: (options.inject ?? []) as never[],
        },
        ...coreProviders(),
      ],
      exports: [SchemigrateService, SchemigrateRegistry, SCHEMIGRATE_MODULE_OPTIONS],
    };
  }

  /**
   * Registers models in the SchemigrateRegistry (SPEC §36). Migrations are
   * validated at registration. Requires forRoot()/forRootAsync() upstream.
   */
  static forFeature(features: SchemigrateFeatureOptions[]): DynamicModule {
    const registrationToken = `SCHEMIGRATE_FEATURE_${featureCounter++}`;
    return {
      module: SchemigrateModule,
      providers: [
        {
          provide: registrationToken,
          useFactory: (registry: SchemigrateRegistry) => {
            for (const feature of features) {
              registry.register(feature);
            }
            return features;
          },
          inject: [SchemigrateRegistry],
        },
      ],
      exports: [registrationToken],
    };
  }
}
