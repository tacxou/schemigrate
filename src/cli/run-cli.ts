import { SchemigrateError } from '../errors/index.js';
import { getPath } from '../utils/object-paths.js';
import type {
  MigrationSnapshotEntry,
  SchemigrateBatchOptions,
  SchemigrateBatchResult,
} from '../types.js';
import type { SchemigrateCliConfig } from './define-config.js';
import { loadCliConfig } from './load-config.js';
import { flagAsNumber, flagAsString, parseArgs, type ParsedArgs } from './parse-args.js';
import { createCliRuntime, type CliModelEntry, type CliRuntime } from './runtime.js';

export type CliIO = {
  out: (line: string) => void;
  err: (line: string) => void;
};

export type RunCliOverrides = {
  /** Inject a config directly (tests, embedding) instead of loading a file. */
  config?: SchemigrateCliConfig;
  io?: CliIO;
  cwd?: string;
};

const USAGE = `Usage: schemigrate <command> [Model] [options]

Commands:
  status [Model]                        Inspect migration state per model
  up [Model|--all] [--to <v>]           Migrate outdated documents upward
  down <Model> --to <v> [--id <id>]     Explicit downgrade (requires allowDowngrade)
  dry-run [Model|--all] [--to <v>]      Preview migrations without writing
  rollback <Model> --id <id> --step <k> Restore one step from its snapshot
  abort <Model> [--id <id>] [--filter <json>]  Clear failed migration markers
  snapshots <Model> [--id <id>]         List stored migration snapshots
  cleanup-snapshots <Model> [--older-than <d>] [--step <k>] [--dry-run]
  help                                  Show this help

Options:
  --config <path>   Config file (default: schemigrate.config.{ts,mjs,js,cjs})
  --uri <uri>       MongoDB URI (overrides the config)
  --batch-size <n>  Batch size for up/down (default: 100)
  --json            Machine-readable JSON output
  --verbose         More detail where available`;

export async function runCli(argv: string[], overrides: RunCliOverrides = {}): Promise<number> {
  const io: CliIO = overrides.io ?? {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };

  const parsed = parseArgs(argv);

  if (!parsed.command || parsed.command === 'help' || parsed.flags.help === true) {
    io.out(USAGE);
    return parsed.command || parsed.flags.help ? 0 : 1;
  }

  let runtime: CliRuntime | undefined;
  try {
    const config =
      overrides.config ??
      (await loadCliConfig(overrides.cwd ?? process.cwd(), flagAsString(parsed.flags, 'config')));

    runtime = await createCliRuntime(config, flagAsString(parsed.flags, 'uri'));

    switch (parsed.command) {
      case 'status':
        return await commandStatus(runtime, parsed, io);
      case 'up':
        return await commandUp(runtime, parsed, io);
      case 'down':
        return await commandDown(runtime, parsed, io);
      case 'dry-run':
        return await commandDryRun(runtime, parsed, io);
      case 'rollback':
        return await commandRollback(runtime, parsed, io);
      case 'abort':
        return await commandAbort(runtime, parsed, io);
      case 'snapshots':
        return await commandSnapshots(runtime, parsed, io);
      case 'cleanup-snapshots':
        return await commandCleanupSnapshots(runtime, parsed, io);
      default:
        io.err(`Unknown command '${parsed.command}'.`);
        io.out(USAGE);
        return 1;
    }
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await runtime?.close();
  }
}

// --- helpers ---------------------------------------------------------------

function resolveTargets(runtime: CliRuntime, parsed: ParsedArgs): CliModelEntry[] {
  if (parsed.model) return [runtime.getEntry(parsed.model)];
  if (parsed.flags.all === true) return [...runtime.entries.values()];
  throw new SchemigrateError('Specify a model name or --all.');
}

function requireModel(runtime: CliRuntime, parsed: ParsedArgs): CliModelEntry {
  if (!parsed.model) {
    throw new SchemigrateError(`'${parsed.command}' requires a model name.`);
  }
  return runtime.getEntry(parsed.model);
}

function batchOptionsFrom(parsed: ParsedArgs): SchemigrateBatchOptions {
  return {
    batchSize: flagAsNumber(parsed.flags, 'batch-size'),
    dryRun: parsed.flags['dry-run'] === true,
    continueOnError: true,
  };
}

function printBatchResult(
  io: CliIO,
  name: string,
  result: SchemigrateBatchResult,
  dryRun: boolean,
): void {
  const prefix = dryRun ? '[dry-run] ' : '';
  io.out(
    `${prefix}${name}: matched ${result.matched}, migrated ${result.migrated}, ` +
      `skipped ${result.skipped}, failed ${result.failed}`,
  );
  for (const error of result.errors) {
    const cause = (error as { cause?: unknown }).cause;
    io.err(`  - ${error.message}${cause instanceof Error ? ` Cause: ${cause.message}` : ''}`);
  }
}

function emitJson(io: CliIO, payload: unknown): void {
  io.out(JSON.stringify(payload, null, 2));
}

