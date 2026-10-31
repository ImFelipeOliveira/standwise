import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(INLINE_SCRIPT)].map(
    (match) =>
      `'sha256-${createHash('sha256')
        .update(match[1] ?? '')
        .digest('base64')}'`,
  );
}

export function siteCsp(hashes: string[]): string {
  return [
    "default-src 'none'",
    ["script-src 'self'", ...hashes].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function headersFile(hashes: string[]): string {
  return [
    '/*',
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Frame-Options: DENY',
    `  Content-Security-Policy: ${siteCsp(hashes)}`,
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n');
}

export async function writeSiteHeaders(outDir: string): Promise<void> {
  const entries = await readdir(outDir, { recursive: true });
  const hashes = new Set<string>();
  for (const entry of entries.filter((e) => e.endsWith('.html')).sort()) {
    for (const hash of inlineScriptHashes(await readFile(join(outDir, entry), 'utf8'))) {
      hashes.add(hash);
    }
  }
  await writeFile(join(outDir, '_headers'), headersFile([...hashes].sort()));
}
