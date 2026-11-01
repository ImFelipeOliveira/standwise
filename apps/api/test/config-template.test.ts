import { describe, expect, test } from 'bun:test';
import { parseConfig } from '@standcast/core';
import { standcastYmlTemplate } from '../src/web/config-template';

describe('standcastYmlTemplate', () => {
  test('sets the team language from the page language', () => {
    for (const lang of ['en', 'pt-BR'] as const) {
      const result = parseConfig(standcastYmlTemplate('alice', 'Team', lang));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.config.teams[0]?.language).toBe(lang);
    }
  });
});
