import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SchemigrateModule } from '../../../src/nestjs/schemigrate.module.js';
import { SchemigrateService } from '../../../src/nestjs/schemigrate.service.js';
import { SchemigrateRegistry } from '../../../src/nestjs/schemigrate.registry.js';
import { SCHEMIGRATE_MODULE_OPTIONS } from '../../../src/nestjs/schemigrate.constants.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import { CONTAINER_SCHEMA_V3 } from '../../fixtures/versions.js';

describe('SchemigrateModule', () => {
  it('expose SchemigrateService avec forRoot()', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        SchemigrateModule.forRoot({
          logger: false,
        }),
      ],
    }).compile();

    expect(moduleRef.get(SchemigrateService)).toBeDefined();
    expect(moduleRef.get(SchemigrateRegistry)).toBeDefined();
    await moduleRef.close();
  });

  it('charge la config via forRootAsync()', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ SCHEMIGRATE_AUTO_RUN: false })],
        }),
        SchemigrateModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            autoRunOnBootstrap: config.get('SCHEMIGRATE_AUTO_RUN'),
            logger: false,
          }),
        }),
      ],
    }).compile();

    expect(moduleRef.get(SchemigrateService)).toBeDefined();
    const options = moduleRef.get(SCHEMIGRATE_MODULE_OPTIONS);
    expect(options).toMatchObject({ autoRunOnBootstrap: false, logger: false });
    await moduleRef.close();
  });

  it('forFeature enregistre les modèles dans le registre', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        SchemigrateModule.forRoot({ logger: false }),
        SchemigrateModule.forFeature([
          {
            modelName: 'Container',
            currentVersion: CONTAINER_SCHEMA_V3,
            versionPath: '__schemaVersion',
            migrations: containerMigrations,
          },
        ]),
      ],
    }).compile();

    const registry = moduleRef.get(SchemigrateRegistry);
    expect(registry.has('Container')).toBe(true);
    expect(registry.getCurrentVersion('Container')).toBe(CONTAINER_SCHEMA_V3);
    await moduleRef.close();
  });

  it('forFeature rejette des migrations invalides à l’enregistrement', async () => {
    const building = Test.createTestingModule({
      imports: [
        SchemigrateModule.forRoot({ logger: false }),
        SchemigrateModule.forFeature([
          {
            modelName: 'Broken',
            currentVersion: CONTAINER_SCHEMA_V3,
            migrations: [
              { from: 2, to: 1, up: async (doc) => doc },
            ],
          },
        ]),
      ],
    }).compile();

    await expect(building).rejects.toThrowError(/strictly greater/);
  });
});
