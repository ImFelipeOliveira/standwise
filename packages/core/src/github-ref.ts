export type GitHubPullRef = { owner: string; repo: string; number: number };

const PULL_URL =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\/[^?#]*)?(?:[?#].*)?$/;

export function parsePullRequestUrl(url: string): GitHubPullRef | null {
  const match = PULL_URL.exec(url.trim());
  if (!match) return null;
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return { owner: match[1] as string, repo: match[2] as string, number };
}

const LABELED_URL =
  /^https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/(pull|issues|commit)\/([0-9a-f]{7,40}|\d+)(?:[/?#].*)?$/;

export function githubRefLabel(url: string): string | null {
  const match = LABELED_URL.exec(url.trim());
  if (!match) return null;
  const [, repo, kind, id] = match as unknown as [string, string, string, string];
  if (kind === 'commit') return /^[0-9a-f]+$/.test(id) ? `${repo}@${id.slice(0, 7)}` : null;
  return /^\d+$/.test(id) ? `${repo}#${id}` : null;
}
