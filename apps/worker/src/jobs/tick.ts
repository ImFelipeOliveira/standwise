import { runTick, type WorkerDeps } from '@standwise/orchestrator';

export function tickJob(deps: WorkerDeps): () => Promise<void> {
  return () => runTick(deps);
}