// --- commands ---------------------------------------------------------------

async function commandStatus(runtime: CliRuntime, parsed: ParsedArgs, io: CliIO): Promise<number> {
  const targets = parsed.model ? [runtime.getEntry(parsed.model)] : [...runtime.entries.values()];
  const statuses = [];

  for (const entry of targets) {
    statuses.push(await entry.model.getMigrationStatus());
  }

  if (parsed.flags.json === true) {
    emitJson(io, statuses);
    return 0;
  }

  for (const status of statuses) {
    io.out(`${status.model}`);
    io.out(`  currentVersion:      ${status.currentVersion}`);
    io.out(`  outdatedDocuments:   ${status.outdatedDocuments}`);
    io.out(`  currentDocuments:    ${status.currentDocuments}`);
    io.out(`  newerDocuments:      ${status.newerDocuments}`);
    io.out(`  failedDocuments:     ${status.failedDocuments}`);
    io.out(`  inProgressDocuments: ${status.inProgressDocuments}`);
  }
  return 0;
}

async function commandUp(runtime: CliRuntime, parsed: ParsedArgs, io: CliIO): Promise<number> {
  const to = flagAsNumber(parsed.flags, 'to');
  if (to !== undefined && parsed.flags.all === true) {
    throw new SchemigrateError('--to cannot be combined with --all (versions are per-model).');
  }

  const targets = resolveTargets(runtime, parsed);
  const options = batchOptionsFrom(parsed);
  const results: Record<string, SchemigrateBatchResult> = {};
  let failed = 0;

  for (const entry of targets) {
    const versionPath = entry.config.versionPath ?? '__schemaVersion';
    const result =
      to === undefined
        ? await entry.model.syncToCurrentVersion(options)
        : await entry.model.migrateMany({ [versionPath]: { $lt: to } }, to, options);
    results[entry.config.name] = result;
    failed += result.failed;
  }

  if (parsed.flags.json === true) {
    emitJson(io, results);
  } else {
    for (const [name, result] of Object.entries(results)) {
      printBatchResult(io, name, result, options.dryRun === true);
    }
  }
  return failed > 0 ? 1 : 0;
}

async function commandDown(runtime: CliRuntime, parsed: ParsedArgs, io: CliIO): Promise<number> {
  const entry = requireModel(runtime, parsed);
  const to = flagAsNumber(parsed.flags, 'to');
  if (to === undefined) {
    throw new SchemigrateError("'down' requires --to <version>.");
  }

  const id = flagAsString(parsed.flags, 'id');
  const versionPath = entry.config.versionPath ?? '__schemaVersion';

  if (id !== undefined) {
    await entry.model.migrateById(id, to, { dryRun: parsed.flags['dry-run'] === true });
    if (parsed.flags.json === true) {
      emitJson(io, { model: entry.config.name, documentId: id, downgradedTo: to });
    } else {
      io.out(`${entry.config.name}: document ${id} downgraded to ${to}`);
    }
    return 0;
  }

  const result = await entry.model.migrateMany(
    { [versionPath]: { $gt: to } },
    to,
    batchOptionsFrom(parsed),
  );

  if (parsed.flags.json === true) {
    emitJson(io, { [entry.config.name]: result });
  } else {
    printBatchResult(io, entry.config.name, result, parsed.flags['dry-run'] === true);
  }
  return result.failed > 0 ? 1 : 0;
}

async function commandDryRun(runtime: CliRuntime, parsed: ParsedArgs, io: CliIO): Promise<number> {
  const to = flagAsNumber(parsed.flags, 'to');
  if (to !== undefined && parsed.flags.all === true) {
    throw new SchemigrateError('--to cannot be combined with --all (versions are per-model).');
  }

  const targets = resolveTargets(runtime, parsed);
  const reports: Record<string, unknown[]> = {};

  for (const entry of targets) {
    const versionPath = entry.config.versionPath ?? '__schemaVersion';
    const target = to ?? entry.config.currentVersion;
    reports[entry.config.name] = await entry.model.dryRun(
      { [versionPath]: { $lt: target } },
      target,
    );
  }

  if (parsed.flags.json === true) {
    emitJson(io, reports);
    return 0;
  }

  for (const [name, results] of Object.entries(reports)) {
    io.out(`[dry-run] ${name}: ${results.length} document(s) would be migrated`);
    if (parsed.flags.verbose === true) {
      for (const result of results as Array<{
        documentId?: string;
        fromVersion: number;
        targetVersion: number;
        plan: Array<{ from: number; to: number }>;
        changesPreview: Record<string, unknown>;
      }>) {
        io.out(
          `  - ${result.documentId ?? '?'}: ${result.fromVersion} -> ${result.targetVersion} ` +
            `(${result.plan.length} step(s), changes: ${Object.keys(result.changesPreview).join(', ') || 'none'})`,
        );
      }
    }
  }
  return 0;
}

