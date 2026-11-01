import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Io } from '../src/io';

export type Captured = { io: Io; out: string[]; err: string[]; sleeps: number[]; opened: string[] };

export async function makeIo(
  env: Record<string, string | undefined> = {},
  stdin = '',
): Promise<Captured & { home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'standcast-cli-'));
  const out: string[] = [];
  const err: string[] = [];
  const sleeps: number[] = [];
  const opened: string[] = [];
  const io: Io = {
    env: { XDG_CONFIG_HOME: home, STANDCAST_LANG: 'en', ...env },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    readStdin: async () => stdin,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    openBrowser: (url) => {
      opened.push(url);
    },
  };
  return { io, out, err, sleeps, opened, home };
}
