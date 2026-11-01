import {
  detectCardSignals,
  detectPullRequestSignals,
  type SignalKind,
  type StandcastConfig,
  type TeamConfig,
  teamsForMember,
} from '@standcast/core';
import {
  getDelivery,
  getInstallation,
  getInstallationMemberIds,
  markDeliverySent,
  operationalConfig,
  type SuggestionRow,
  syncSuggestions,
} from '@standcast/db';
import { GitHubRateLimitError } from '@standcast/github';
import type { WorkerDeps } from '../deps';
import { logError } from '../log-error';
import type { StaleCards } from '../project-tracker';
import { resolveTeams } from '../teams';
import { CI_FAILING_HOURS, notifySuggestions } from './notify-suggestions';

export const SCAN_MEMBER_SIGNALS_JOB = 'scan-member-signals';
export const EVENT_SCAN_DELAY_SECONDS = 120;

const PULL_REQUEST_SIGNAL_KINDS: SignalKind[] = ['pr_no_review', 'ci_failing'];
const CARD_SIGNAL_KINDS: SignalKind[] = ['card_stale'];

type ScanContext = {
  installationId: number;
  owner: string;
  ownerType: 'User' | 'Organization';
  config: StandcastConfig;
  memberId: string;
  login: string;
  team: TeamConfig;
};

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
  if (job.date) {
    const marker = await getDelivery(deps.db, {
      installationId: installation.id,
      teamName: '',
      date: job.date,
      kind: 'signal_scan',
      subject: login,
    });
    if (marker?.status === 'sent') return;
  }

  const teams = teamsForMember(
    login,
    await resolveTeams(deps, installation.id, installation.accountLogin, config),
  );
  const first = teams[0];
  if (!first) return;

  const ctx: ScanContext = {
    installationId: installation.id,
    owner: installation.accountLogin,
    ownerType: installation.accountType === 'User' ? 'User' : 'Organization',
    config,
    memberId,
    login,
    team: first,
  };
  const created: SuggestionRow[] = [];
  const errors: unknown[] = [];
  for (const source of [syncPullRequestSignals, syncCardSignals]) {
    try {
      created.push(...(await source(deps, ctx)));
    } catch (error) {
      errors.push(error);
    }
  }
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
  if (errors.length > 0) throw errors[0];
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

async function syncPullRequestSignals(
  deps: WorkerDeps,
  ctx: ScanContext,
): Promise<SuggestionRow[]> {
  let snapshots: Awaited<ReturnType<WorkerDeps['github']['listOpenPullRequestSnapshots']>>;
  try {
    const octokit = await deps.github.installationOctokit(ctx.installationId);
    snapshots = await deps.github.listOpenPullRequestSnapshots(
      octokit,
      ctx.owner,
      ctx.ownerType,
      ctx.login,
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
    ctx.team.signals.prReviewHours,
    CI_FAILING_HOURS,
  );
  const { created } = await syncSuggestions(
    deps.db,
    ctx.installationId,
    ctx.memberId,
    PULL_REQUEST_SIGNAL_KINDS,
    signals,
  );
  return created;
}

async function syncCardSignals(deps: WorkerDeps, ctx: ScanContext): Promise<SuggestionRow[]> {
  const extra = { installationId: String(ctx.installationId) };
  let stale: StaleCards | null;
  try {
    const tracker = await deps.trackerFor(ctx.installationId, ctx.owner, ctx.config, ctx.team);
    stale = tracker.connected ? await tracker.listStaleInProgress(ctx.login) : null;
  } catch (error) {
    logError('signal scan tracker lookup failed', error, extra);
    throw error;
  }
  if (!stale) return [];
  if (stale.truncated) {
    logError('signal scan card page truncated', new Error('card_page_truncated'), extra);
    return [];
  }
  const signals = detectCardSignals(stale.cards, deps.now(), ctx.team.signals.cardStaleDays);
  const { created } = await syncSuggestions(
    deps.db,
    ctx.installationId,
    ctx.memberId,
    CARD_SIGNAL_KINDS,
    signals,
  );
  return created;
}
