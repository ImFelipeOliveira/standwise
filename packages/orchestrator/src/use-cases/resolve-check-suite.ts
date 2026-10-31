import { getInstallation, operationalConfig } from '@standwise/db';
import type { WorkerDeps } from '../deps';
import { logError } from '../log-error';
import { resolveTeams } from '../teams';
import { enqueueMemberScan } from './scan-member-signals';

export const RESOLVE_CHECK_SUITE_JOB = 'resolve-check-suite';
export const MAX_CHECK_SUITE_LOOKUPS = 5;

export type ResolveCheckSuiteJob = {
  installationId: number;
  owner: string;
  repo: string;
  numbers: number[];
};

export async function resolveCheckSuite(
  deps: WorkerDeps,
  job: ResolveCheckSuiteJob,
): Promise<void> {
  const installation = await getInstallation(deps.db, job.installationId);
  const config = operationalConfig(installation);
  if (!installation || !config) return;
  if (job.owner.toLowerCase() !== installation.accountLogin.toLowerCase()) return;
  const numbers = job.numbers.slice(0, MAX_CHECK_SUITE_LOOKUPS);
  if (numbers.length === 0) return;

  const teams = await resolveTeams(deps, installation.id, installation.accountLogin, config);
  const members = new Set(teams.flatMap((team) => team.memberLogins));
  const octokit = await deps.github.installationOctokit(installation.id);
  const enqueued = new Set<string>();
  let failure: unknown = null;
  for (const number of numbers) {
    try {
      const detail = await deps.github.getPullRequest(octokit, {
        owner: job.owner,
        repo: job.repo,
        number,
      });
      const login = detail?.author.toLowerCase();
      if (!login || !members.has(login) || enqueued.has(login)) continue;
      enqueued.add(login);
      await enqueueMemberScan(deps, installation.id, login);
    } catch (error) {
      logError('check suite author lookup failed', error);
      failure ??= error;
    }
  }
  if (failure) throw failure;
}
