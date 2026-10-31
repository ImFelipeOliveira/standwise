import type { Octokit } from '@octokit/core';
import { httpStatus } from './errors';

const PER_PAGE = 100;
const MAX_PAGES = 50;
const TEAM_REFERENCE = /^@([^/]+)\/(.+)$/;

export type TeamResolution = {
  logins: string[];
  missingTeams: string[];
  truncatedTeams: string[];
};

type TeamListing = { logins: string[]; missing: boolean; truncated: boolean };

async function listTeamMembers(octokit: Octokit, org: string, slug: string): Promise<TeamListing> {
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
      if (httpStatus(error) === 404 && page === 1)
        return { logins, missing: true, truncated: false };
      if (httpStatus(error) === 404) return { logins, missing: false, truncated: false };
      throw error;
    }
    for (const user of users) logins.push(user.login.toLowerCase());
    if (users.length < PER_PAGE) return { logins, missing: false, truncated: false };
  }
  return { logins, missing: false, truncated: true };
}

export async function resolveTeamMembers(
  octokit: Octokit,
  owner: string,
  members: string[],
): Promise<TeamResolution> {
  const logins = new Set<string>();
  const missingTeams: string[] = [];
  const truncatedTeams: string[] = [];
  for (const member of members) {
    const team = TEAM_REFERENCE.exec(member);
    if (!team) {
      logins.add(member.toLowerCase());
      continue;
    }
    const org = team[1] ?? owner;
    const slug = team[2] ?? '';
    const listing = await listTeamMembers(octokit, org, slug);
    for (const login of listing.logins) logins.add(login);
    if (listing.missing) missingTeams.push(member);
    if (listing.truncated) truncatedTeams.push(member);
  }
  return { logins: [...logins].sort(), missingTeams, truncatedTeams };
}
