import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const LOCALE = 'pt-BR';
const DESCRIPTION = 'O Standwise orquestra a daily do seu time, do GitHub ao Slack.';

function titleOf(markdown: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  return heading?.[1]?.trim() ?? fallback;
}

export async function writeLocaleLlms(outDir: string, domain: string): Promise<void> {
  const dir = join(outDir, LOCALE);
  const entries = await readdir(dir, { recursive: true });
  const pages = entries.filter((entry) => entry.endsWith('.md')).sort();
  const sections: string[] = [];
  const links: string[] = [];
  for (const page of pages) {
    const markdown = await readFile(join(dir, page), 'utf8');
    links.push(`- [${titleOf(markdown, page)}](${domain}/${LOCALE}/${page})`);
    sections.push(markdown.trim());
  }
  const index = `# Standwise\n\n> ${DESCRIPTION}\n\n## Sumário\n\n${links.join('\n')}\n`;
  const full = `${sections.join('\n\n---\n\n')}\n`;
  await mkdir(dirname(join(dir, 'llms.txt')), { recursive: true });
  await writeFile(join(dir, 'llms.txt'), index);
  await writeFile(join(dir, 'llms-full.txt'), full);
}
