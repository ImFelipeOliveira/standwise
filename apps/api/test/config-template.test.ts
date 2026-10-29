import { describe, expect, test } from 'bun:test';
import { parseConfig } from '@standwise/core';
import { standwiseYmlTemplate } from '../src/web/config-template';

describe('standwiseYmlTemplate', () => {
  test('sets the team language from the page language', () => {
    for (const lang of ['en', 'pt-BR'] as const) {
      const result = parseConfig(standwiseYmlTemplate('alice', 'Team', lang));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.config.teams[0]?.language).toBe(lang);
    }
  });
});
