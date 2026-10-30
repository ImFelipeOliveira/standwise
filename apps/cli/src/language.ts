import { type Language, negotiateLanguage } from '@standwise/core';

export function cliLanguage(env: Record<string, string | undefined>): Language {
  const raw = env.STANDWISE_LANG || env.LC_ALL || env.LANG || '';
  const tag = raw.split('.')[0]?.split('@')[0]?.replace(/_/g, '-') ?? '';
  return negotiateLanguage(tag);
}
