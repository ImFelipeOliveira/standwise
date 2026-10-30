export type CodeownersRule = { pattern: string; owners: string[] };

const OWNER = /^@[\w.-]+(?:\/[\w.-]+)?$/;

export function parseCodeowners(source: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const [pattern, ...tokens] = line.split(/\s+/);
    const owners = tokens.filter((o) => OWNER.test(o));
    if (pattern && owners.length > 0) rules.push({ pattern, owners });
  }
  return rules;
}

function escapeRegex(ch: string): string {
  return ch.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
}

function patternToRegex(pattern: string): RegExp {
  let body = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
  const anchored = body.startsWith('/') || body.includes('/');
  if (body.startsWith('/')) body = body.slice(1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch === '*') {
      if (body[i + 1] === '*') {
        if (body[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else {
      out += escapeRegex(ch);
    }
  }
  const prefix = anchored ? '^' : '^(?:.*/)?';
  return new RegExp(`${prefix}${out}(?:/.*)?$`);
}

function ownersForFile(compiled: { regex: RegExp; owners: string[] }[], file: string): string[] {
  const path = file.replace(/^\/+/, '');
  for (let i = compiled.length - 1; i >= 0; i--) {
    const rule = compiled[i];
    if (rule?.regex.test(path)) return rule.owners;
  }
  return [];
}

export function ownersForFiles(rules: CodeownersRule[], files: string[]): string[] {
  const compiled = rules.map((r) => ({ regex: patternToRegex(r.pattern), owners: r.owners }));
  const owners = new Set<string>();
  for (const file of files) {
    for (const owner of ownersForFile(compiled, file)) owners.add(owner);
  }
  return [...owners];
}
