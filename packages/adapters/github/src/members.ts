import type { Octokit } from '@octokit/core';

const TEAM_REFERENCE = /^@([^/]+)\/(.+)$/;

export async function resolveTeamMembers(
  octokit: Octokit,
  owner: string,
  members: string[],
): Promise<string[]> {
  const logins = new Set<string>();
  for (const member of members) {
    const team = TEAM_REFERENCE.exec(member);
    if (!team) {
      logins.add(member.toLowerCase());
      continue;
    }
    const org = team[1] ?? owner;
    const slug = team[2] ?? '';
    const response = await octokit.request('GET /orgs/{org}/teams/{team_slug}/members', {
      org,
      team_slug: slug,
      per_page: 100,
    });
    for (const user of response.data as { login: string }[]) logins.add(user.login.toLowerCase());
  }
  return [...logins].sort();
}
