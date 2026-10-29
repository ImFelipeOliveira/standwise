import { t } from '@standwise/core';
import { createSession, getMeta } from '../api';
import { writeCredentials } from '../credentials';
import { DeviceFlowError, GITHUB_URL, pollAccessToken, requestDeviceCode } from '../device-flow';
import { type Ctx, EXIT, ExitError } from '../io';
import { apiUrlFor } from '../session';

function deviceMessage(ctx: Ctx, error: DeviceFlowError): string {
  if (error.reason === 'expired_token') return t(ctx.lang, 'cli.deviceExpired');
  if (error.reason === 'access_denied') return t(ctx.lang, 'cli.deviceDenied');
  return t(ctx.lang, 'cli.deviceFailed', { reason: error.reason });
}

export async function login(ctx: Ctx): Promise<number> {
  const { io, lang } = ctx;
  const apiUrl = apiUrlFor(ctx);
  const githubUrl = io.env.STANDWISE_GITHUB_URL || GITHUB_URL;
  const meta = await getMeta(apiUrl);
  try {
    const code = await requestDeviceCode(githubUrl, meta.githubClientId);
    io.stderr(
      `${t(lang, 'cli.deviceCode', { uri: code.verificationUri, code: code.userCode })}\n${t(lang, 'cli.waitingAuth')}\n`,
    );
    io.openBrowser(code.verificationUri);
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
