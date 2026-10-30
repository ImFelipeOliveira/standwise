import { parseArgs } from 'node:util';
import { stripUnsafeChars, t } from '@standwise/core';
import pkg from '../../../package.json';
import { ApiError, NetworkError } from './api';
import { draft } from './commands/draft';
import { login } from './commands/login';
import { logout } from './commands/logout';
import { mcp } from './commands/mcp';
import { submit } from './commands/submit';
import { whoami } from './commands/whoami';
import { type Ctx, EXIT, ExitError, type Io } from './io';
import { cliLanguage } from './language';

const OPTIONS = {
  help: { type: 'boolean' },
  version: { type: 'boolean' },
  org: { type: 'string' },
  file: { type: 'string' },
  'api-url': { type: 'string' },
} as const;

const COMMANDS: Record<string, (ctx: Ctx) => Promise<number>> = {
  login,
  logout,
  whoami,
  draft,
  submit,
  mcp,
};

function apiErrorLine(ctx: Ctx, error: ApiError): string {
  const wait =
    error.retryAfter === undefined
      ? ''
      : ` (${t(ctx.lang, 'cli.retryAfter', { seconds: error.retryAfter })})`;
  return `error ${error.code}: ${error.message}${wait}`;
}

export async function run(argv: string[], io: Io): Promise<number> {
  const lang = cliLanguage(io.env);
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    io.stderr(`${t(lang, 'cli.invalidArgs', { message: (error as Error).message })}\n`);
    return EXIT.error;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    io.stdout(`${pkg.version}\n`);
    return EXIT.ok;
  }
  const [name] = positionals;
  if (values.help || name === undefined) {
    io.stdout(`${t(lang, 'cli.usage')}\n`);
    return EXIT.ok;
  }
  const command = COMMANDS[name];
  if (!command) {
    io.stderr(`${t(lang, 'cli.unknownCommand', { command: name })}\n`);
    return EXIT.error;
  }
  const ctx: Ctx = {
    io,
    lang,
    flags: { org: values.org, file: values.file, apiUrl: values['api-url'] },
  };
  try {
    return await command(ctx);
  } catch (error) {
    if (error instanceof ExitError) {
      io.stderr(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof ApiError) {
      io.stderr(`${apiErrorLine(ctx, error)}\n`);
      return error.status === 401 ? EXIT.unauthenticated : EXIT.error;
    }
    if (error instanceof NetworkError) {
      io.stderr(`${t(lang, 'cli.networkError', { url: stripUnsafeChars(error.url) })}\n`);
      return EXIT.error;
    }
    throw error;
  }
}
