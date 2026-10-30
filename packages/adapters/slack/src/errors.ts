export class ChatDeliveryError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChatDeliveryError';
  }
}

export async function mapSlackErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ChatDeliveryError) throw e;
    const err = e as { code?: string; data?: { error?: string }; message?: string };
    if (err.code === 'slack_webapi_platform_error') {
      const code = err.data?.error ?? 'unknown_error';
      throw new ChatDeliveryError(code, err.message ?? code);
    }
    if (err.code === 'slack_webapi_request_error') {
      throw new ChatDeliveryError('request_failed', err.message ?? 'request failed');
    }
    if (err.code === 'slack_webapi_http_error') {
      throw new ChatDeliveryError('http_error', err.message ?? 'http error');
    }
    throw e;
  }
}
