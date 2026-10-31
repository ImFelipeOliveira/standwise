import { t } from '@standwise/core';
import { decideSuggestion, type SuggestionDecision } from '../api';
import { type Ctx, EXIT, ExitError } from '../io';
import { requireBoundCredentials, resolveOrg } from '../session';

const DECISIONS: Record<string, SuggestionDecision> = {
  confirm: 'confirmed',
  ignore: 'ignored',
};

export async function suggestion(ctx: Ctx): Promise<number> {
  const [action, id, ...rest] = ctx.args ?? [];
  const decision = action === undefined ? undefined : DECISIONS[action];
  if (!decision || !id || rest.length > 0) {
    throw new ExitError(EXIT.error, t(ctx.lang, 'cli.suggestionUsage'));
  }
  const { credentials, apiUrl } = await requireBoundCredentials(ctx);
  const org = resolveOrg(ctx, credentials);
  await decideSuggestion(apiUrl, credentials.token, org, id, decision);
  ctx.io.stdout(`${JSON.stringify({ id, decision })}\n`);
  return EXIT.ok;
}
