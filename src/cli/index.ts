// CLI building blocks (SPEC §42). The executable entry point is bin.ts.
export { runCli } from './run-cli.js';
export type { CliIO, RunCliOverrides } from './run-cli.js';
export { defineSchemigrateConfig } from './define-config.js';
export type { SchemigrateCliConfig, SchemigrateCliModelConfig } from './define-config.js';
export { loadCliConfig, validateCliConfig, SchemigrateConfigError } from './load-config.js';
export { createCliRuntime } from './runtime.js';
export type { CliRuntime, CliModelEntry } from './runtime.js';
export { parseArgs } from './parse-args.js';
export type { ParsedArgs } from './parse-args.js';
