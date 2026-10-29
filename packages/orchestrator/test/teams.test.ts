import { describe, expect, test } from 'bun:test';
import { parseConfig } from '@standwise/core';
import type { Deps } from '../src';
import { resolveTeams } from '../src';

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
      github: {
        installationOctokit: async (id: number) => {
          calls.push(['octokit', id]);
          return octokit;
        },
        resolveTeamMembers: async (_o: unknown, owner: string, members: string[]) => {
          calls.push([owner, members]);
          return members.flatMap((m) => (m === '@acme/backend' ? ['Bob', 'DAVE'] : [m]));
        },
      },
    } as unknown as Deps;

    const teams = await resolveTeams(deps, 7, 'acme', parsed.config);

    expect(teams.map((t) => t.name)).toEqual(['Alpha', 'Beta']);
    expect(teams[0]?.memberLogins).toEqual(['alice', 'bob', 'dave']);
    expect(teams[1]?.memberLogins).toEqual(['carol']);
    expect(calls[0]).toEqual(['octokit', 7]);
  });
});
