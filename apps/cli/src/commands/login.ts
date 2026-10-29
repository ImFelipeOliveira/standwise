import { t } from '@standwise/core';
import { createSession, getMeta } from '../api';
import { writeCredentials } from '../credentials';
import {
  canOpen,
  DeviceFlowError,
  GITHUB_URL,
  pollAccessToken,
  requestDeviceCode,
} from '../device-flow';
import { type Ctx, EXIT, ExitError } from '../io';
import { loginApiUrl } from '../session';
import { isLocalHost, stripControl } from '../url';

function deviceMessage(ctx: Ctx, error: DeviceFlowError): string {
  if (error.reason === 'expired_token') return t(ctx.lang, 'cli.deviceExpired');
  if (error.reason === 'access_denied') return t(ctx.lang, 'cli.deviceDenied');
  return t(ctx.lang, 'cli.deviceFailed', { reason: error.reason });
}

function githubOverride(ctx: Ctx): string | undefined {
  const value = ctx.io.env.STANDWISE_GITHUB_URL;
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      isLocalHost(parsed.hostname)
    ) {
      return value.replace(/\/+$/, '');
    }
  } catch {}
  ctx.io.stderr(`${t(ctx.lang, 'cli.githubUrlIgnored')}\n`);
  return undefined;
}

export async function login(ctx: Ctx): Promise<number> {
  const { io, lang } = ctx;
  const apiUrl = loginApiUrl(ctx);
  const override = githubOverride(ctx);
  const githubUrl = override ?? GITHUB_URL;
  const meta = await getMeta(apiUrl);
  try {
    const code = await requestDeviceCode(githubUrl, meta.githubClientId);
    io.stderr(
      `${t(lang, 'cli.deviceCode', { uri: stripControl(code.verificationUri), code: stripControl(code.userCode) })}\n${t(lang, 'cli.waitingAuth')}\n`,
    );
    if (canOpen(code.verificationUri, override)) io.openBrowser(code.verificationUri);
    const githubToken = await pollAccessToken(githubUrl, meta.githubClientId, code, io.sleep);
    const session = await createSession(apiUrl, githubToken);
    await writeCredentials(io.env, {
      apiUrl,
      token: session.token,
      login: session.login,
      orgs: session.orgs,
    });
    io.stderr(`${t(lang, 'cli.loggedIn', { login: session.login })}\n`);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof DeviceFlowError) {
      throw new ExitError(EXIT.error, deviceMessage(ctx, error));
    }
    throw error;
  }
}
