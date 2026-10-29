import { describe, expect, test } from 'bun:test';
import { cliLanguage } from '../src/language';

describe('cliLanguage', () => {
  test('defaults to pt-BR', () => {
    expect(cliLanguage({})).toBe('pt-BR');
    expect(cliLanguage({ LANG: 'C' })).toBe('pt-BR');
    expect(cliLanguage({ LANG: 'fr_FR.UTF-8' })).toBe('pt-BR');
  });

  test('maps locale names', () => {
    expect(cliLanguage({ LANG: 'pt_BR.UTF-8' })).toBe('pt-BR');
    expect(cliLanguage({ LANG: 'en_US.UTF-8' })).toBe('en');
    expect(cliLanguage({ LANG: 'en' })).toBe('en');
  });

  test('STANDWISE_LANG wins over LC_ALL and LANG', () => {
    expect(cliLanguage({ STANDWISE_LANG: 'en', LC_ALL: 'pt_BR.UTF-8', LANG: 'pt_BR.UTF-8' })).toBe(
      'en',
    );
    expect(cliLanguage({ STANDWISE_LANG: 'pt-BR', LANG: 'en_US.UTF-8' })).toBe('pt-BR');
  });

  test('LC_ALL wins over LANG', () => {
    expect(cliLanguage({ LC_ALL: 'en_US.UTF-8', LANG: 'pt_BR.UTF-8' })).toBe('en');
  });
});
