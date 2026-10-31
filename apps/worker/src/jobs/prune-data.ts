import { pruneData, type WorkerDeps } from '@standwise/orchestrator';

export function pruneDataJob(deps: WorkerDeps): () => Promise<void> {
  return async () => {
    await pruneData(deps);
  };
}
