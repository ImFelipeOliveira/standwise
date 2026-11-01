import { describe, expect, test } from 'bun:test';
import { createTestApp } from './support';

describe('llms.txt', () => {
  test('is plain text that links the machine-readable docs', async () => {
    const { app } = createTestApp();
    const res = await app.request('/llms.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('https://sw.test/openapi.json');
    expect(text).toContain('https://sw.test/reference');
    expect(text).toContain('https://docs.sw.test/llms.txt');
    expect(text).toContain('https://docs.sw.test/llms-full.txt');
    expect(text).toContain('https://docs.sw.test/api/overview.md');
    expect(text).toContain('https://docs.sw.test/api/webhooks.md');
  });

  test('is not part of the public openapi document', async () => {
    const { app } = createTestApp();
    const doc = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(doc.paths)).not.toContain('/llms.txt');
  });
});