async function commandRollback(runtime: CliRuntime, parsed: ParsedArgs, io: CliIO): Promise<number> {
  const entry = requireModel(runtime, parsed);
  const id = flagAsString(parsed.flags, 'id');
  const step = flagAsString(parsed.flags, 'step');
  if (id === undefined || step === undefined) {
    throw new SchemigrateError("'rollback' requires --id <documentId> and --step <stepKey>.");
  }

  await entry.model.rollbackMigrationById(id, step, {
    keepSnapshot: parsed.flags['keep-snapshot'] === true,
    dryRun: parsed.flags['dry-run'] === true,
  });

  if (parsed.flags.json === true) {
    emitJson(io, { model: entry.config.name, documentId: id, rolledBackStep: step });
  } else {
    io.out(`${entry.config.name}: document ${id} rolled back (step ${step})`);
  }
  return 0;
}

async function commandAbort(runtime: CliRuntime, parsed: ParsedArgs, io: CliIO): Promise<number> {
  const entry = requireModel(runtime, parsed);
  const id = flagAsString(parsed.flags, 'id');

  if (id !== undefined) {
    await entry.model.abortMigrationById(id);
    if (parsed.flags.json === true) {
      emitJson(io, { model: entry.config.name, documentId: id, aborted: true });
    } else {
      io.out(`${entry.config.name}: migration state cleared on document ${id}`);
    }
    return 0;
  }

  const rawFilter = flagAsString(parsed.flags, 'filter');
  let filter: Record<string, unknown> = {};
  if (rawFilter !== undefined) {
    try {
      filter = JSON.parse(rawFilter) as Record<string, unknown>;
    } catch {
      throw new SchemigrateError(`--filter expects valid JSON (got '${rawFilter}').`);
    }
  }

  const result = await entry.model.abortMigrationMany(filter);
  if (parsed.flags.json === true) {
    emitJson(io, { [entry.config.name]: result });
  } else {
    io.out(
      `${entry.config.name}: ${result.migrated} migration state(s) cleared ` +
        `(matched ${result.matched})`,
    );
  }
  return 0;
}

async function commandSnapshots(runtime: CliRuntime, parsed: ParsedArgs, io: CliIO): Promise<number> {
  const entry = requireModel(runtime, parsed);
  const snapshotsPath = entry.config.snapshotsPath ?? '__migrationSnapshots';
  const id = flagAsString(parsed.flags, 'id');

  const filter: Record<string, unknown> = {
    [snapshotsPath]: { $exists: true, $ne: null },
  };
  if (id !== undefined) filter._id = id;

  const docs = await entry.model
    .find(filter)
    .setOptions({ schemigrateCheck: false })
    .lean<Record<string, unknown>[]>()
    .exec();

  const listing = docs.map((doc) => {
    const snapshots = (getPath(doc, snapshotsPath) ?? {}) as Record<string, MigrationSnapshotEntry>;
    return {
      documentId: String(doc._id),
      snapshots: Object.entries(snapshots).map(([stepKey, snap]) => ({
        stepKey,
        direction: snap.direction,
        fromVersion: snap.fromVersion,
        toVersion: snap.toVersion,
        migratedAt: snap.migratedAt,
        fields: Object.keys(snap.data ?? {}),
      })),
    };
  });

  if (parsed.flags.json === true) {
    emitJson(io, listing);
    return 0;
  }

  if (listing.length === 0) {
    io.out(`${entry.config.name}: no migration snapshots`);
    return 0;
  }
  for (const docListing of listing) {
    io.out(`${entry.config.name} ${docListing.documentId}`);
    for (const snap of docListing.snapshots) {
      io.out(
        `  ${snap.stepKey} [${snap.direction}] at ${snap.migratedAt} ` +
          `(fields: ${snap.fields.join(', ') || 'none'})`,
      );
    }
  }
  return 0;
}

async function commandCleanupSnapshots(
  runtime: CliRuntime,
  parsed: ParsedArgs,
  io: CliIO,
): Promise<number> {
  const entry = requireModel(runtime, parsed);
  const direction = flagAsString(parsed.flags, 'direction');
  if (direction !== undefined && direction !== 'up' && direction !== 'down') {
    throw new SchemigrateError("--direction expects 'up' or 'down'.");
  }

  const result = await entry.model.cleanupMigrationSnapshots(
    {},
    {
      stepKey: flagAsString(parsed.flags, 'step'),
      olderThan: flagAsString(parsed.flags, 'older-than'),
      direction,
      dryRun: parsed.flags['dry-run'] === true,
    },
  );

  if (parsed.flags.json === true) {
    emitJson(io, { [entry.config.name]: result });
  } else {
    const prefix = result.dryRun ? '[dry-run] ' : '';
    io.out(
      `${prefix}${entry.config.name}: ${result.cleaned} document(s) cleaned, ` +
        `${result.skipped} skipped (matched ${result.matched})`,
    );
  }
  return 0;
}
