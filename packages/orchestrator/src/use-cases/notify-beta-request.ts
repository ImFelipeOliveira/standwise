import { getBetaRequest, markBetaRequestNotified } from '@standcast/db';
import type { WorkerDeps } from '../deps';
import { logError } from '../log-error';
import type { NotifyBetaRequestJob } from './submit-beta-request';

export async function notifyBetaRequest(
  deps: Pick<WorkerDeps, 'db' | 'now' | 'email' | 'env'>,
  job: NotifyBetaRequestJob,
): Promise<void> {
  const request = await getBetaRequest(deps.db, job.requestId);
  if (!request || request.notifiedAt) return;
  if (!deps.email) {
    logError('beta email disabled', new Error('RESEND_API_KEY not set'));
    return;
  }
  await deps.email.send({
    from: deps.env.betaEmailFrom,
    to: deps.env.supportEmail,
    replyTo: request.email,
    idempotencyKey: `beta-request/${request.id}/${request.createdAt.getTime()}`,
    subject: `Beta request: ${request.name} (${request.teamSize}, ${request.chat}, ${request.tracker})`,
    text: [
      `Name: ${request.name}`,
      `Email: ${request.email}`,
      `Team size: ${request.teamSize}`,
      `Chat: ${request.chat}`,
      `Tracker: ${request.tracker}`,
      `Locale: ${request.locale}`,
      `Requested at: ${request.createdAt.toISOString()}`,
    ].join('\n'),
  });
  await markBetaRequestNotified(deps.db, request.id, deps.now());
}
