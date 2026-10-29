import type { Octokit } from '@octokit/core';

const PER_PAGE = 100;
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
    for (let page = 1; ; page++) {
      const response = await octokit.request('GET /orgs/{org}/teams/{team_slug}/members', {
        org,
        team_slug: slug,
        per_page: PER_PAGE,
        page,
      });
      const users = response.data as { login: string }[];
      for (const user of users) logins.add(user.login.toLowerCase());
      if (users.length < PER_PAGE) break;
    }
  }
  return [...logins].sort();
}
