export type EmailMessage = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
};

export type EmailDeliveryCode = 'timeout' | 'request_failed' | 'http_error' | 'rejected';

export class EmailDeliveryError extends Error {
  constructor(
    public code: EmailDeliveryCode,
    message: string,
  ) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

export const RESEND_BASE_URL = 'https://api.resend.com';
export const RESEND_TIMEOUT_MS = 10_000;

export type SendEmailOptions = {
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
};

export async function sendEmail(
  apiKey: string,
  message: EmailMessage,
  opts: SendEmailOptions = {},
): Promise<void> {
  const fetchImpl = opts.fetch ?? fetch;
  const url = `${opts.baseUrl ?? RESEND_BASE_URL}/emails`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        reply_to: message.replyTo,
        subject: message.subject,
        text: message.text,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? RESEND_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new EmailDeliveryError('timeout', 'email request timed out');
    }
    throw new EmailDeliveryError('request_failed', 'email request failed');
  }
  await response.body?.cancel().catch(() => {});
  if (response.status >= 200 && response.status < 300) return;
  if (response.status >= 400 && response.status < 500) {
    throw new EmailDeliveryError('rejected', `email rejected with status ${response.status}`);
  }
  throw new EmailDeliveryError('http_error', `email provider returned status ${response.status}`);
}
