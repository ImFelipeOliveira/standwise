import type { Octokit } from '@octokit/core';
import { httpStatus } from './errors';

const PER_PAGE = 100;
const MAX_PAGES = 50;
const TEAM_REFERENCE = /^@([^/]+)\/(.+)$/;

async function listTeamMembers(octokit: Octokit, org: string, slug: string): Promise<string[]> {
  const logins: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let users: { login: string }[];
    try {
      const response = await octokit.request('GET /orgs/{org}/teams/{team_slug}/members', {
        org,
        team_slug: slug,
        per_page: PER_PAGE,
        page,
      });
      users = response.data as { login: string }[];
    } catch (error) {
      if (httpStatus(error) === 404) return logins;
      throw error;
    }
    for (const user of users) logins.push(user.login.toLowerCase());
    if (users.length < PER_PAGE) break;
  }
  return logins;
}

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
    for (const login of await listTeamMembers(octokit, org, slug)) logins.add(login);
  }
  return [...logins].sort();
}
