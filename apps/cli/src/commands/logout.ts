import { t } from '@standwise/core';
import { revokeSession } from '../api';
import { deleteCredentials, readCredentials } from '../credentials';
import { type Ctx, EXIT } from '../io';
import { assertSafeUrl } from '../url';

export async function logout({ io, lang }: Ctx): Promise<number> {
  const credentials = await readCredentials(io.env);
  if (credentials) {
    try {
      assertSafeUrl(credentials.apiUrl, lang);
      await revokeSession(credentials.apiUrl, credentials.token);
    } catch {}
  }
  await deleteCredentials(io.env);
  io.stderr(`${t(lang, 'cli.loggedOut')}\n`);
  return EXIT.ok;
}
