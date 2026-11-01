import { describe, expect, test } from 'bun:test';
import { parseConfig, type StandcastConfig } from '@standcast/core';
import type { Deps } from '../src';
import { invalidateResolvedTeams, resolveTeams, TEAMS_CACHE_TTL_MS } from '../src';

const source = `
teams:
  - name: Alpha
    timezone: America/Sao_Paulo
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [Boss]
    members: [Alice, "@acme/backend"]
    chat: { provider: slack, channel: "#alpha" }
  - name: Beta
    timezone: UTC
    remind_at: "09:00"
    digest_at: "10:00"
    managers: [Boss]
    members: [carol]
    chat: { provider: slack, channel: "#beta" }
`;

describe('resolveTeams', () => {
  test('expands github teams', async () => {
    const parsed = parseConfig(source);
    if (!parsed.ok) throw new Error('bad config');
    const octokit = {};
    const calls: unknown[][] = [];
    const deps = {
      now: () => new Date(),
      github: {
        installationOctokit: async (id: number) => {
          calls.push(['octokit', id]);
          return octokit;
        },
        resolveTeamMembers: async (_o: unknown, owner: string, members: string[]) => {
          calls.push([owner, members]);
          return {
            logins: members.flatMap((m) => (m === '@acme/backend' ? ['Bob', 'DAVE'] : [m])),
            missingTeams: [],
            truncatedTeams: [],
          };
        },
      },
    } as unknown as Deps;

    const teams = await resolveTeams(deps, 7, 'acme', parsed.config);

    expect(teams.map((t) => t.name)).toEqual(['Alpha', 'Beta']);
    expect(teams[0]?.memberLogins).toEqual(['alice', 'bob', 'dave']);
    expect(teams[1]?.memberLogins).toEqual(['carol']);
    expect(calls[0]).toEqual(['octokit', 7]);
  });

  function counting() {
    let now = new Date('2026-10-28T15:00:00Z');
    const resolved: string[][] = [];
    const deps = {
      now: () => now,
      github: {
        installationOctokit: async () => ({}),
        resolveTeamMembers: async (_o: unknown, _owner: string, members: string[]) => {
          resolved.push(members);
          return { logins: members, missingTeams: [], truncatedTeams: [] };
        },
      },
    } as unknown as Deps;
    const advance = (ms: number) => {
      now = new Date(now.getTime() + ms);
    };
    return { deps, resolved, advance };
  }

  function parsed(): StandcastConfig {
    const result = parseConfig(source);
    if (!result.ok) throw new Error('bad config');
    return result.config;
  }

  test('caches resolved members per installation for five minutes', async () => {
    const { deps, resolved, advance } = counting();
    await resolveTeams(deps, 7, 'acme', parsed());
    await resolveTeams(deps, 7, 'acme', parsed());
    expect(resolved).toHaveLength(2);
    await resolveTeams(deps, 8, 'acme', parsed());
    expect(resolved).toHaveLength(4);
    advance(TEAMS_CACHE_TTL_MS + 1);
    await resolveTeams(deps, 7, 'acme', parsed());
    expect(resolved).toHaveLength(6);
  });

  test('a changed member list misses the cache', async () => {
    const { deps, resolved } = counting();
    const config = parsed();
    await resolveTeams(deps, 7, 'acme', config);
    const [alpha, beta] = config.teams;
    if (!alpha || !beta) throw new Error('teams');
    await resolveTeams(deps, 7, 'acme', {
      ...config,
      teams: [alpha, { ...beta, members: ['erin'] }],
    });
    expect(resolved).toEqual([['Alice', '@acme/backend'], ['carol'], ['erin']]);
  });

  test('invalidation drops the installation entries only', async () => {
    const { deps, resolved } = counting();
    await resolveTeams(deps, 7, 'acme', parsed());
    await resolveTeams(deps, 8, 'acme', parsed());
    invalidateResolvedTeams(deps, 7);
    await resolveTeams(deps, 7, 'acme', parsed());
    await resolveTeams(deps, 8, 'acme', parsed());
    expect(resolved).toHaveLength(6);
  });
});
