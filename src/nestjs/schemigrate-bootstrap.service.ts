import { Inject, Injectable, Optional, type OnApplicationBootstrap } from '@nestjs/common';
import type { SchemigrateLogger } from '../types.js';
import { SCHEMIGRATE_LOGGER, SCHEMIGRATE_MODULE_OPTIONS } from './schemigrate.constants.js';
import type { SchemigrateModuleOptions } from './schemigrate.interfaces.js';
import { SchemigrateService } from './schemigrate.service.js';

/**
 * Opt-in bootstrap migration (SPEC §37): when `autoRunOnBootstrap` is true,
 * every registered model is synced to its currentVersion on application
 * bootstrap. Disabled by default.
 */
@Injectable()
export class SchemigrateBootstrapService implements OnApplicationBootstrap {
  constructor(
    @Inject(SCHEMIGRATE_MODULE_OPTIONS)
    private readonly options: SchemigrateModuleOptions,

    @Inject(SchemigrateService)
    private readonly schemigrateService: SchemigrateService,

    @Optional()
    @Inject(SCHEMIGRATE_LOGGER)
    private readonly logger?: SchemigrateLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.autoRunOnBootstrap) return;

    this.logger?.info?.('[Schemigrate] autoRunOnBootstrap: syncing all models…');
    const results = await this.schemigrateService.syncAllToCurrentVersion(
      this.options.bootstrapOptions,
    );

    const summary = Object.entries(results)
      .map(([name, r]) => `${name}: ${r.migrated} migrated, ${r.failed} failed`)
      .join(' | ');
    this.logger?.info?.(`[Schemigrate] bootstrap sync done — ${summary || 'no model'}`);
  }
}
