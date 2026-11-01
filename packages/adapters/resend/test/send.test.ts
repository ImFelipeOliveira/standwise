import { describe, expect, test } from 'bun:test';
import { EmailDeliveryError, type EmailMessage, sendEmail } from '../src';

const KEY = 're_secret_key_123';
const message: EmailMessage = {
  from: 'Standwise <beta@sw.test>',
  to: 'support@sw.test',
  replyTo: 'ana@acme.com',
  subject: 'Hello',
  text: 'Body',
};

async function failure(run: () => Promise<void>): Promise<EmailDeliveryError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(EmailDeliveryError);
    return error as EmailDeliveryError;
  }
  throw new Error('expected failure');
}

describe('sendEmail', () => {
  test('sends with bearer and json', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ id: 'e1' }), { status: 200 });
    }) as typeof fetch;
    await sendEmail(KEY, message, { fetch: fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.resend.com/emails');
    expect(calls[0]?.init.method).toBe('POST');
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      from: message.from,
      to: [message.to],
      reply_to: message.replyTo,
      subject: message.subject,
      text: message.text,
    });
  });

  test('4xx maps to rejected', async () => {
    const fetchImpl = (async () =>
      new Response(`bad ${KEY}`, { status: 422 })) as unknown as typeof fetch;
    const error = await failure(() => sendEmail(KEY, message, { fetch: fetchImpl }));
    expect(error.code).toBe('rejected');
    expect(error.message).toContain('422');
    expect(error.message).not.toContain(KEY);
  });

  test('5xx maps to http_error', async () => {
    const fetchImpl = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    const error = await failure(() => sendEmail(KEY, message, { fetch: fetchImpl }));
    expect(error.code).toBe('http_error');
    expect(error.message).not.toContain(KEY);
  });

  test('timeout maps to timeout', async () => {
    const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const error = await failure(() => sendEmail(KEY, message, { fetch: fetchImpl, timeoutMs: 10 }));
    expect(error.code).toBe('timeout');
  });

  test('network error maps to request_failed', async () => {
    const fetchImpl = (async () => {
      throw new TypeError(`connect failed for ${KEY}`);
    }) as unknown as typeof fetch;
    const error = await failure(() => sendEmail(KEY, message, { fetch: fetchImpl }));
    expect(error.code).toBe('request_failed');
    expect(error.message).not.toContain(KEY);
  });
});
