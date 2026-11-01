import { type ConfigError, type Language, locateConfigPath, parseConfig, t } from '@standcast/core';
import { getInstallation } from '@standcast/db';
import type { CheckRunInput, Octokit } from '@standcast/github';
import type { WorkerDeps } from '../deps';
import { logError } from '../log-error';

export const VALIDATE_CONFIG_JOB = 'validate-config';
export const CONFIG_REPO = '.github';
export const CONFIG_FILE = 'standcast.yml';
const CHECK_RUN_NAME = 'Standcast config';

export type ValidateConfigJob = {
  installationId: number;
  owner: string;
  headSha: string;
  pullNumber?: number;
};

type ValidationResult = 'success' | 'failure' | 'skipped';

export async function enqueueValidateConfig(
  deps: Pick<WorkerDeps, 'queue'>,
  job: ValidateConfigJob,
): Promise<void> {
  await deps.queue.enqueue(VALIDATE_CONFIG_JOB, job, {
    singletonKey: `validate:${job.installationId}:${job.headSha}`,
  });
}

function locateLine(source: string, path: string): number {
  const segments = path === '' ? [] : path.split('.');
  for (let size = segments.length; size >= 0; size--) {
    const found = locateConfigPath(source, segments.slice(0, size).join('.'));
    if (found) return found.line;
  }
  return 1;
}

function describeError(error: ConfigError): string {
  return error.path === '' ? error.message : `${error.path}: ${error.message}`;
}

async function touchesConfig(
  deps: WorkerDeps,
  octokit: Octokit,
  owner: string,
  pullNumber: number,
): Promise<boolean> {
  const files = await deps.github.listPullRequestFiles(octokit, {
    owner,
    repo: CONFIG_REPO,
    number: pullNumber,
  });
  return files.includes(CONFIG_FILE);
}

function checkRunFor(
  source: string,
  base: Pick<CheckRunInput, 'owner' | 'repo' | 'headSha' | 'name'>,
): CheckRunInput {
  const parsed = parseConfig(source);
  if (parsed.ok) {
    const lang: Language = parsed.config.teams[0]?.language ?? 'en';
    const title = t(lang, 'checkRun.success.title');
    return { ...base, conclusion: 'success', title, summary: title, annotations: [] };
  }
  const lang: Language = 'en';
  return {
    ...base,
    conclusion: 'failure',
    title: t(lang, 'checkRun.failure.title'),
    summary: t(lang, 'checkRun.summary', {
      count: parsed.errors.length,
      errors: parsed.errors.map((error) => `- ${describeError(error)}`).join('\n'),
    }),
    annotations: parsed.errors.map((error) => ({
      path: CONFIG_FILE,
      line: locateLine(source, error.path),
      message: describeError(error),
    })),
  };
}

export async function validateConfigAtRef(
  deps: WorkerDeps,
  job: ValidateConfigJob,
): Promise<ValidationResult> {
  const installation = await getInstallation(deps.db, job.installationId);
  if (!installation) return 'skipped';
  if (installation.accountLogin.toLowerCase() !== job.owner.toLowerCase()) return 'skipped';
  const owner = installation.accountLogin;
  const octokit = await deps.github.installationOctokit(installation.id);
  if (
    job.pullNumber !== undefined &&
    !(await touchesConfig(deps, octokit, owner, job.pullNumber))
  ) {
    return 'skipped';
  }
  const source = await deps.github.fetchConfigSource(octokit, owner, { ref: job.headSha });
  if (!source.found) {
    if (source.reason === 'no_access') {
      logError('config validation skipped', {
        name: 'ConfigAccessError',
        code: source.reason,
        message: 'no access to the config repository',
      });
    }
    return 'skipped';
  }
  const input = checkRunFor(source.source, {
    owner,
    repo: CONFIG_REPO,
    headSha: job.headSha,
    name: CHECK_RUN_NAME,
  });
  try {
    await deps.github.createCheckRun(octokit, input);
  } catch (error) {
    logError('config check run failed', error);
    throw error;
  }
  return input.conclusion;
}
