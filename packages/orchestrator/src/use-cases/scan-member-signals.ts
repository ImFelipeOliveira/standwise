import { detectPullRequestSignals, type SignalKind, teamsForMember } from '@standwise/core';
import {
  getInstallation,
  getInstallationMemberIds,
  markDeliverySent,
  operationalConfig,
  syncSuggestions,
} from '@standwise/db';
import { GitHubRateLimitError } from '@standwise/github';
import type { WorkerDeps } from '../deps';
import { logError } from '../log-error';
import { resolveTeams } from '../teams';
import { CI_FAILING_HOURS, notifySuggestions } from './notify-suggestions';

export const SCAN_MEMBER_SIGNALS_JOB = 'scan-member-signals';
export const EVENT_SCAN_DELAY_SECONDS = 120;

const PULL_REQUEST_SIGNAL_KINDS: SignalKind[] = ['pr_no_review', 'ci_failing'];

export type ScanMemberSignalsJob = { installationId: number; login: string; date?: string };

export function memberScanKey(installationId: number, login: string): string {
  return `scan:${installationId}:${login.toLowerCase()}`;
}

export async function enqueueScanJob(
  deps: Pick<WorkerDeps, 'queue'>,
  job: ScanMemberSignalsJob,
  startAfter: Date,
): Promise<void> {
  const login = job.login.toLowerCase();
  await deps.queue.enqueue(
    SCAN_MEMBER_SIGNALS_JOB,
    { ...job, login },
    { singletonKey: memberScanKey(job.installationId, login), policy: 'stately', startAfter },
  );
}

export async function enqueueMemberScan(
  deps: Pick<WorkerDeps, 'queue' | 'now'>,
  installationId: number,
  login: string,
): Promise<void> {
  const startAfter = new Date(deps.now().getTime() + EVENT_SCAN_DELAY_SECONDS * 1000);
  await enqueueScanJob(deps, { installationId, login }, startAfter);
}

export async function scanMemberSignals(
  deps: WorkerDeps,
  job: ScanMemberSignalsJob,
): Promise<void> {
  const login = job.login.toLowerCase();
  const installation = await getInstallation(deps.db, job.installationId);
  const config = operationalConfig(installation);
  if (!installation || !config) return;

  const memberId = (await getInstallationMemberIds(deps.db, installation.id, [login])).get(login);
  if (!memberId) return;
  const teams = teamsForMember(
    login,
    await resolveTeams(deps, installation.id, installation.accountLogin, config),
  );
  const first = teams[0];
  if (!first) return;

  let snapshots: Awaited<ReturnType<WorkerDeps['github']['listOpenPullRequestSnapshots']>>;
  try {
    const octokit = await deps.github.installationOctokit(installation.id);
    snapshots = await deps.github.listOpenPullRequestSnapshots(
      octokit,
      installation.accountLogin,
      installation.accountType === 'User' ? 'User' : 'Organization',
      login,
    );
  } catch (error) {
    logError(
      'signal scan github lookup failed',
      error,
      error instanceof GitHubRateLimitError
        ? { retryAfterSeconds: String(error.retryAfterSeconds) }
        : {},
    );
    throw error;
  }

  const signals = detectPullRequestSignals(
    snapshots,
    deps.now(),
    first.signals.prReviewHours,
    CI_FAILING_HOURS,
  );
  const { created } = await syncSuggestions(
    deps.db,
    installation.id,
    memberId,
    PULL_REQUEST_SIGNAL_KINDS,
    signals,
  );
  if (first.signals.directMessage && created.length > 0) {
    await notifySuggestions(deps, {
      installationId: installation.id,
      config,
      memberId,
      login,
      team: first,
      suggestions: created,
    });
  }
  if (job.date) {
    await markDeliverySent(deps.db, {
      installationId: installation.id,
      teamName: '',
      date: job.date,
      kind: 'signal_scan',
      subject: login,
    });
  }
}
