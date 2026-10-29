import { type Language, t } from '@standwise/core';
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
    throw new ExitError(EXIT.error, t(lang, 'cli.insecureUrl', { url }));
  }
  const safe =
    parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalHost(parsed.hostname));
  if (!safe) throw new ExitError(EXIT.error, t(lang, 'cli.insecureUrl', { url }));
  return parsed;
}

export function stripControl(text: string): string {
  return Array.from(text)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x1f && (code < 0x7f || code > 0x9f);
    })
    .join('');
}
