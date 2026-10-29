import type { DailySubmission } from '@standwise/core';

export const DEFAULT_API_URL = 'https://api.standwise.dev';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export class NetworkError extends Error {
  constructor(readonly url: string) {
    super(url);
  }
}

export type Org = { installationId: number; login: string };
export type Meta = { githubClientId: string; supportEmail: string };
export type Session = { token: string; login: string; orgs: Org[] };

async function request<T>(
  apiUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/+$/, '')}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new NetworkError(apiUrl);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return payload as T;
  const envelope = (payload as { error?: { code?: string; message?: string } } | null)?.error;
  const retry = Number(response.headers.get('retry-after'));
  throw new ApiError(
    response.status,
    envelope?.code ?? 'http_error',
    envelope?.message ?? `HTTP ${response.status}`,
    Number.isFinite(retry) && retry > 0 ? retry : undefined,
  );
}

export const getMeta = (apiUrl: string) => request<Meta>(apiUrl, '/v1/meta');

export const createSession = (apiUrl: string, githubToken: string) =>
  request<Session>(apiUrl, '/v1/sessions', { method: 'POST', body: { githubToken } });

export const getDraft = (apiUrl: string, token: string, org: string) =>
  request<unknown>(apiUrl, `/v1/draft?org=${encodeURIComponent(org)}`, { token });

export const postDaily = (apiUrl: string, token: string, daily: DailySubmission) =>
  request<unknown>(apiUrl, '/v1/dailies', { method: 'POST', token, body: daily });

export const revokeSession = (apiUrl: string, token: string) =>
  request<unknown>(apiUrl, '/v1/sessions/current', { method: 'DELETE', token });
