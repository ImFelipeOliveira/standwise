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
    throw new ExitError(EXIT.error, t(lang, 'cli.insecureUrl', { url: stripControl(url) }));
  }
  const safe =
    parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalHost(parsed.hostname));
  if (!safe)
    throw new ExitError(EXIT.error, t(lang, 'cli.insecureUrl', { url: stripControl(url) }));
  return parsed;
}

export function stripControl(text: string): string {
  return Array.from(text)
    .filter((char) => {
      const code = char.charCodeAt(0);
      const control = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
      const bidi = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
      return !control && !bidi;
    })
    .join('');
}
