import type { Schema } from 'mongoose';
import { schemigratePlugin } from '../plugin/schemigrate-plugin.js';
import { InvalidMigrationConfigurationError } from '../errors/index.js';
import type { SchemigratePluginOptions } from '../types.js';

const SCHEMIGRATE_METADATA = Symbol.for('schemigrate:options');

type ReflectWithMetadata = typeof Reflect & {
  defineMetadata(key: unknown, value: unknown, target: object): void;
  getMetadata(key: unknown, target: object): unknown;
};

function reflect(): ReflectWithMetadata {
  const r = Reflect as ReflectWithMetadata;
  if (typeof r.defineMetadata !== 'function' || typeof r.getMetadata !== 'function') {
    throw new InvalidMigrationConfigurationError(
      '@Schemigrate() requires reflect-metadata. Add `import "reflect-metadata";` at your application entry point.',
    );
  }
  return r;
}

/**
 * Class decorator (SPEC §40) that attaches Schemigrate plugin options to a
 * NestJS schema class. The plugin is applied later via
 * `applySchemigratePlugin(schema, TargetClass)`, once the schema has been
 * built by `SchemaFactory.createForClass()`.
 *
 * ```ts
 * @Schemigrate({ currentVersion: CONTAINER_SCHEMA_V3, migrations })
 * @Schema({ timestamps: true })
 * export class Container { ... }
 *
 * export const ContainerSchema = applySchemigratePlugin(
 *   SchemaFactory.createForClass(Container),
 *   Container,
 * );
 * ```
 */
export function Schemigrate(options: SchemigratePluginOptions): ClassDecorator {
  return (target) => {
    reflect().defineMetadata(SCHEMIGRATE_METADATA, options, target);
  };
}

/** Reads the options attached by `@Schemigrate()`, if any. */
export function getSchemigrateMetadata(
  target: object,
): SchemigratePluginOptions | undefined {
  return reflect().getMetadata(SCHEMIGRATE_METADATA, target) as
    | SchemigratePluginOptions
    | undefined;
}

/**
 * Applies the Schemigrate plugin to `schema` using the options declared with
 * `@Schemigrate()` on `target`. Throws if the decorator metadata is missing.
 */
export function applySchemigratePlugin<S extends Schema>(schema: S, target: object): S {
  const options = getSchemigrateMetadata(target);
  if (!options) {
    throw new InvalidMigrationConfigurationError(
      `No @Schemigrate() metadata found on '${
        (target as { name?: string })?.name ?? String(target)
      }'. Did you forget to apply the @Schemigrate() decorator?`,
    );
  }
  schema.plugin(schemigratePlugin, options);
  return schema;
}
