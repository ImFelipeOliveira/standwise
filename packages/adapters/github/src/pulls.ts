import type { Octokit } from '@octokit/core';
import type { GitHubPullRef, PullRequestSnapshot } from '@standwise/core';
import { asRateLimitError, httpStatus } from './errors';

const PER_PAGE = 100;
const MAX_FILE_PAGES = 30;
const MAX_SEARCH_RESULTS = 30;
const COUNTED_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED']);
const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out']);

export type PullRequestDetail = {
  ref: GitHubPullRef;
  url: string;
  title: string;
  author: string;
  state: 'open' | 'closed';
  draft: boolean;
  headSha: string;
  baseRef: string;
  requestedReviewers: string[];
  requestedTeams: string[];
};

type PullData = {
  html_url: string;
  title: string;
  user: { login: string } | null;
  state: string;
  draft?: boolean;
  head: { sha: string };
  base: { ref: string };
  requested_reviewers?: { login: string }[];
  requested_teams?: { slug: string }[];
};

type SearchHit = {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  repository_url: string;
};

type CheckRunData = { name: string; conclusion: string | null; completed_at: string | null };

export async function getPullRequest(
  octokit: Octokit,
  ref: GitHubPullRef,
): Promise<PullRequestDetail | null> {
  let data: PullData;
  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
    });
    data = response.data as PullData;
  } catch (error) {
    if (httpStatus(error) === 404) return null;
    throw error;
  }
  return {
    ref,
    url: data.html_url,
    title: data.title,
    author: data.user?.login ?? '',
    state: data.state === 'open' ? 'open' : 'closed',
    draft: data.draft === true,
    headSha: data.head.sha,
    baseRef: data.base.ref,
    requestedReviewers: (data.requested_reviewers ?? []).map((user) => user.login),
    requestedTeams: (data.requested_teams ?? []).map((team) => team.slug),
  };
}

export async function listPullRequestFiles(
  octokit: Octokit,
  ref: GitHubPullRef,
): Promise<string[]> {
  const files: string[] = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const response = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      per_page: PER_PAGE,
      page,
    });
    const batch = response.data as { filename: string }[];
    for (const file of batch) files.push(file.filename);
    if (batch.length < PER_PAGE) break;
  }
  return files;
}

type ReviewCounts = { reviewCount: number; dismissedReviewCount: number };

async function countReviews(
  octokit: Octokit,
  ref: GitHubPullRef,
  author: string,
): Promise<ReviewCounts> {
  const response = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.number,
    per_page: PER_PAGE,
  });
  const authorLogin = author.toLowerCase();
  const reviews = (response.data as { state: string; user?: { login?: string } | null }[]).filter(
    (review) => !authorLogin || (review.user?.login ?? '').toLowerCase() !== authorLogin,
  );
  return {
    reviewCount: reviews.filter((review) => COUNTED_REVIEW_STATES.has(review.state)).length,
    dismissedReviewCount: reviews.filter((review) => review.state === 'DISMISSED').length,
  };
}

async function readyAtOf(octokit: Octokit, ref: GitHubPullRef, createdAt: string): Promise<Date> {
  const response = await octokit.request(
    'GET /repos/{owner}/{repo}/issues/{issue_number}/timeline',
    {
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
      per_page: PER_PAGE,
    },
  );
  const events = (response.data as { event?: string; created_at?: string }[]).filter(
    (entry) => entry.event === 'ready_for_review' && entry.created_at,
  );
  const last = events[events.length - 1]?.created_at;
  return new Date(last ?? createdAt);
}

async function failingSince(
  octokit: Octokit,
  ref: GitHubPullRef,
  headSha: string,
): Promise<Date | null> {
  const response = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
    owner: ref.owner,
    repo: ref.repo,
    ref: headSha,
    per_page: PER_PAGE,
  });
  const runs = (response.data as { check_runs: CheckRunData[] }).check_runs;
  let earliest: Date | null = null;
  for (const run of runs) {
    if (!run.completed_at || !run.conclusion || !FAILED_CONCLUSIONS.has(run.conclusion)) continue;
    const failedAt = new Date(run.completed_at);
    const recovered = runs.some(
      (other) =>
        other.name === run.name &&
        other.conclusion === 'success' &&
        other.completed_at !== null &&
        new Date(other.completed_at) > failedAt,
    );
    if (recovered) continue;
    if (!earliest || failedAt < earliest) earliest = failedAt;
  }
  return earliest;
}

function refOf(hit: SearchHit): GitHubPullRef | null {
  const path = hit.repository_url.split('/repos/')[1];
  const [owner, repo] = path?.split('/') ?? [];
  return owner && repo ? { owner, repo, number: hit.number } : null;
}

export async function listOpenPullRequestSnapshots(
  octokit: Octokit,
  owner: string,
  ownerType: 'Organization' | 'User',
  author: string,
): Promise<PullRequestSnapshot[]> {
  try {
    return await collectSnapshots(octokit, owner, ownerType, author);
  } catch (error) {
    throw asRateLimitError(error);
  }
}

async function collectSnapshots(
  octokit: Octokit,
  owner: string,
  ownerType: 'Organization' | 'User',
  author: string,
): Promise<PullRequestSnapshot[]> {
  const scope = ownerType === 'User' ? `user:${owner}` : `org:${owner}`;
  const search = await octokit.request('GET /search/issues', {
    q: `is:pr is:open draft:false author:${author} ${scope}`,
    per_page: MAX_SEARCH_RESULTS,
  });
  const hits = (search.data as { items: SearchHit[] }).items.slice(0, MAX_SEARCH_RESULTS);
  const snapshots: PullRequestSnapshot[] = [];
  for (const hit of hits) {
    const ref = refOf(hit);
    if (!ref) continue;
    const detail = await getPullRequest(octokit, ref);
    if (detail?.state !== 'open') continue;
    const [reviews, readyAt, failing] = await Promise.all([
      countReviews(octokit, ref, detail.author),
      readyAtOf(octokit, ref, hit.created_at),
      failingSince(octokit, ref, detail.headSha),
    ]);
    snapshots.push({
      repo: `${ref.owner}/${ref.repo}`,
      number: ref.number,
      url: hit.html_url,
      title: hit.title,
      draft: detail.draft,
      readyAt,
      reviewCount: reviews.reviewCount,
      dismissedReviewCount: reviews.dismissedReviewCount,
      headSha: detail.headSha,
      failingChecksSince: failing,
    });
  }
  return snapshots;
}
