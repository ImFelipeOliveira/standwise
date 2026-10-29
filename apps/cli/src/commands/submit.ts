import { readFile } from 'node:fs/promises';
import { DailySubmissionSchema, t } from '@standwise/core';
import { postDaily } from '../api';
import { type Ctx, EXIT, ExitError } from '../io';
import { apiUrlFor, requireCredentials, resolveOrg } from '../session';

async function readInput(ctx: Ctx): Promise<string> {
  if (!ctx.flags.file) return ctx.io.readStdin();
  try {
    return await readFile(ctx.flags.file, 'utf8');
  } catch {
    throw new ExitError(EXIT.error, t(ctx.lang, 'cli.fileReadFailed', { path: ctx.flags.file }));
  }
}

function parseDaily(ctx: Ctx, raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {}
  throw new ExitError(EXIT.invalid, t(ctx.lang, 'cli.invalidJson'));
}

export async function submit(ctx: Ctx): Promise<number> {
  const credentials = await requireCredentials(ctx);
  const input = parseDaily(ctx, await readInput(ctx));
  if (input.org === undefined) input.org = resolveOrg(ctx, credentials);
  const parsed = DailySubmissionSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ExitError(EXIT.invalid, `${t(ctx.lang, 'cli.validationFailed')}\n${issues}`);
  }
  const result = await postDaily(apiUrlFor(ctx, credentials), credentials.token, parsed.data);
  ctx.io.stdout(`${JSON.stringify(result)}\n`);
  return EXIT.ok;
}
