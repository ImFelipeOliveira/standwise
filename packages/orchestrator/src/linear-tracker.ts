import {
  type ActivityItem,
  parseLinearIssueUrl,
  type Ref,
  type StandwiseConfig,
  type TeamConfig,
} from '@standwise/core';
import { getIdentityByLogin } from '@standwise/db';
import {
  getIssue,
  LinearAuthError,
  type LinearIssue,
  type LinearUser,
  listCardActivity,
  listStaleInProgress,
} from '@standwise/linear';
import type { Deps } from './deps';
import { type LinearAccess, type LinearAccessDeps, linearClientFor } from './linear-access';
import { logError } from './log-error';
import {
  type CardOwners,
  nullTracker,
  type ProjectTracker,
  type StaleCards,
} from './project-tracker';
import { configPeople, loginForLinearUser } from './tracker-identity';

export type TrackerDeps = LinearAccessDeps & Pick<Deps, 'github'>;

export type TrackerFor = (
  installationId: number,
  owner: string,
  config: StandwiseConfig,
  team: TeamConfig,
) => Promise<ProjectTracker>;

class LinearTracker implements ProjectTracker {
  readonly connected = true;
  private people: Promise<Set<string>> | null = null;

  constructor(
    private readonly deps: TrackerDeps,
    private readonly access: LinearAccess,
    private readonly installationId: number,
    private readonly owner: string,
    private readonly config: StandwiseConfig,
    private readonly teamKey: string,
  ) {}

  async cardOwners(ref: Ref): Promise<CardOwners | null> {
    const parsed = parseLinearIssueUrl(ref.url);
    if (!parsed) return null;
    if (parsed.workspace.toLowerCase() !== this.access.organization.urlKey.toLowerCase()) {
      return null;
    }
    const extra = { installationId: String(this.installationId) };
    let issue: LinearIssue | null;
    try {
      issue = await getIssue(this.access.client, parsed.identifier);
    } catch (error) {
      logError('linear card lookup failed', error, extra);
      if (error instanceof LinearAuthError) await this.invalidateQuietly();
      return null;
    }
    if (!issue) return null;
    try {
      const people = await this.resolvePeople();
      const loginFor = (user: LinearUser | null) =>
        user
          ? loginForLinearUser(this.deps, this.installationId, this.config, people, user)
          : Promise.resolve(null);
      const blockers: string[] = [];
      for (const blocker of issue.blockedBy) {
        const login = await loginFor(blocker.assignee);
        if (login && !blockers.includes(login)) blockers.push(login);
      }
      return {
        blockers,
        assignee: await loginFor(issue.assignee),
        creator: await loginFor(issue.creator),
      };
    } catch (error) {
      logError('tracker people resolution failed', error, extra);
      return null;
    }
  }

  async listActivity(login: string, since: Date): Promise<ActivityItem[]> {
    const userId = await this.linearUserId(login);
    if (!userId) return [];
    return this.guard(() =>
      listCardActivity(this.access.client, { userId, teamKey: this.teamKey, since }),
    );
  }

  async listStaleInProgress(login: string): Promise<StaleCards> {
    const userId = await this.linearUserId(login);
    if (!userId) return { cards: [], truncated: false };
    return this.guard(() =>
      listStaleInProgress(this.access.client, { userId, teamKey: this.teamKey }),
    );
  }

  private linearUserId(login: string): Promise<string | null> {
    return getIdentityByLogin(this.deps.db, this.installationId, 'linear', login);
  }

  private async guard<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof LinearAuthError) await this.invalidateQuietly();
      throw error;
    }
  }

  private async invalidateQuietly(): Promise<void> {
    try {
      await this.access.invalidate();
    } catch (failure) {
      logError('linear connection invalidation failed', failure, {
        installationId: String(this.installationId),
      });
    }
  }

  private resolvePeople(): Promise<Set<string>> {
    this.people ??= configPeople(this.deps, this.installationId, this.owner, this.config).catch(
      (error: unknown) => {
        this.people = null;
        throw error;
      },
    );
    return this.people;
  }
}

export function createTrackerFor(deps: TrackerDeps): TrackerFor {
  return async (installationId, owner, config, team) => {
    const tracker = team.tracker;
    if (tracker?.provider !== 'linear') return nullTracker;
    try {
      const access = await linearClientFor(deps, installationId);
      if (!access) return nullTracker;
      return new LinearTracker(deps, access, installationId, owner, config, tracker.team);
    } catch (error) {
      logError('linear tracker unavailable', error, { installationId: String(installationId) });
      return nullTracker;
    }
  };
}
