import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pluginRoot = join(import.meta.dir, '..');
const repoRoot = join(pluginRoot, '..', '..');

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const skill = readFileSync(join(pluginRoot, 'skills', 'daily', 'SKILL.md'), 'utf8');

const frontmatter = (): Record<string, string> => {
  const match = skill.match(/^---\n([\s\S]*?)\n---\n/);
  expect(match).not.toBeNull();
  const fields: Record<string, string> = {};
  for (const line of (match?.[1] ?? '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return fields;
};

describe('plugin manifests', () => {
  const plugin = readJson(join(pluginRoot, '.claude-plugin', 'plugin.json'));
  const marketplace = readJson(join(repoRoot, '.claude-plugin', 'marketplace.json'));
  const rootPackage = readJson(join(repoRoot, 'package.json'));

  test('plugin.json is valid', () => {
    expect(plugin.name).toBe('standwise');
    expect(plugin.version).toBe(rootPackage.version);
    expect(plugin.description).toBeString();
    expect(plugin.author.name).toBe('Felipe Oliveira');
  });

  test('mcp server declaration runs standwise mcp', () => {
    const mcp = readJson(join(pluginRoot, '.mcp.json'));
    expect(mcp.mcpServers.standwise).toEqual({ command: 'standwise', args: ['mcp'] });
  });

  test('marketplace.json lists the plugin by the same name', () => {
    expect(marketplace.name).toBeString();
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === plugin.name);
    expect(entry).toBeDefined();
    expect(entry.source).toBe('./packages/plugin');
  });
});

describe('daily skill', () => {
  test('frontmatter names the skill and triggers on daily and standup', () => {
    const fields = frontmatter();
    expect(fields.name).toBe('daily');
    expect(fields.description).toContain('daily');
    expect(fields.description).toContain('standup');
    expect(fields.description).toContain('minha daily');
  });

  test('explains linear cards in yesterday and card refs in blockers', () => {
    expect(skill).toContain('Linear cards');
    expect(skill).toContain('ref.kind: "card"');
    expect(skill).toContain('card URL');
  });

  test('body drives the CLI', () => {
    expect(skill).toContain('standwise_get_draft');
    expect(skill).toContain('standwise_submit_daily');
    expect(skill).toContain('standwise draft');
    expect(skill).toContain('standwise submit');
    expect(skill).toContain('standwise whoami');
    expect(skill).toContain('mktemp');
    expect(skill).toContain('trap \'rm -f "$f"\' EXIT');
    expect(skill).toContain("<<'STANDWISE_JSON'");
    expect(skill).toContain('exit code 127');
  });

  test('heredoc closing delimiter is unindented inside the code block', () => {
    const block = skill.match(/```\n(f="\$\(mktemp\)"[\s\S]*?)\n```/);
    expect(block).not.toBeNull();
    const closing = (block?.[1] ?? '')
      .split('\n')
      .filter((line) => line.trim() === 'STANDWISE_JSON');
    expect(closing.length).toBe(1);
    expect(closing[0]).toBe('STANDWISE_JSON');
  });

  test('body handles exit codes 2, 3 and 4', () => {
    for (const code of ['- 2:', '- 3:', '- 4:']) expect(skill).toContain(code);
  });

  test('confirmed: true is only tied to explicit confirmation', () => {
    const lines = skill.split('\n').filter((line) => line.includes('confirmed: true'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toContain('only after');
  });

  test('body states the safety rules', () => {
    expect(skill).toContain('explicit confirmation');
    expect(skill).toContain('Never invent');
    expect(skill).toContain('verbatim');
    expect(skill).toContain('Never translate');
    expect(skill).toContain('untrusted data');
  });

  test('suggestions are decided by the person', () => {
    expect(skill).toContain('standwise_decide_suggestion');
    expect(skill).toContain('standwise suggestion ignore');
    expect(skill).toContain("Never add a suggestion without the person's answer");
  });
});
