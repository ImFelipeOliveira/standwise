import type { Octokit } from '@octokit/core';
import { type ActivityItem, clampTitle } from '@standcast/core';
import { httpStatus } from './errors';

const MAX_ITEMS = 50;
const PER_PAGE = 100;

type IssueHit = {
  title: string;
  html_url: string;
  repository_url: string;
  created_at: string;
  updated_at?: string;
  pull_request?: { merged_at: string | null };
};

type CommitHit = {
  html_url: string;
  commit: { message: string; committer: { date: string } | null; author: { date: string } | null };
  repository: { full_name: string };
};

function iso(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

function repoOf(hit: IssueHit): string {
  return hit.repository_url.split('/repos/')[1] ?? hit.repository_url;
}

async function scopeQualifier(octokit: Octokit, owner: string): Promise<string> {
  try {
    const response = await octokit.request('GET /users/{username}', { username: owner });
    return (response.data as { type?: string }).type === 'User' ? `user:${owner}` : `org:${owner}`;
  } catch (error) {
    if (httpStatus(error) === 404) return `org:${owner}`;
    throw error;
  }
}

async function searchIssues(octokit: Octokit, q: string): Promise<IssueHit[]> {
  const response = await octokit.request('GET /search/issues', {
    q,
    sort: 'updated',
    order: 'desc',
    per_page: PER_PAGE,
  });
  return (response.data as { items: IssueHit[] }).items;
}

async function searchCommits(octokit: Octokit, q: string): Promise<CommitHit[]> {
  const response = await octokit.request('GET /search/commits', {
    q,
    sort: 'committer-date',
    order: 'desc',
    per_page: PER_PAGE,
  });
  return (response.data as { items: CommitHit[] }).items;
}

function pullItem(kind: ActivityItem['kind'], hit: IssueHit, at: string): ActivityItem {
  return {
    kind,
    title: clampTitle(hit.title),
    url: hit.html_url,
    repo: repoOf(hit),
    at: new Date(at),
  };
}

function groupCommits(hits: CommitHit[]): ActivityItem[] {
  const byRepo = new Map<string, { hits: { hit: CommitHit; at: Date }[] }>();
  for (const hit of hits) {
    const date = hit.commit.committer?.date ?? hit.commit.author?.date;
    if (!date) continue;
    const group = byRepo.get(hit.repository.full_name) ?? { hits: [] };
    group.hits.push({ hit, at: new Date(date) });
    byRepo.set(hit.repository.full_name, group);
  }
  const items: ActivityItem[] = [];
  for (const [repo, group] of byRepo) {
    const latest = group.hits.reduce((a, b) => (b.at > a.at ? b : a));
    items.push({
      kind: 'commits',
      title: clampTitle(latest.hit.commit.message.split('\n')[0] ?? ''),
      url: latest.hit.html_url,
      repo,
      at: latest.at,
      count: group.hits.length,
    });
  }
  return items;
}

export async function listActivity(
  octokit: Octokit,
  owner: string,
  login: string,
  since: Date,
): Promise<ActivityItem[]> {
  const scope = await scopeQualifier(octokit, owner);
  const from = iso(since);
  const [opened, merged, reviewed, commits] = await Promise.all([
    searchIssues(octokit, `is:pr author:${login} ${scope} created:>=${from}`),
    searchIssues(octokit, `is:pr author:${login} ${scope} is:merged merged:>=${from}`),
    searchIssues(octokit, `is:pr reviewed-by:${login} -author:${login} ${scope} updated:>=${from}`),
    searchCommits(octokit, `author:${login} ${scope} committer-date:>=${from}`),
  ]);
  const items: ActivityItem[] = [
    ...opened.map((hit) => pullItem('pr_opened', hit, hit.created_at)),
    ...merged.map((hit) =>
      pullItem('pr_merged', hit, hit.pull_request?.merged_at ?? hit.created_at),
    ),
    ...reviewed.map((hit) => pullItem('review', hit, hit.updated_at ?? hit.created_at)),
    ...groupCommits(commits),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, MAX_ITEMS);
}
