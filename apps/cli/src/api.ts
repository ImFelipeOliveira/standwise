import type { DailyConfirmation, DailySubmission } from '@standwise/core';

declare const STANDWISE_DEFAULT_API_URL: string | undefined;

export const FALLBACK_API_URL = 'https://api.standwise.dev';

export const resolveDefaultApiUrl = (injected: string | undefined): string =>
  injected || FALLBACK_API_URL;

export const DEFAULT_API_URL = resolveDefaultApiUrl(
  typeof STANDWISE_DEFAULT_API_URL === 'string' ? STANDWISE_DEFAULT_API_URL : undefined,
);

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
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/+$/, '')}${path}`, {
      method: options.method ?? 'GET',
      redirect: 'error',
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

export const postDaily = (
  apiUrl: string,
  token: string,
  daily: DailySubmission,
  confirmation?: DailyConfirmation,
) =>
  request<unknown>(apiUrl, '/v1/dailies', {
    method: 'POST',
    token,
    body: daily,
    headers: confirmation ? { 'x-standwise-confirmation': confirmation } : {},
  });

export type SuggestionDecision = 'confirmed' | 'ignored';

export const decideSuggestion = (
  apiUrl: string,
  token: string,
  org: string,
  id: string,
  decision: SuggestionDecision,
) =>
  request<unknown>(apiUrl, `/v1/suggestions/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    token,
    body: { org, decision },
  });

export type Today = { org: string; date: string; teams: string[] };

export const getToday = (apiUrl: string, token: string, org: string) =>
  request<Today>(apiUrl, `/v1/today?org=${encodeURIComponent(org)}`, { token });

export const revokeSession = (apiUrl: string, token: string) =>
  request<unknown>(apiUrl, '/v1/sessions/current', { method: 'DELETE', token });

export type ManageResource = 'teams' | 'digests' | 'dailies' | 'blockers';

export function getManage(
  apiUrl: string,
  token: string,
  resource: ManageResource,
  query: Record<string, string | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value);
  }
  return request<unknown>(apiUrl, `/v1/manage/${resource}?${params}`, { token });
}
