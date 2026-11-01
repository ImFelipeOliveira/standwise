import { pruneData, type WorkerDeps } from '@standcast/orchestrator';

export function pruneDataJob(deps: WorkerDeps): () => Promise<void> {
  return async () => {
    await pruneData(deps);
  };
}
