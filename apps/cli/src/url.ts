import { type Language, stripUnsafeChars, t } from '@standcast/core';
import { EXIT, ExitError } from './io';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname);
}

export function assertSafeUrl(url: string, lang: Language): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ExitError(EXIT.error, t(lang, 'cli.insecureUrl', { url: stripUnsafeChars(url) }));
  }
  const safe =
    parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalHost(parsed.hostname));
  if (!safe)
    throw new ExitError(EXIT.error, t(lang, 'cli.insecureUrl', { url: stripUnsafeChars(url) }));
  return parsed;
}
