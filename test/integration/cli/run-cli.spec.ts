import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { getMongoUri } from '../../helpers/mongo-setup.js';
import { runCli, type CliIO } from '../../../src/cli/run-cli.js';
import { defineSchemigrateConfig } from '../../../src/cli/define-config.js';
import { containerMigrations } from '../../fixtures/container.migrations.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V2,
  CONTAINER_SCHEMA_V3,
} from '../../fixtures/versions.js';

const COLLECTION = 'cli_containers';
const STEP_1_2 = `${CONTAINER_SCHEMA_V1}_to_${CONTAINER_SCHEMA_V2}`;

function createConfig() {
  return defineSchemigrateConfig({
    uri: getMongoUri(),
    models: [
      {
        name: 'Container',
        collection: COLLECTION,
        currentVersion: CONTAINER_SCHEMA_V3,
        migrations: containerMigrations,
        allowDowngrade: true,
      },
    ],
  });
}

function createIO(): CliIO & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
  };
}

function collection() {
  return mongoose.connection.collection(COLLECTION);
}

async function run(argv: string[], io = createIO()) {
  const code = await runCli(argv, { config: createConfig(), io });
  return { code, io };
}

describe('CLI — runCli', () => {
  beforeEach(async () => {
    await collection().deleteMany({});
  });

  it('affiche l’aide sans commande (code 1) et avec help (code 0)', async () => {
    const noCommand = await run([]);
    expect(noCommand.code).toBe(1);
    expect(noCommand.io.stdout.join('\n')).toContain('Usage: schemigrate');

    const help = await run(['help']);
    expect(help.code).toBe(0);
  });

  it('rejette une commande inconnue', async () => {
    const { code, io } = await run(['frobnicate']);
    expect(code).toBe(1);
    expect(io.stderr.join('\n')).toContain("Unknown command 'frobnicate'");
  });

  it('rejette un modèle inconnu', async () => {
    const { code, io } = await run(['status', 'Nope']);
    expect(code).toBe(1);
    expect(io.stderr.join('\n')).toContain("Unknown model 'Nope'");
  });

  it('status compte les documents par catégorie (--json)', async () => {
    await collection().insertMany([
      { name: 'old', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'current', __schemaVersion: CONTAINER_SCHEMA_V3 },
    ]);

    const { code, io } = await run(['status', 'Container', '--json']);
    expect(code).toBe(0);

    const [status] = JSON.parse(io.stdout.join('\n'));
    expect(status).toMatchObject({
      model: 'Container',
      currentVersion: CONTAINER_SCHEMA_V3,
      outdatedDocuments: 1,
      currentDocuments: 1,
    });
  });

  it('up Container migre les documents obsolètes', async () => {
    await collection().insertMany([
      { name: 'a', port: '80:80', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'b', port: '443:443', __schemaVersion: CONTAINER_SCHEMA_V2 },
    ]);

    const { code, io } = await run(['up', 'Container', '--json']);
    expect(code).toBe(0);

    const results = JSON.parse(io.stdout.join('\n'));
    expect(results.Container).toMatchObject({ matched: 2, migrated: 2, failed: 0 });

    const docs = await collection().find({}).toArray();
    expect(docs.every((d) => d.__schemaVersion === CONTAINER_SCHEMA_V3)).toBe(true);
  });

  it('up --all + --to est rejeté ; up sans cible est rejeté', async () => {
    const ambiguous = await run(['up', '--all', '--to', String(CONTAINER_SCHEMA_V2)]);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.io.stderr.join('\n')).toContain('--to cannot be combined with --all');

    const noTarget = await run(['up']);
    expect(noTarget.code).toBe(1);
    expect(noTarget.io.stderr.join('\n')).toContain('Specify a model name or --all');
  });

  it('up --dry-run ne modifie rien et le signale', async () => {
    await collection().insertOne({
      name: 'a',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    const { code, io } = await run(['up', 'Container', '--dry-run']);
    expect(code).toBe(0);
    expect(io.stdout.join('\n')).toContain('[dry-run] Container: matched 1, migrated 1');

    const doc = await collection().findOne({ name: 'a' });
    expect(doc?.__schemaVersion).toBe(CONTAINER_SCHEMA_V1);
  });

  it('dry-run --verbose détaille plan et changements', async () => {
    await collection().insertOne({
      name: 'a',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    const { code, io } = await run(['dry-run', 'Container', '--verbose']);
    expect(code).toBe(0);

    const output = io.stdout.join('\n');
    expect(output).toContain('1 document(s) would be migrated');
    expect(output).toContain('2 step(s)');
    expect(output).toContain('ports');
  });

  it('down Container --to rétrograde (allowDowngrade en config)', async () => {
    await collection().insertOne({
      name: 'a',
      ports: ['80:80'],
      network: { mode: 'bridge' },
      __schemaVersion: CONTAINER_SCHEMA_V3,
    });

    const { code } = await run([
      'down',
      'Container',
      '--to',
      String(CONTAINER_SCHEMA_V2),
      '--json',
    ]);
    expect(code).toBe(0);

    const doc = await collection().findOne({ name: 'a' });
    expect(doc?.__schemaVersion).toBe(CONTAINER_SCHEMA_V2);
    expect(doc?.network).toBeUndefined();
  });

  it('down sans --to est rejeté', async () => {
    const { code, io } = await run(['down', 'Container']);
    expect(code).toBe(1);
    expect(io.stderr.join('\n')).toContain('requires --to');
  });

  it('snapshots liste puis rollback restaure via --id/--step', async () => {
    const { insertedId } = await collection().insertOne({
      name: 'a',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });
    await run(['up', 'Container']);

    const listing = await run(['snapshots', 'Container', '--json']);
    expect(listing.code).toBe(0);
    const parsed = JSON.parse(listing.io.stdout.join('\n'));
    expect(parsed[0].snapshots.map((s: { stepKey: string }) => s.stepKey)).toContain(STEP_1_2);

    const rollback = await run([
      'rollback',
      'Container',
      '--id',
      String(insertedId),
      '--step',
      STEP_1_2,
    ]);
    expect(rollback.code).toBe(0);

    const doc = await collection().findOne({ _id: insertedId });
    expect(doc?.__schemaVersion).toBe(CONTAINER_SCHEMA_V1);
    expect(doc?.port).toBe('80:80');
  });

  it('abort nettoie les marqueurs failed', async () => {
    await collection().insertOne({
      name: 'broken',
      __schemaVersion: CONTAINER_SCHEMA_V1,
      __migrationState: { status: 'failed' },
    });

    const { code, io } = await run(['abort', 'Container', '--json']);
    expect(code).toBe(0);

    const result = JSON.parse(io.stdout.join('\n'));
    expect(result.Container.migrated).toBe(1);

    const doc = await collection().findOne({ name: 'broken' });
    expect(doc?.__migrationState).toBeUndefined();
  });

  it('abort --filter rejette un JSON invalide', async () => {
    const { code, io } = await run(['abort', 'Container', '--filter', '{bad json']);
    expect(code).toBe(1);
    expect(io.stderr.join('\n')).toContain('valid JSON');
  });

  it('cleanup-snapshots --older-than nettoie, --dry-run simule', async () => {
    await collection().insertOne({
      name: 'a',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });
    await run(['up', 'Container']);

    // Backdate every snapshot.
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await collection().updateMany({}, {
      $set: {
        [`__migrationSnapshots.${STEP_1_2}.migratedAt`]: old,
        [`__migrationSnapshots.${CONTAINER_SCHEMA_V2}_to_${CONTAINER_SCHEMA_V3}.migratedAt`]: old,
      },
    });

    const dryRun = await run([
      'cleanup-snapshots',
      'Container',
      '--older-than',
      '30d',
      '--dry-run',
      '--json',
    ]);
    expect(dryRun.code).toBe(0);
    expect(JSON.parse(dryRun.io.stdout.join('\n')).Container).toMatchObject({
      cleaned: 1,
      dryRun: true,
    });

    const real = await run(['cleanup-snapshots', 'Container', '--older-than', '30d']);
    expect(real.code).toBe(0);

    const doc = await collection().findOne({ name: 'a' });
    expect(doc?.__migrationSnapshots ?? {}).toEqual({});
  });

  it('signale les échecs de migration avec un code de sortie 1', async () => {
    const failingConfig = defineSchemigrateConfig({
      uri: getMongoUri(),
      models: [
        {
          name: 'Container',
          collection: COLLECTION,
          currentVersion: CONTAINER_SCHEMA_V2,
          migrations: [
            {
              from: CONTAINER_SCHEMA_V1,
              to: CONTAINER_SCHEMA_V2,
              up: async () => {
                throw new Error('kaboom');
              },
            },
          ],
        },
      ],
    });
    await collection().insertOne({ name: 'a', __schemaVersion: CONTAINER_SCHEMA_V1 });

    const io = createIO();
    const code = await runCli(['up', 'Container'], { config: failingConfig, io });

    expect(code).toBe(1);
    expect(io.stdout.join('\n')).toContain('failed 1');
    expect(io.stderr.join('\n')).toContain('kaboom');
  });
});
