import { getMemberLogins, listDigestDeliveries, listSubmitters } from '@standwise/db';
import type { Deps } from '../deps';
import { loadOrgTeams, requireTeam } from './org-teams';
import { decodeCursor, type Page, paginate, parseDay, parseLimit } from './pagination';

export type OrgDigest = {
  team: string;
  date: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt: Date | null;
  missing: string[];
};

export type OrgDigestQuery = {
  team?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

export async function listOrgDigests(
  deps: Deps,
  installationId: number,
  query: OrgDigestQuery,
): Promise<Page<OrgDigest>> {
  const from = parseDay(query.from, 'from');
  const to = parseDay(query.to, 'to');
  const limit = parseLimit(query.limit);
  const after = decodeCursor(query.cursor);
  const { teams } = await loadOrgTeams(deps, installationId);
  const team = requireTeam(teams, query.team);
  const rows = await listDigestDeliveries(deps.db, installationId, {
    team: team?.name,
    from,
    to,
    after,
    limit: limit + 1,
  });
  const page = paginate(rows, limit, (r) => ({ date: r.date, id: r.id }));
  const submitters = await listSubmitters(deps.db, installationId, [
    ...new Set(page.data.map((r) => r.date)),
  ]);
  const display = await getMemberLogins(
    deps.db,
    teams.flatMap((t) => t.memberLogins),
  );
  return {
    data: page.data.map((row) => {
      const members = teams.find((t) => t.name === row.teamName)?.memberLogins ?? [];
      const submitted = submitters.get(row.date) ?? new Set<string>();
      return {
        team: row.teamName,
        date: row.date,
        status: row.status,
        sentAt: row.status === 'sent' ? row.updatedAt : null,
        missing: members.filter((login) => !submitted.has(login)).map((l) => display.get(l) ?? l),
      };
    }),
    nextCursor: page.nextCursor,
  };
}
