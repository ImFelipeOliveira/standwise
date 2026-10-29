import { getDraft } from '../api';
import { type Ctx, EXIT } from '../io';
import { apiUrlFor, requireCredentials, resolveOrg } from '../session';

export async function draft(ctx: Ctx): Promise<number> {
  const credentials = await requireCredentials(ctx);
  const org = resolveOrg(ctx, credentials);
  const result = await getDraft(apiUrlFor(ctx, credentials), credentials.token, org);
  ctx.io.stdout(`${JSON.stringify(result)}\n`);
  return EXIT.ok;
}
