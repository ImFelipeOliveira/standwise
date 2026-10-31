import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Octokit } from '@octokit/core';

export function fixture(name: string): string {
  return readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');
}

export type Call = { method: string; url: URL; headers: Headers };
type Reply = { status?: number; body?: string; headers?: Record<string, string> };
export type Route = Reply | ((url: URL) => Reply);

export function fakeFetch(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request ? request.url : String(input));
    const method = (request?.method ?? init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, headers: new Headers(request?.headers ?? init?.headers) });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    const resolved = typeof route === 'function' ? route(url) : route;
    return new Response(resolved.body ?? '{}', {
      status: resolved.status ?? 200,
      headers: { 'content-type': 'application/json', ...resolved.headers },
    });
  };
  return { fetch: impl as typeof fetch, calls };
}

export function octokitWith(routes: Record<string, Route>) {
  const fake = fakeFetch(routes);
  return { octokit: new Octokit({ request: { fetch: fake.fetch } }), calls: fake.calls };
}
