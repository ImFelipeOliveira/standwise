import { listDailiesPage } from '@standwise/db';
import type { Deps } from '../deps';
import { type OrgItem, toOrgItem } from './list-org-dailies';
import { loadOrgTeams, requireTeam, teamNames } from './org-teams';
import { decodeCursor, encodeCursor, type Page, parseDay, parseLimit } from './pagination';

export type OrgBlocker = {
  text: string;
  ref: OrgItem['ref'];
  author: string;
  date: string;
  teams: string[];
};

export type OrgBlockerQuery = {
  date?: string;
  from?: string;
  to?: string;
  team?: string;
  cursor?: string;
  limit?: number;
};

export async function listOrgBlockers(
  deps: Deps,
  installationId: number,
  query: OrgBlockerQuery,
): Promise<Page<OrgBlocker>> {
  const date = parseDay(query.date, 'date');
  const from = parseDay(query.from, 'from');
  const to = parseDay(query.to, 'to');
  const limit = parseLimit(query.limit);
  const after = decodeCursor(query.cursor, 'item');
  const { teams } = await loadOrgTeams(deps, installationId);
  const team = requireTeam(teams, query.team);
  const rows = await listDailiesPage(deps.db, installationId, {
    date,
    from,
    to,
    logins: team?.memberLogins,
    after,
    includeAfter: after !== undefined,
    withBlockers: true,
    limit: limit + 2,
  });
  const teamsOf = (login: string) => teamNames(login, teams);
  const items = rows.flatMap((row) =>
    row.payload.blockers.flatMap((blocker, i) => {
      if (after && row.id === after.id && after.i !== undefined && i <= after.i) return [];
      const { text, ref } = toOrgItem(blocker);
      return [
        {
          position: { date: row.date, id: row.id, i },
          blocker: { text, ref, author: row.login, date: row.date, teams: teamsOf(row.login) },
        },
      ];
    }),
  );
  const data = items.slice(0, limit);
  const last = data[data.length - 1];
  return {
    data: data.map((entry) => entry.blocker),
    nextCursor: items.length > limit && last ? encodeCursor(last.position) : null,
  };
}
