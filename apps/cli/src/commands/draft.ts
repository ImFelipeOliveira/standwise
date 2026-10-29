import { getDraft } from '../api';
import { type Ctx, EXIT } from '../io';
import { requireBoundCredentials, resolveOrg } from '../session';

export async function draft(ctx: Ctx): Promise<number> {
  const { credentials, apiUrl } = await requireBoundCredentials(ctx);
  const org = resolveOrg(ctx, credentials);
  const result = await getDraft(apiUrl, credentials.token, org);
  ctx.io.stdout(`${JSON.stringify(result)}\n`);
  return EXIT.ok;
}
