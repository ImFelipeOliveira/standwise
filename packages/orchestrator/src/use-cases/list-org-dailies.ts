import type { Item } from '@standwise/core';
import { type DailyRecord, getDailyById, listDailiesPage } from '@standwise/db';
import type { Deps } from '../deps';
import { DomainError } from './errors';
import { loadOrgTeams, requireTeam, teamNames } from './org-teams';
import { decodeCursor, isUuid, type Page, paginate, parseDay, parseLimit } from './pagination';

export type OrgItem = {
  text: string;
  ref: {
    kind: 'pull_request' | 'issue' | 'commit' | 'card';
    url: string;
    title: string | null;
  } | null;
};

export type OrgDaily = {
  id: string;
  login: string;
  date: string;
  submittedAt: Date;
  teams: string[];
  yesterday: OrgItem[];
  today: OrgItem[];
  blockers: OrgItem[];
};

export type OrgDailyQuery = { date?: string; team?: string; cursor?: string; limit?: number };

export function toOrgItem(item: Item): OrgItem {
  return {
    text: item.text,
    ref: item.ref
      ? { kind: item.ref.kind, url: item.ref.url, title: item.ref.title ?? null }
      : null,
  };
}

export function toOrgDaily(record: DailyRecord, teams: string[]): OrgDaily {
  return {
    id: record.id,
    login: record.login,
    date: record.date,
    submittedAt: record.submittedAt,
    teams,
    yesterday: record.payload.yesterday.map(toOrgItem),
    today: record.payload.today.map(toOrgItem),
    blockers: record.payload.blockers.map(toOrgItem),
  };
}

export async function listOrgDailies(
  deps: Deps,
  installationId: number,
  query: OrgDailyQuery,
): Promise<Page<OrgDaily>> {
  const date = parseDay(query.date, 'date');
  const limit = parseLimit(query.limit);
  const after = decodeCursor(query.cursor);
  const { teams } = await loadOrgTeams(deps, installationId);
  const team = requireTeam(teams, query.team);
  const rows = await listDailiesPage(deps.db, installationId, {
    date,
    logins: team?.memberLogins,
    after,
    limit: limit + 1,
  });
  const page = paginate(rows, limit, (r) => ({ date: r.date, id: r.id }));
  return {
    data: page.data.map((r) => toOrgDaily(r, teamNames(r.login, teams))),
    nextCursor: page.nextCursor,
  };
}

export async function getOrgDaily(
  deps: Deps,
  installationId: number,
  id: string,
): Promise<OrgDaily> {
  const notFound = () => new DomainError('not_found', 'daily not found');
  if (!isUuid(id)) throw notFound();
  const { teams } = await loadOrgTeams(deps, installationId);
  const record = await getDailyById(deps.db, installationId, id);
  if (!record) throw notFound();
  return toOrgDaily(record, teamNames(record.login, teams));
}
