import { expect, test } from 'bun:test';
import { createLinearClient, getIssue } from '../src';
import { fakeFetch, fixture } from './helpers';

test('maps assignee, creator and only blocks relations as blockers', async () => {
  const f = fakeFetch({ body: fixture('issue.json') });
  const issue = await getIssue(createLinearClient('t', f.fetch), 'ENG-12');
  expect(issue).toEqual({
    id: 'i1',
    identifier: 'ENG-12',
    url: 'https://linear.app/acme/issue/ENG-12/fix',
    title: 'Fix login',
    assignee: { id: 'u1', email: 'a@x.com' },
    creator: { id: 'u2', email: null },
    blockedBy: [
      { identifier: 'ENG-3', assignee: { id: 'u3', email: 'c@x.com' } },
      { identifier: 'ENG-5', assignee: null },
    ],
  });
});

test('sends the identifier as a variable, never in the query text', async () => {
  const f = fakeFetch({ body: fixture('issue.json') });
  await getIssue(createLinearClient('t', f.fetch), 'ENG-12');
  const sent = JSON.parse(f.calls[0]?.body ?? '');
  expect(sent.variables).toEqual({ identifier: 'ENG-12' });
  expect(sent.query).not.toContain('ENG-12');
});

test('entity not found gives null', async () => {
  const f = fakeFetch({ body: fixture('issue-not-found.json') });
  expect(await getIssue(createLinearClient('t', f.fetch), 'ENG-999')).toBeNull();
});

test('null issue or malformed node gives null', async () => {
  const a = fakeFetch({ body: '{"data":{"issue":null}}' });
  expect(await getIssue(createLinearClient('t', a.fetch), 'ENG-1')).toBeNull();
  const b = fakeFetch({ body: '{"data":{"issue":{"id":"x"}}}' });
  expect(await getIssue(createLinearClient('t', b.fetch), 'ENG-1')).toBeNull();
});

test('other errors propagate', async () => {
  const f = fakeFetch({ status: 401, body: '{}' });
  await expect(getIssue(createLinearClient('t', f.fetch), 'ENG-1')).rejects.toThrow();
});
