export type CodeownersRule = { pattern: string; owners: string[] };

const OWNER = /^@[\w.-]+(?:\/[\w.-]+)?$/;

function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) return line.slice(0, i);
  }
  return line;
}

export function parseCodeowners(source: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    const [pattern, ...tokens] = line.split(/\s+/);
    const owners = tokens.filter((o) => OWNER.test(o));
    if (pattern) rules.push({ pattern, owners });
  }
  return rules;
}

const MAX_PATTERN_LENGTH = 255;

type CompiledRule = {
  segments: string[];
  dirOnly: boolean;
  coversContents: boolean;
  owners: string[];
};

function compileRule(rule: CodeownersRule): CompiledRule | null {
  if (rule.pattern.length > MAX_PATTERN_LENGTH) return null;
  const dirOnly = rule.pattern.endsWith('/');
  let body = dirOnly ? rule.pattern.slice(0, -1) : rule.pattern;
  const leadingSlash = body.startsWith('/');
  if (leadingSlash) body = body.slice(1);
  if (body === '') return null;
  const anchored = leadingSlash || body.includes('/');
  const segments = body.split('/').filter((seg) => seg !== '');
  if (segments.length === 0) return null;
  if (!anchored) segments.unshift('**');
  const last = segments[segments.length - 1] as string;
  const coversContents = !anchored || last === '**' || !last.includes('*');
  return { segments, dirOnly, coversContents, owners: rule.owners };
}

function matchSegment(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === '*') {
      star = p;
      mark = t;
      p++;
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p++;
      t++;
    } else if (star !== -1) {
      p = star + 1;
      mark++;
      t = mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

function matches(rule: CompiledRule, path: string[]): boolean {
  const m = rule.segments.length;
  const n = path.length;
  const visited = new Uint8Array((m + 1) * (n + 1));
  const stack: number[] = [0, 0];
  let fileMatch = false;
  let dirMatch = false;
  const record = (end: number) => {
    if (end === n) fileMatch = true;
    else if (end >= 1) dirMatch = true;
  };
  const push = (i: number, j: number) => {
    const key = i * (n + 1) + j;
    if (visited[key]) return;
    visited[key] = 1;
    stack.push(i, j);
  };
  visited[0] = 1;
  while (stack.length > 0) {
    const j = stack.pop() as number;
    const i = stack.pop() as number;
    if (i === m) {
      record(j);
      continue;
    }
    const seg = rule.segments[i] as string;
    if (seg === '**') {
      if (i === m - 1) {
        if (j < n) record(n);
        continue;
      }
      push(i + 1, j);
      if (j < n) push(i, j + 1);
      continue;
    }
    if (j < n && matchSegment(seg, path[j] as string)) push(i + 1, j + 1);
  }
  if (rule.dirOnly) return dirMatch;
  return fileMatch || (dirMatch && rule.coversContents);
}

export function ownersForFiles(rules: CodeownersRule[], files: string[]): string[] {
  const compiled = rules.map(compileRule).filter((r): r is CompiledRule => r !== null);
  const owners = new Set<string>();
  for (const file of files) {
    const path = file.split('/').filter((seg) => seg !== '');
    for (let i = compiled.length - 1; i >= 0; i--) {
      const rule = compiled[i] as CompiledRule;
      if (matches(rule, path)) {
        for (const owner of rule.owners) owners.add(owner);
        break;
      }
    }
  }
  return [...owners];
}
