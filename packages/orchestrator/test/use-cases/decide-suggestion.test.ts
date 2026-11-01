import { describe, expect, test } from 'bun:test';
import {
  listPendingSuggestions,
  type MemberRow,
  setMemberInstallations,
  syncSuggestions,
} from '@standcast/db';
import { db, useCleanDb } from '../../../db/test/setup';
import { createMembershipCheck, DomainError, decideDraftSuggestion } from '../../src';
import { config, fakeDeps, INST, seedMember, seedOrg } from './fakes';

useCleanDb();

async function setup() {
  await seedOrg(config());
  const member = await seedMember();
  await setMemberInstallations(db, member.id, [INST]);
  const fake = fakeDeps();
  return { ...fake, member, isMember: createMembershipCheck(fake.deps) };
}

async function seedSuggestion(member: MemberRow, n = 1) {
  const { created } = await syncSuggestions(
    db,
    INST,
    member.id,
    [],
    [
      {
        kind: 'pr_no_review',
        ref: { kind: 'pull_request', url: `https://github.com/acme/api/pull/${n}` },
        fingerprint: `fp-${member.id}-${n}`,
        since: new Date('2026-10-26T00:00:00Z'),
      },
    ],
  );
  const [row] = created;
  if (!row) throw new Error('seed failed');
  return row;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof DomainError ? error.code : String(error);
  }
}

describe('decideDraftSuggestion', () => {
  test('ignoring a pending suggestion removes it from the pending list and is idempotent', async () => {
    const { deps, isMember, member } = await setup();
    const row = await seedSuggestion(member);
    await decideDraftSuggestion(deps, isMember, member, 'acme', row.id, 'ignored');
    expect(await listPendingSuggestions(db, INST, member.id)).toEqual([]);
    await decideDraftSuggestion(deps, isMember, member, 'acme', row.id, 'ignored');
  });

  test('another member suggestion or an unknown id is not_found', async () => {
    const { deps, isMember, member } = await setup();
    const bob = await seedMember('bob', 2);
    const foreign = await seedSuggestion(bob);
    expect(
      await codeOf(decideDraftSuggestion(deps, isMember, member, 'acme', foreign.id, 'ignored')),
    ).toBe('not_found');
    expect(
      await codeOf(
        decideDraftSuggestion(
          deps,
          isMember,
          member,
          'acme',
          '00000000-0000-4000-8000-000000000000',
          'confirmed',
        ),
      ),
    ).toBe('not_found');
    expect(await listPendingSuggestions(db, INST, bob.id)).toHaveLength(1);
  });

  test('a malformed id is not_found', async () => {
    const { deps, isMember, member } = await setup();
    expect(
      await codeOf(decideDraftSuggestion(deps, isMember, member, 'acme', 'nope', 'ignored')),
    ).toBe('not_found');
  });

  test('changing a decided suggestion is suggestion_already_decided', async () => {
    const { deps, isMember, member } = await setup();
    const row = await seedSuggestion(member);
    await decideDraftSuggestion(deps, isMember, member, 'acme', row.id, 'confirmed');
    expect(
      await codeOf(decideDraftSuggestion(deps, isMember, member, 'acme', row.id, 'ignored')),
    ).toBe('suggestion_already_decided');
  });

  test('a suggestion of the same member in another installation is not_found', async () => {
    const { deps, isMember, member } = await setup();
    await seedOrg(config(), { id: 12, accountLogin: 'globex' });
    const { created } = await syncSuggestions(
      db,
      12,
      member.id,
      [],
      [
        {
          kind: 'ci_failing',
          ref: { kind: 'pull_request', url: 'https://github.com/globex/api/pull/1' },
          fingerprint: 'fp-globex',
          since: new Date('2026-10-26T00:00:00Z'),
        },
      ],
    );
    const [other] = created;
    if (!other) throw new Error('seed failed');
    expect(
      await codeOf(decideDraftSuggestion(deps, isMember, member, 'acme', other.id, 'ignored')),
    ).toBe('not_found');
    expect(await listPendingSuggestions(db, 12, member.id)).toHaveLength(1);
  });
});
