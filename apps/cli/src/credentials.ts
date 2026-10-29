import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const CredentialsSchema = z.object({
  apiUrl: z.string(),
  token: z.string(),
  login: z.string(),
  orgs: z.array(z.object({ installationId: z.number(), login: z.string() })),
});

export type Credentials = z.infer<typeof CredentialsSchema>;
type Env = Record<string, string | undefined>;

export function credentialsPath(env: Env): string {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || '.', '.config');
  return join(base, 'standwise', 'credentials.json');
}

export async function readCredentials(env: Env): Promise<Credentials | null> {
  try {
    const parsed = CredentialsSchema.safeParse(
      JSON.parse(await readFile(credentialsPath(env), 'utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeCredentials(env: Env, credentials: Credentials): Promise<void> {
  const path = credentialsPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

export async function deleteCredentials(env: Env): Promise<boolean> {
  const path = credentialsPath(env);
  const existed = await Bun.file(path).exists();
  await rm(path, { force: true });
  return existed;
}
