import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { type Ctx, EXIT } from '../io';
import { createMcpServer } from '../mcp/server';

type Id = string | number;

const EOF_GRACE_MS = 5000;

const requestId = (message: JSONRPCMessage): Id | undefined =>
  'id' in message && 'method' in message ? message.id : undefined;

const responseId = (message: JSONRPCMessage): Id | undefined =>
  'id' in message && !('method' in message) ? (message.id ?? undefined) : undefined;

export async function mcp(ctx: Ctx): Promise<number> {
  const server = createMcpServer(ctx.io);
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
  server.server.onerror = (error) => ctx.io.stderr(`mcp error: ${error.message}\n`);
  await server.connect(transport);

  const pending = new Set<Id>();
  let ended = false;
  const closeWhenIdle = () => {
    if (ended && pending.size === 0) server.close().catch(() => undefined);
  };
  const receive = transport.onmessage;
  transport.onmessage = (message: JSONRPCMessage) => {
    const id = requestId(message);
    if (id !== undefined) pending.add(id);
    receive?.(message);
  };
  const send = transport.send.bind(transport);
  transport.send = async (message: JSONRPCMessage) => {
    await send(message);
    const id = responseId(message);
    if (id !== undefined && pending.delete(id)) closeWhenIdle();
  };
  process.stdin.once('end', () => {
    ended = true;
    closeWhenIdle();
    setTimeout(() => {
      server.close().catch(() => undefined);
    }, EOF_GRACE_MS);
  });

  await closed;
  return EXIT.ok;
}
