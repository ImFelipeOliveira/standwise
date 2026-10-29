import { t } from '@standwise/core';
import { deleteCredentials } from '../credentials';
import { type Ctx, EXIT } from '../io';

export async function logout({ io, lang }: Ctx): Promise<number> {
  await deleteCredentials(io.env);
  io.stderr(`${t(lang, 'cli.loggedOut')}\n`);
  return EXIT.ok;
}
