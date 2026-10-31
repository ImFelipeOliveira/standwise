import { describe, expect, test } from 'bun:test';
import type { Message } from '@standwise/core';
import {
  claimDelivery,
  createApiKey,
  createSession,
  decideSuggestion,
  failDelivery,
  insertWebhookEndpoint,
  setIdentity,
  setMemberInstallations,
  syncSuggestions,
  WEBHOOK_EVENTS,
} from '@standwise/db';
import { createMembershipCheck, sendDigest, submitDaily } from '@standwise/orchestrator';
import { sql } from 'drizzle-orm';
import { db, useCleanDb } from '../../../packages/db/test/setup';
import {
  config,
  daily,
  fakeChat,
  fakeDeps,
  INST,
  seedMember,
  seedOrg,
} from '../../../packages/orchestrator/test/use-cases/fakes';
import { createApp } from '../src/app';

useCleanDb();

const DATE = '2026-10-28';
const PENDING_URL = 'https://github.com/acme/api/pull/1';
const SUBMITTED_URL = 'https://github.com/acme/api/pull/2';
const PENDING_ONLY = [
  PENDING_URL,
  'https://github.com/acme/api/pull/3alice',
  'https://github.com/acme/api/pull/4alice',
  'https://github.com/acme/api/pull/3bob',
  'https://github.com/acme/api/pull/4bob',
  'Pull alice 1',
  'Pull bob 1',
];

type Seeded = { id: string; fingerprint: string };

async function seedSuggestions(memberId: string, prefix: string): Promise<Seeded[]> {
  const signal = (n: number, url: string, kind: 'pr_no_review' | 'ci_failing') => ({
    kind,
    ref: { kind: 'pull_request' as const, url, title: `Pull ${prefix} ${n}` },
    fingerprint: `${prefix}-fingerprint-${n}`,
    since: new Date('2026-10-25T00:00:00Z'),
  });
  const { created } = await syncSuggestions(
    db,
    INST,
    memberId,
    [],
    [
      signal(1, PENDING_URL, 'pr_no_review'),
      signal(2, SUBMITTED_URL, 'ci_failing'),
      signal(3, `https://github.com/acme/api/pull/3${prefix}`, 'ci_failing'),
      signal(4, `https://github.com/acme/api/pull/4${prefix}`, 'pr_no_review'),
    ],
  );
  const byFingerprint = (n: number) => {
    const row = created.find((c) => c.fingerprint === `${prefix}-fingerprint-${n}`);
    if (!row) throw new Error('seed failed');
    return row;
  };
  await decideSuggestion(db, INST, memberId, byFingerprint(3).id, 'ignored');
  await decideSuggestion(db, INST, memberId, byFingerprint(4).id, 'confirmed');
  return created.map((c) => ({ id: c.id, fingerprint: c.fingerprint }));
}

function expectNoLeak(label: string, output: unknown, seeded: Seeded[]): void {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  expect(text.length, label).toBeGreaterThan(0);
  for (const s of seeded) {
    expect(text.includes(s.id), `${label} leaks suggestion id`).toBe(false);
    expect(text.includes(s.fingerprint), `${label} leaks fingerprint`).toBe(false);
  }
  expect(text.includes('pr_no_review'), `${label} leaks pr_no_review`).toBe(false);
  expect(text.includes('ci_failing'), `${label} leaks ci_failing`).toBe(false);
  for (const fragment of PENDING_ONLY) {
    expect(text.includes(fragment), `${label} leaks ${fragment}`).toBe(false);
  }
}

async function setup() {
  await seedOrg(config('[alice, bob]'));
  const alice = await seedMember();
  const bob = await seedMember('bob', 2);
  await setMemberInstallations(db, alice.id, [INST]);
  await setIdentity(db, INST, alice.id, 'slack', 'UALICE');
  await insertWebhookEndpoint(
    db,
    {
      installationId: INST,
      url: 'https://hooks.example.com/',
      events: [...WEBHOOK_EVENTS],
      secret: 'whsec_x',
    },
    new Uint8Array(32).fill(7),
  );
  const seeded = [
    ...(await seedSuggestions(alice.id, 'alice')),
    ...(await seedSuggestions(bob.id, 'bob')),
  ];
  const failedKey = {
    installationId: INST,
    teamName: '',
    date: DATE,
    kind: 'suggestion_dm' as const,
    subject: `${alice.id}:alice-fingerprint-1`,
  };
  const claim = await claimDelivery(db, failedKey);
  if (claim.status !== 'claimed') throw new Error('claim failed');
  await failDelivery(db, failedKey, claim.token, 'no_chat_identity');
  const fake = fakeDeps();
  fake.roles.set('alice', { role: 'admin', state: 'active' });
  return { ...fake, alice, bob, seeded };
}

