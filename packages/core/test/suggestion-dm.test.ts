import { describe, expect, test } from 'bun:test';
import { buildSuggestionDm } from '../src/suggestion-dm';

const ref = {
  kind: 'pull_request' as const,
  url: 'https://github.com/acme/api/pull/7',
  title: 'Add cache',
};

describe('buildSuggestionDm', () => {
  test('english pr_no_review names the PR, the hours and links it', () => {
    const msg = buildSuggestionDm({ lang: 'en', kind: 'pr_no_review', ref, hours: 48 });
    expect(msg.fallbackText).toContain('Suggestions just for you');
    expect(msg.fallbackText).toContain('Add cache');
    expect(msg.fallbackText).toContain('48h');
    expect(msg.fallbackText).toContain(ref.url);
  });

  test('portuguese ci_failing uses the pt-BR copy', () => {
    const msg = buildSuggestionDm({ lang: 'pt-BR', kind: 'ci_failing', ref, hours: 24 });
    expect(msg.fallbackText).toContain('Sugestões só para você');
    expect(msg.fallbackText).toContain('24h');
  });

  test('falls back to the url when the ref has no title', () => {
    const msg = buildSuggestionDm({
      lang: 'en',
      kind: 'pr_no_review',
      ref: { kind: 'pull_request', url: ref.url },
      hours: 48,
    });
    expect(msg.fallbackText).toContain(`The PR ${ref.url}`);
  });

  test('does not mention managers or the team', () => {
    const msg = buildSuggestionDm({ lang: 'en', kind: 'ci_failing', ref, hours: 24 });
    expect(msg.fallbackText.toLowerCase()).not.toContain('manager');
    expect(msg.fallbackText.toLowerCase()).not.toContain('team');
  });
});
