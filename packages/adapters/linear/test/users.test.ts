import { expect, test } from 'bun:test';
import { createLinearClient, findUserByEmail, getOrganization } from '../src';
import { fakeFetch } from './helpers';

test('getOrganization maps the organization', async () => {
  const f = fakeFetch({
    body: '{"data":{"organization":{"id":"o1","name":"Acme","urlKey":"acme"}}}',
  });
  expect(await getOrganization(createLinearClient('t', f.fetch))).toEqual({
    id: 'o1',
    name: 'Acme',
    urlKey: 'acme',
  });
});

test('getOrganization rejects malformed data', async () => {
  const f = fakeFetch({ body: '{"data":{"organization":{"id":1}}}' });
  await expect(getOrganization(createLinearClient('t', f.fetch))).rejects.toThrow();
});

test('findUserByEmail passes the email as a variable', async () => {
  const f = fakeFetch({ body: '{"data":{"users":{"nodes":[{"id":"u1","email":"a@x.com"}]}}}' });
  const user = await findUserByEmail(createLinearClient('t', f.fetch), 'a@x.com" } }) {');
  expect(user).toEqual({ id: 'u1', email: 'a@x.com' });
  const sent = JSON.parse(f.calls[0]?.body ?? '');
  expect(sent.variables).toEqual({ email: 'a@x.com" } }) {' });
  expect(sent.query).not.toContain('a@x.com');
});

test('findUserByEmail returns null when none or malformed', async () => {
  const none = fakeFetch({ body: '{"data":{"users":{"nodes":[]}}}' });
  expect(await findUserByEmail(createLinearClient('t', none.fetch), 'a@x.com')).toBeNull();
  const bad = fakeFetch({ body: '{"data":{"users":{"nodes":[{"nope":1}]}}}' });
  expect(await findUserByEmail(createLinearClient('t', bad.fetch), 'a@x.com')).toBeNull();
});
