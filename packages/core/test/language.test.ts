import { describe, expect, test } from 'bun:test';
import { negotiateLanguage } from '../src/language';

describe('negotiateLanguage', () => {
  test('defaults to en', () => {
    expect(negotiateLanguage(undefined)).toBe('en');
    expect(negotiateLanguage('')).toBe('en');
    expect(negotiateLanguage('fr-FR,de;q=0.8')).toBe('en');
  });

  test('maps pt and pt-* to pt-BR', () => {
    expect(negotiateLanguage('pt')).toBe('pt-BR');
    expect(negotiateLanguage('pt-PT')).toBe('pt-BR');
  });

  test('maps en and en-* to en', () => {
    expect(negotiateLanguage('en')).toBe('en');
    expect(negotiateLanguage('en-US,en;q=0.9')).toBe('en');
  });

  test('honours q-values', () => {
    expect(negotiateLanguage('pt-BR;q=0.5,en;q=0.9')).toBe('en');
    expect(negotiateLanguage('en;q=0,pt;q=0.1')).toBe('pt-BR');
    expect(negotiateLanguage('fr,en;q=0.4')).toBe('en');
  });
});
