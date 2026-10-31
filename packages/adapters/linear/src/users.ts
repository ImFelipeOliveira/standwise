import { z } from 'zod';
import type { LinearClient } from './client';

export type LinearUser = { id: string; email: string | null };
export type LinearOrganization = { id: string; name: string; urlKey: string };

const userNode = z.object({ id: z.string().min(1), email: z.string().nullish() });

export function toUser(node: unknown): LinearUser | null {
  const parsed = userNode.safeParse(node);
  if (!parsed.success) return null;
  return { id: parsed.data.id, email: parsed.data.email ?? null };
}

const ORGANIZATION_QUERY = `query Organization { organization { id name urlKey } }`;

const USER_BY_EMAIL_QUERY = `query UserByEmail($email: String!) {
  users(filter: { email: { eq: $email } }, first: 1) { nodes { id email } }
}`;

const organizationSchema = z.object({
  organization: z.object({ id: z.string(), name: z.string(), urlKey: z.string() }),
});

export async function getOrganization(client: LinearClient): Promise<LinearOrganization> {
  const data = await client.query<unknown>(ORGANIZATION_QUERY, {});
  const parsed = organizationSchema.safeParse(data);
  if (!parsed.success) throw new Error('linear invalid organization response');
  return parsed.data.organization;
}

export async function findUserByEmail(
  client: LinearClient,
  email: string,
): Promise<LinearUser | null> {
  const data = await client.query<{ users?: { nodes?: unknown[] } } | null>(USER_BY_EMAIL_QUERY, {
    email,
  });
  for (const node of data?.users?.nodes ?? []) {
    const user = toUser(node);
    if (user) return user;
  }
  return null;
}
