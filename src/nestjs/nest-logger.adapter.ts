import { Logger, type LoggerService } from '@nestjs/common';
import type { SchemigrateLogger } from '../types.js';
import type { SchemigrateModuleOptions } from './schemigrate.interfaces.js';

function isSchemigrateLogger(value: object): value is SchemigrateLogger {
  const candidate = value as SchemigrateLogger & LoggerService;
  return typeof candidate.log !== 'function' && (
    typeof candidate.info === 'function' ||
    typeof candidate.debug === 'function' ||
    typeof candidate.warn === 'function' ||
    typeof candidate.error === 'function'
  );
}

/** Adapts a NestJS LoggerService to the core SchemigrateLogger contract. */
export function adaptNestLogger(logger: LoggerService): SchemigrateLogger {
  return {
    debug: (message, meta) =>
      meta === undefined ? logger.debug?.(message) : logger.debug?.(message, meta),
    info: (message, meta) =>
      meta === undefined ? logger.log(message) : logger.log(message, meta),
    warn: (message, meta) =>
      meta === undefined ? logger.warn(message) : logger.warn(message, meta),
    error: (message, meta) =>
      meta === undefined ? logger.error(message) : logger.error(message, meta),
  };
}

/** Resolves the `logger` module option into a core SchemigrateLogger (SPEC §38). */
export function resolveModuleLogger(
  option: SchemigrateModuleOptions['logger'],
): SchemigrateLogger | undefined {
  if (option === undefined || option === false) return undefined;
  if (option === true) return adaptNestLogger(new Logger('Schemigrate'));
  if (typeof option === 'object' && option !== null) {
    if (isSchemigrateLogger(option)) return option;
    return adaptNestLogger(option as LoggerService);
  }
  return undefined;
}
