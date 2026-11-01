import type { Language } from '@standcast/core';

export type Io = {
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  openBrowser: (url: string) => void;
};

export type Flags = { org?: string; file?: string; apiUrl?: string };

export type Ctx = { io: Io; lang: Language; flags: Flags; args?: string[] };

export const EXIT = { ok: 0, error: 1, unauthenticated: 2, ambiguousOrg: 3, invalid: 4 } as const;

export class ExitError extends Error {
  constructor(
    readonly exitCode: number,
    message: string,
  ) {
    super(message);
  }
}
