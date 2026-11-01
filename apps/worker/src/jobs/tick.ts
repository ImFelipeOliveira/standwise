import { runTick, type WorkerDeps } from '@standcast/orchestrator';

export function tickJob(deps: WorkerDeps): () => Promise<void> {
  return () => runTick(deps);
}
