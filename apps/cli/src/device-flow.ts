export const GITHUB_URL = 'https://github.com';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

export class DeviceFlowError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
};

async function postForm(
  url: string,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== 'object' || payload === null) {
    throw new DeviceFlowError(`http_${response.status}`);
  }
  return payload as Record<string, unknown>;
}

export async function requestDeviceCode(githubUrl: string, clientId: string): Promise<DeviceCode> {
  const data = await postForm(`${githubUrl}/login/device/code`, { client_id: clientId });
  if (typeof data.device_code !== 'string' || typeof data.user_code !== 'string') {
    throw new DeviceFlowError(typeof data.error === 'string' ? data.error : 'invalid_response');
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: String(data.verification_uri),
    interval: typeof data.interval === 'number' ? data.interval : 5,
  };
}

export async function pollAccessToken(
  githubUrl: string,
  clientId: string,
  code: DeviceCode,
  sleep: (ms: number) => Promise<void>,
): Promise<string> {
  let interval = code.interval;
  for (;;) {
    await sleep(interval * 1000);
    const data = await postForm(`${githubUrl}/login/oauth/access_token`, {
      client_id: clientId,
      device_code: code.deviceCode,
      grant_type: GRANT_TYPE,
    });
    if (typeof data.access_token === 'string') return data.access_token;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      interval += 5;
      continue;
    }
    throw new DeviceFlowError(typeof data.error === 'string' ? data.error : 'invalid_response');
  }
}

export function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    Bun.spawn([command, url], { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' }).exited.catch(
      () => undefined,
    );
  } catch {
    return;
  }
}
