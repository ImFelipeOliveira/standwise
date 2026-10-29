import { describe, expect, test } from 'bun:test';
import { chmod, mkdir, readdir, rm, stat } from 'node:fs/promises';
import {
  credentialsPath,
  deleteCredentials,
  readCredentials,
  writeCredentials,
} from '../src/credentials';
import { makeIo } from './support';

const creds = { apiUrl: 'http://x', token: 'sw_secret', login: 'alice', orgs: [] };

describe('credentials', () => {
  test('writes with 0600 in a 0700 directory and reads back', async () => {
    const { io } = await makeIo();
    await writeCredentials(io.env, creds);
    const path = credentialsPath(io.env);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(path.replace(/\/credentials\.json$/, ''))).mode & 0o777).toBe(0o700);
    expect(await readCredentials(io.env)).toEqual(creds);
  });

  test('tightens an existing directory and leaves no temp file on failure', async () => {
    const { io } = await makeIo();
    const path = credentialsPath(io.env);
    const dir = path.replace(/\/credentials\.json$/, '');
    await mkdir(dir, { recursive: true });
    await chmod(dir, 0o755);
    await writeCredentials(io.env, creds);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    await rm(path);
    await mkdir(path);
    await expect(writeCredentials(io.env, creds)).rejects.toThrow();
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  test('defaults to ~/.config/standwise', () => {
    expect(credentialsPath({ HOME: '/home/a' })).toBe('/home/a/.config/standwise/credentials.json');
  });

  test('read returns null when missing or malformed, delete reports removal', async () => {
    const { io } = await makeIo();
    expect(await readCredentials(io.env)).toBeNull();
    expect(await deleteCredentials(io.env)).toBe(false);
    await writeCredentials(io.env, creds);
    expect(await deleteCredentials(io.env)).toBe(true);
    expect(await readCredentials(io.env)).toBeNull();
  });
});
