import type { ActivityItem, CardSnapshot, Ref } from '@standwise/core';

export type CardOwners = { blockers: string[]; assignee: string | null; creator: string | null };

export interface ProjectTracker {
  readonly connected: boolean;
  cardOwners(ref: Ref): Promise<CardOwners | null>;
  listActivity(login: string, since: Date): Promise<ActivityItem[]>;
  listStaleInProgress(login: string): Promise<CardSnapshot[]>;
}

export const nullTracker: ProjectTracker = {
  connected: false,
  cardOwners: async () => null,
  listActivity: async () => [],
  listStaleInProgress: async () => [],
};
