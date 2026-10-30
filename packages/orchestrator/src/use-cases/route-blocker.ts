import {
  type BlockerRouteReason,
  buildBlockerRouted,
  type GitHubPullRef,
  type Item,
  ownersForFiles,
  parseCodeowners,
  parsePullRequestUrl,
  type ResolvedTeam,
  type StandwiseConfig,
  teamsForMember,
} from '@standwise/core';
import {
  claimDelivery,
  completeDelivery,
  type DeliveryKey,
  failDelivery,
  getDailyById,
  getInstallation,
  operationalConfig,
} from '@standwise/db';
import { chatUserIdsFor } from '../chat-identity';
import type { WorkerDeps } from '../deps';
import { blockerHash } from '../events';
import { resolveTeams } from '../teams';
import { describeDeliveryError } from './delivery-error';

export const ROUTE_BLOCKER_JOB = 'route-blocker';
export const MAX_ROUTE_TARGETS = 5;

export type RouteBlockerJob = { installationId: number; dailyId: string; blockerIndex: number };

export type RouteTarget = { reason: BlockerRouteReason; logins: string[] };

type RouteContext = {
  installationId: number;
  owner: string;
  config: StandwiseConfig;
  author: string;
  firstTeam: ResolvedTeam;
  blocker: Item;
};

type Octokit = Awaited<ReturnType<WorkerDeps['github']['installationOctokit']>>;

function cleanLogins(logins: string[], excluded: string[]): string[] {
  const skip = new Set(excluded.map((l) => l.toLowerCase()));
  const result: string[] = [];
  for (const login of logins) {
    const lower = login.replace(/^@/, '').toLowerCase();
    if (!lower || skip.has(lower) || result.includes(lower)) continue;
    result.push(lower);
  }
  return result.slice(0, MAX_ROUTE_TARGETS);
}

function managerTarget(ctx: RouteContext): RouteTarget {
  return { reason: 'manager', logins: cleanLogins(ctx.firstTeam.managers, [ctx.author]) };
}

async function expandOwners(
  deps: WorkerDeps,
  octokit: Octokit,
  owner: string,
  entries: string[],
): Promise<string[]> {
  const logins: string[] = [];
  for (const entry of entries) {
    const team = /^@([^/]+)\/(.+)$/.exec(entry);
    if (!team) logins.push(entry.replace(/^@/, ''));
    else if ((team[1] as string).toLowerCase() === owner.toLowerCase()) {
      logins.push(...(await deps.github.resolveTeamMembers(octokit, owner, [entry])));
    }
  }
  return logins;
}

async function pullRequestTarget(
  deps: WorkerDeps,
  ctx: RouteContext,
  pull: GitHubPullRef,
): Promise<RouteTarget | null> {
  const octokit = await deps.github.installationOctokit(ctx.installationId);
  const detail = await deps.github.getPullRequest(octokit, pull);
  if (!detail) return null;
  const excluded = [ctx.author, detail.author];
  const teamRefs = detail.requestedTeams.map((slug) => `@${ctx.owner}/${slug}`);
  const reviewers = cleanLogins(
    [...detail.requestedReviewers, ...(await expandOwners(deps, octokit, ctx.owner, teamRefs))],
    excluded,
  );
  if (reviewers.length > 0) return { reason: 'pr_reviewers', logins: reviewers };
  const source = await deps.github.fetchCodeowners(octokit, pull.owner, pull.repo, detail.baseRef);
  if (!source) return null;
  const files = await deps.github.listPullRequestFiles(octokit, pull);
  const entries = ownersForFiles(parseCodeowners(source), files);
  const owners = cleanLogins(await expandOwners(deps, octokit, ctx.owner, entries), excluded);
  return owners.length > 0 ? { reason: 'codeowners', logins: owners } : null;
}

export async function resolveRouteTarget(
  deps: WorkerDeps,
  ctx: RouteContext,
): Promise<RouteTarget> {
  const ref = ctx.blocker.ref;
  if (ref?.kind === 'pull_request') {
    const pull = parsePullRequestUrl(ref.url);
    if (pull && pull.owner.toLowerCase() === ctx.owner.toLowerCase()) {
      const found = await pullRequestTarget(deps, ctx, pull);
      if (found) return found;
    }
  }
  if (ref?.kind === 'card') {
    const assignee = await deps.tracker.blockingAssignee(ctx.installationId, ref);
    const logins = cleanLogins(assignee ? [assignee] : [], [ctx.author]);
    if (logins.length > 0) return { reason: 'card_blocker', logins };
  }
  return managerTarget(ctx);
}

export async function routeBlocker(deps: WorkerDeps, job: RouteBlockerJob): Promise<void> {
  const installation = await getInstallation(deps.db, job.installationId);
  const config = operationalConfig(installation);
  if (!installation || !config) return;
  const daily = await getDailyById(deps.db, job.installationId, job.dailyId);
  const blocker = daily?.payload.blockers[job.blockerIndex];
  if (!daily || !blocker) return;
  const author = daily.login.toLowerCase();
  const teams = await resolveTeams(deps, installation.id, installation.accountLogin, config);
  const firstTeam = teamsForMember(author, teams)[0];
  if (!firstTeam) return;

  const ctx: RouteContext = {
    installationId: job.installationId,
    owner: installation.accountLogin,
    config,
    author,
    firstTeam,
    blocker,
  };
  let target = await resolveRouteTarget(deps, ctx);
  const fallback = managerTarget(ctx);
  const ids = await chatUserIdsFor(deps, job.installationId, config, [
    ...target.logins,
    ...fallback.logins,
    author,
  ]);
  if (target.reason !== 'manager' && !target.logins.some((l) => ids.has(l))) target = fallback;

  const chat = await deps.chatFor(job.installationId, 'slack');
  const hash = blockerHash(blocker);
  const authorChatId = ids.get(author);
  for (const login of target.logins) {
    const key: DeliveryKey = {
      installationId: job.installationId,
      teamName: '',
      date: daily.date,
      kind: 'blocker_route',
      subject: `${job.dailyId}:${hash}:${login}`,
    };
    const claim = await claimDelivery(deps.db, key);
    if (claim.status !== 'claimed') continue;
    try {
      if (!chat) {
        await failDelivery(deps.db, key, claim.token, 'no_chat_connection');
        continue;
      }
      const chatUserId = ids.get(login);
      if (!chatUserId) {
        await failDelivery(deps.db, key, claim.token, `no_chat_identity: ${login}`);
        continue;
      }
      const ref = await chat.sendDirect(
        chatUserId,
        buildBlockerRouted({
          lang: firstTeam.language,
          author: { login: daily.login, ...(authorChatId ? { chatUserId: authorChatId } : {}) },
          blocker,
          reason: target.reason,
          date: daily.date,
        }),
      );
      await completeDelivery(deps.db, key, claim.token, ref);
    } catch (error) {
      await failDelivery(deps.db, key, claim.token, describeDeliveryError(error));
      throw error;
    }
  }
}
