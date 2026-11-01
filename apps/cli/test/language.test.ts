import { describe, expect, test } from 'bun:test';
import { cliLanguage } from '../src/language';

describe('cliLanguage', () => {
  test('defaults to en', () => {
    expect(cliLanguage({})).toBe('en');
    expect(cliLanguage({ LANG: 'C' })).toBe('en');
    expect(cliLanguage({ LC_ALL: 'POSIX' })).toBe('en');
    expect(cliLanguage({ LANG: 'fr_FR.UTF-8' })).toBe('en');
  });

  test('maps locale names', () => {
    expect(cliLanguage({ LANG: 'pt_BR.UTF-8' })).toBe('pt-BR');
    expect(cliLanguage({ LANG: 'en_US.UTF-8' })).toBe('en');
    expect(cliLanguage({ LANG: 'en' })).toBe('en');
  });

  test('STANDCAST_LANG wins over LC_ALL and LANG', () => {
    expect(cliLanguage({ STANDCAST_LANG: 'en', LC_ALL: 'pt_BR.UTF-8', LANG: 'pt_BR.UTF-8' })).toBe(
      'en',
    );
    expect(cliLanguage({ STANDCAST_LANG: 'pt-BR', LANG: 'en_US.UTF-8' })).toBe('pt-BR');
  });

  test('LC_ALL wins over LANG', () => {
    expect(cliLanguage({ LC_ALL: 'en_US.UTF-8', LANG: 'pt_BR.UTF-8' })).toBe('en');
  });
});
