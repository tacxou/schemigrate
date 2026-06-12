export type ParsedArgs = {
  command?: string;
  model?: string;
  flags: Record<string, string | boolean>;
};

const BOOLEAN_FLAGS = new Set(['all', 'dry-run', 'verbose', 'json', 'help', 'keep-snapshot']);

/**
 * Minimal argv parser: `schemigrate <command> [Model] [--flag[=value]]`.
 * Boolean flags never consume the next token; value flags accept both
 * `--to 123` and `--to=123`.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { flags: {} };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    const eq = body.indexOf('=');

    if (eq !== -1) {
      parsed.flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }

    if (BOOLEAN_FLAGS.has(body)) {
      parsed.flags[body] = true;
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      parsed.flags[body] = next;
      i++;
    } else {
      parsed.flags[body] = true;
    }
  }

  parsed.command = positionals[0];
  parsed.model = positionals[1];
  return parsed;
}

export function flagAsNumber(
  flags: ParsedArgs['flags'],
  name: string,
): number | undefined {
  const value = flags[name];
  if (value === undefined || value === true) return undefined;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`--${name} expects a number (got '${String(value)}').`);
  }
  return parsed;
}

export function flagAsString(
  flags: ParsedArgs['flags'],
  name: string,
): string | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new TypeError(`--${name} expects a value.`);
  }
  return value;
}
