import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Hono } from 'hono';
import { onError } from '../src/http/errors';

const SECRET_TEXT = 'my private daily text 8c1f';

let logged: unknown[][] = [];

beforeEach(() => {
  logged = [];
  spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
});

afterEach(() => {
  (console.error as unknown as { mockRestore: () => void }).mockRestore();
});

describe('unhandled api errors', () => {
  test('are logged without drizzle params or daily text', async () => {
    const app = new Hono();
    app.onError(onError);
    app.get('/boom', () => {
      throw Object.assign(new Error(`Failed query: insert into dailies\nparams: ${SECRET_TEXT}`), {
        code: '23505',
        params: [SECRET_TEXT],
      });
    });
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain(SECRET_TEXT);
  });
});
