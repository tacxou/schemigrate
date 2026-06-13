# Schemigrate

**Schema version management for MongoDB documents, as a Mongoose plugin.**

Schemigrate lets your documents evolve over time with SQL-style migrations applied at the document level — explicit, safe by default, and fully traceable. Reads never mutate data: an outdated document raises a typed error until you migrate it explicitly.

> Full functional specification (French): [SPEC.md](SPEC.md)

## Highlights

- 🕐 **Timestamp-based versions** — structure versions are creation timestamps (`1782460800000`), no manual numbering, natural `$lt`/`$gt` queries
- 🚫 **No implicit migration on read** — `find()` on an outdated document throws `OutdatedDocumentError`; migration is always an explicit action
- ⚛️ **Atomic execution** — the whole migration plan runs in memory, then a single optimistic-locked write persists it; a failed migration writes **zero** business data
- 📸 **Snapshots & rollback** — each step captures the data it changes; roll back any step explicitly, clean up snapshots explicitly
- 🧪 **Dry-run everywhere** — preview plans, changes and snapshots without writing
- 🏗️ **NestJS integration** — `SchemigrateModule`, injectable `SchemigrateService`, HTTP exceptions, opt-in bootstrap sync (via `@tacxou/schemigrate/nestjs`)
- 🖥️ **CLI** — `schemigrate status | up | down | dry-run | rollback | abort | snapshots | cleanup-snapshots`

## Installation

```bash
yarn add @tacxou/schemigrate mongoose
# NestJS integration (optional)
yarn add @nestjs/common @nestjs/mongoose
```

## Quickstart (Mongoose)

```ts
import { Schema, model } from 'mongoose';
import { schemigratePlugin, createSchemaVersion } from '@tacxou/schemigrate';

// Structure versions = creation timestamps (ms UTC)
const CONTAINER_SCHEMA_V1 = createSchemaVersion('2026-06-12T08:00:00.000Z'); // 1781251200000
const CONTAINER_SCHEMA_V2 = createSchemaVersion('2026-06-19T08:00:00.000Z'); // 1781856000000

const containerSchema = new Schema({
  name: String,
  ports: [String],
});

containerSchema.plugin(schemigratePlugin, {
  currentVersion: CONTAINER_SCHEMA_V2,
  migrations: [
    {
      from: CONTAINER_SCHEMA_V1,
      to: CONTAINER_SCHEMA_V2,
      description: 'Transform port string into ports array',
      up: async (doc) => {
        if (doc.port && !Array.isArray(doc.ports)) doc.ports = [doc.port];
        delete doc.port;
        return doc;
      },
      down: async (doc) => {
        if (Array.isArray(doc.ports)) doc.port = doc.ports[0];
        delete doc.ports;
        return doc;
      },
    },
  ],
});

export const Container = model('Container', containerSchema);
```

New documents are stamped with `currentVersion` automatically (`save`, `insertMany`, upserts). Reserved fields (`__schemaVersion`, `__migrationSnapshots`, …) are hidden from `toJSON()` by default.

### Reading — no implicit migration, ever

```ts
import { OutdatedDocumentError } from '@tacxou/schemigrate';

try {
  const container = await Container.findById(id);
} catch (error) {
  if (error instanceof OutdatedDocumentError) {
    // The document must be migrated explicitly first.
  }
}

// Explicit per-query bypass (tooling, administration):
const raw = await Container.findById(id).setOptions({ schemigrateCheck: false }).lean();
```

⚠️ Migration functions receive **plain objects** (read via `lean()`), never hydrated documents — legacy fields removed from your current schema stay accessible, and writes happen at collection level with an optimistic lock (`{ _id, __schemaVersion: fromVersion }`). Concurrent processes can run the same migration safely: a document migrated by someone else is skipped, never overwritten.

### Migrating — always explicit

```ts
// One document
await Container.migrateById(id);                       // to currentVersion
await doc.migrateToCurrentVersion({ save: true });

// In bulk
const result = await Container.migrateMany(
  { __schemaVersion: { $lt: Container.getCurrentSchemaVersion() } },
  undefined,                       // target defaults to currentVersion
  { batchSize: 100, continueOnError: true },
);
// => { matched, migrated, skipped, failed, errors }

// Preview without writing
const report = await Container.dryRun({ __schemaVersion: { $lt: TARGET } });
// => [{ documentId, fromVersion, targetVersion, plan, snapshotsPreview, changesPreview }]

// Inspect
await Container.getMigrationStatus();
// => { model, currentVersion, outdatedDocuments, currentDocuments,
//      newerDocuments, failedDocuments, inProgressDocuments }
```

