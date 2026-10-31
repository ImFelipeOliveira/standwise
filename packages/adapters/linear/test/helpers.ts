import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');
}

export type Call = { url: URL; method: string; headers: Headers; body: string };
export type Reply = { status?: number; body?: string; headers?: Record<string, string> };

export function fakeFetch(reply: Reply | ((call: Call) => Reply)) {
  const calls: Call[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url: new URL(String(input)),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ''),
    };
    calls.push(call);
    const r = typeof reply === 'function' ? reply(call) : reply;
    return new Response(r.body ?? '{}', {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  };
  return { fetch: impl as typeof fetch, calls };
}

export function hangingFetch() {
  const state = { aborted: 0 };
  const impl = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        state.aborted++;
        reject(init.signal?.reason);
      });
    });
  return {
    fetch: impl as typeof fetch,
    get aborted() {
      return state.aborted;
    },
  };
}