describe('suggestions never leak outside the person', () => {
  test('org and manage routes, webhooks, the digest and the setup page carry no suggestion', async () => {
    const { deps, alice, seeded } = await setup();
    const isMember = createMembershipCheck(deps);
    await submitDaily(deps, isMember, alice, {
      ...daily,
      blockers: [
        {
          text: 'Waiting on review of the retry PR',
          ref: { kind: 'pull_request', url: SUBMITTED_URL },
        },
      ],
    });
    const chat = fakeChat();
    await sendDigest(
      { ...deps, chatFor: async () => chat.chat },
      { installationId: INST, teamName: 'Alpha', date: DATE },
    );
    expect(chat.posted).toHaveLength(1);
    const digest: Message | undefined = chat.posted[0]?.msg;
    expectNoLeak('digest message', digest, seeded);

    const envelopes = (await db.execute(
      sql`SELECT event, payload FROM webhook_deliveries ORDER BY created_at`,
    )) as unknown as { event: string; payload: unknown }[];
    expect(new Set(envelopes.map((e) => e.event))).toEqual(
      new Set(['daily.submitted', 'blocker.opened', 'digest.sent']),
    );
    for (const envelope of envelopes) {
      expectNoLeak(`webhook ${envelope.event}`, envelope.payload, seeded);
    }

    const app = createApp(deps, { getClientIp: () => '192.0.2.1' });
    const routes = [
      ...new Set(
        app.routes
          .filter((r) => r.method !== 'ALL')
          .filter((r) => r.path.startsWith('/v1/org/') || r.path.startsWith('/v1/manage/'))
          .map((r) => `${r.method} ${r.path}`),
      ),
    ].sort();
    expect(routes).toEqual([
      'GET /v1/manage/blockers',
      'GET /v1/manage/dailies',
      'GET /v1/manage/digests',
      'GET /v1/manage/teams',
      'GET /v1/org/blockers',
      'GET /v1/org/dailies',
      'GET /v1/org/dailies/:id',
      'GET /v1/org/digests',
      'GET /v1/org/teams',
    ]);
    const submitted = envelopes.find((e) => e.event === 'daily.submitted')?.payload as
      | { data: { id: string } }
      | undefined;
    if (!submitted) throw new Error('daily not submitted');
    const key = await createApiKey(db, {
      installationId: INST,
      name: 'leak',
      scopes: ['teams:read', 'dailies:read', 'digests:read', 'blockers:read'],
      createdBy: alice.id,
    });
    const session = await createSession(db, alice.id, 'cli');
    for (const route of routes) {
      const [method = 'GET', template = ''] = route.split(' ');
      const path = template.replace(':id', submitted.data.id);
      const token = template.startsWith('/v1/org/') ? key.key : session;
      const res = await app.request(`${path}?org=acme&team=Alpha`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify({ org: 'acme', team: 'Alpha' }) }),
      });
      const body = await res.text();
      expect(res.status, `${route} ${body}`).toBe(200);
      expectNoLeak(route, body, seeded);
    }
    const blockers = await app.request('/v1/org/blockers?team=Alpha', {
      headers: { authorization: `Bearer ${key.key}` },
    });
    expect(await blockers.text()).toContain(SUBMITTED_URL);

    const web = await createSession(db, alice.id, 'web');
    const page = await app.request(`/setup?installation_id=${INST}`, {
      headers: { cookie: `sw_web=${web}`, 'accept-language': 'en' },
    });
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('acme');
    expectNoLeak('setup page', html, seeded);
    expect(html).not.toContain('no_chat_identity');
  });
});