A failed migration writes **no business data** — only a `__migrationState: { status: 'failed', … }` diagnostic marker, cleared by `abortMigration()` / `abortMigrationMany()` or by the next successful run.

### Snapshots & rollback

Before each step, the fields it modifies or removes are captured in `__migrationSnapshots` (diff-based). Downgrades require `allowDowngrade: true` and `down` functions.

```ts
doc.listMigrationSnapshots();
await Container.rollbackMigrationById(id, '1781251200000_to_1781856000000');
await Container.cleanupMigrationSnapshots({}, { olderThan: '30d' }); // explicit cleanup only
```

## NestJS

```ts
import { SchemigrateModule, SchemigrateService } from '@tacxou/schemigrate/nestjs';

@Module({
  imports: [
    SchemigrateModule.forRoot({
      logger: true,
      autoRunOnBootstrap: false, // opt-in startup sync
    }),
    SchemigrateModule.forFeature([
      { modelName: Container.name, currentVersion: CONTAINER_SCHEMA_V2, migrations },
    ]),
  ],
})
export class AppModule {}
```

Inject `SchemigrateService` to orchestrate (`migrateMany`, `getMigrationStatus`, `syncAllToCurrentVersion`, `dryRun`, …), and convert core errors into HTTP exceptions:

```ts
import { toNestSchemigrateException } from '@tacxou/schemigrate/nestjs';

throw toNestSchemigrateException(error); // OutdatedDocumentError -> 409 Conflict, etc.
```

The core package never depends on `@nestjs/*`; the integration lives only under the `/nestjs` subpath.

### Decorator (optional)

```ts
import { Schemigrate, applySchemigratePlugin } from '@tacxou/schemigrate/nestjs';

@Schemigrate({ currentVersion: CONTAINER_SCHEMA_V2, migrations })
@Schema({ timestamps: true })
export class Container { /* … */ }

export const ContainerSchema = applySchemigratePlugin(
  SchemaFactory.createForClass(Container),
  Container,
);
```

Requires `import 'reflect-metadata';` at your application entry point.

### Healthcheck (optional, `@nestjs/terminus`)

```ts
import { SchemigrateHealthIndicator } from '@tacxou/schemigrate/nestjs';

@Get('health')
@HealthCheck()
check() {
  return this.health.check([
    () => this.schemigrateHealth.isHealthy('schemigrate', {
      models: [this.containerModel],     // failOnOutdated/Newer/Failed configurable
    }),
  ]);
}
// down details: { schemigrate: { status, models: { Container: { outdatedDocuments, newerDocuments, … } } } }
```

`@nestjs/terminus` is an optional peer dependency — install it only if you use the healthcheck.

## CLI

Create `schemigrate.config.ts` (or `.mjs`) at the project root:

```ts
import { defineSchemigrateConfig } from '@tacxou/schemigrate';
import { containerMigrations, CONTAINER_SCHEMA_V2 } from './src/migrations';

export default defineSchemigrateConfig({
  uri: process.env.MONGODB_URI,
  models: [
    {
      name: 'Container',
      collection: 'containers',
      currentVersion: CONTAINER_SCHEMA_V2,
      migrations: containerMigrations,
    },
  ],
});
```

```bash
schemigrate status                      # state of every model
schemigrate up Container                # migrate outdated documents
schemigrate up --all
schemigrate dry-run Container --verbose # preview, no writes
schemigrate down Container --to 1781251200000   # requires allowDowngrade
schemigrate rollback Container --id 64f… --step 1781251200000_to_1781856000000
schemigrate abort Container             # clear failed markers
schemigrate snapshots Container
schemigrate cleanup-snapshots Container --older-than 30d --dry-run
```

All commands accept `--json` (machine-readable output) and exit non-zero when any document fails.

## Deploying (expand / contract)

During a rolling deploy, old instances reading freshly migrated documents would raise `UnsupportedSchemaVersionError`. Deploy in three phases:

1. **Expand** — ship code that supports the new structure everywhere (migration declared, `currentVersion` unchanged);
2. **Migrate** — run `schemigrate up` (job, init container, CI step);
3. **Contract** — ship code that requires the new structure (`currentVersion` advanced).

Prefer a single `schemigrate up` job over `autoRunOnBootstrap` with multiple replicas (the optimistic lock keeps concurrent runs safe either way).

## Known limitations

- The read guard covers `find`/`findOne`/`findById` (hydrated and `lean()`); `aggregate()`, `distinct()`, raw driver access and query cursors are **not** guarded.
- Snapshots live inside the document and count toward MongoDB's 16 MB limit — clean them up explicitly.

## License

BSD 3-Clause — see [LICENSE](LICENSE).
