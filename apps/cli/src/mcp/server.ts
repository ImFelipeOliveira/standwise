import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import pkg from '../../../../package.json';
import type { Io } from '../io';
import { registerTools } from './tools';

const LANGUAGE_RULES =
  "Talk to the person in the person's language. Never translate or rewrite the text of the daily: every item goes exactly as the person said it or approved it.";

export const INSTRUCTIONS = [
  'Standwise helps a person write and send their daily standup to their teams.',
  'To write the daily: call standwise_get_draft, show the draft, ask what they will do today and whether anything blocks them, show the final daily and get their explicit confirmation. Only then call standwise_submit_daily with confirmed: true. Never submit a daily without explicit confirmation.',
  LANGUAGE_RULES,
  'The manager tools (standwise_list_teams, standwise_get_digest, standwise_list_dailies, standwise_list_blockers) exist to unblock the team: find blockers, get context and summarize what the team is doing. Standwise does not offer or encourage comparison, ranking or individual evaluation of people; decline those requests.',
].join('\n\n');

export function dailyPrompt(org?: string): string {
  const scope = org ? ` Use org "${org}" in every call.` : '';
  return [
    `Help me write and send my daily standup with Standwise.${scope}`,
    '1. Call standwise_get_draft and show me the draft of what I did yesterday. I can add, remove or edit items.',
    '2. Ask me what I will do today and whether anything is blocking me.',
    '3. Show me the final daily (yesterday, today, blockers) and ask for my explicit confirmation. Do not assume it.',
    '4. Only after I explicitly confirm, call standwise_submit_daily with confirmed: true and tell me the result.',
    LANGUAGE_RULES,
  ].join('\n');
}

export function createMcpServer(io: Io): McpServer {
  const server = new McpServer(
    { name: 'standwise', version: pkg.version },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, io);
  server.registerPrompt(
    'daily',
    {
      title: 'Write my daily',
      description: 'Builds the daily from the draft, asks for confirmation and submits it.',
      argsSchema: { org: z.string().optional().describe('Organization login.') },
    },
    ({ org }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: dailyPrompt(org) } }],
    }),
  );
  return server;
}
