import { z } from 'zod';
import type { LinearClient } from './client';
import { LinearGraphqlError } from './errors';
import { type LinearUser, toUser } from './users';

export type LinearIssue = {
  id: string;
  identifier: string;
  url: string;
  title: string;
  assignee: LinearUser | null;
  creator: LinearUser | null;
  blockedBy: { identifier: string; assignee: LinearUser | null }[];
};

const ISSUE_QUERY = `query Issue($identifier: String!) {
  issue(id: $identifier) {
    id
    identifier
    url
    title
    assignee { id email }
    creator { id email }
    inverseRelations(first: 50) {
      nodes {
        type
        issue { identifier assignee { id email } }
      }
    }
  }
}`;

const issueNode = z.object({
  id: z.string().min(1),
  identifier: z.string().min(1),
  url: z.string().min(1),
  title: z.string(),
  assignee: z.unknown().nullish(),
  creator: z.unknown().nullish(),
  inverseRelations: z.object({ nodes: z.array(z.unknown()) }).nullish(),
});

const relationNode = z.object({
  type: z.string(),
  issue: z.object({ identifier: z.string().min(1), assignee: z.unknown().nullish() }),
});

function isNotFound(e: unknown): boolean {
  if (!(e instanceof LinearGraphqlError)) return false;
  const pattern = /entity not found|could not find/i;
  return pattern.test(e.rawMessage) || pattern.test(e.userPresentableMessage ?? '');
}

export async function getIssue(
  client: LinearClient,
  identifier: string,
): Promise<LinearIssue | null> {
  let data: { issue?: unknown } | null;
  try {
    data = await client.query<{ issue?: unknown } | null>(ISSUE_QUERY, { identifier });
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  if (!data?.issue) return null;
  const parsed = issueNode.safeParse(data.issue);
  if (!parsed.success) return null;
  const node = parsed.data;
  const blockedBy: LinearIssue['blockedBy'] = [];
  for (const raw of node.inverseRelations?.nodes ?? []) {
    const rel = relationNode.safeParse(raw);
    if (!rel.success || rel.data.type !== 'blocks') continue;
    blockedBy.push({
      identifier: rel.data.issue.identifier,
      assignee: toUser(rel.data.issue.assignee),
    });
  }
  return {
    id: node.id,
    identifier: node.identifier,
    url: node.url,
    title: node.title,
    assignee: toUser(node.assignee),
    creator: toUser(node.creator),
    blockedBy,
  };
}
