import type { Ref } from '@standwise/core';

export interface ProjectTracker {
  blockingAssignee(installationId: number, ref: Ref): Promise<string | null>;
}

export const nullTracker: ProjectTracker = {
  blockingAssignee: async () => null,
};
