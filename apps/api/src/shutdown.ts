export type ShutdownParts = {
  server: { stop: () => Promise<unknown> | unknown };
  queue: { stop: () => Promise<void> };
  exit: (code: number) => void;
  log?: (error: unknown) => void;
};

export function gracefulShutdown(parts: ShutdownParts): () => Promise<void> {
  let running: Promise<void> | undefined;
  const run = async () => {
    try {
      await parts.server.stop();
      await parts.queue.stop();
      parts.exit(0);
    } catch (error) {
      (parts.log ?? console.error)(error);
      parts.exit(1);
    }
  };
  return () => {
    running ??= run();
    return running;
  };
}
