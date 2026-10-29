import { type Ctx, EXIT } from '../io';
import { requireCredentials } from '../session';

export async function whoami(ctx: Ctx): Promise<number> {
  const { login, orgs } = await requireCredentials(ctx);
  ctx.io.stdout(`${JSON.stringify({ login, orgs })}\n`);
  return EXIT.ok;
}
