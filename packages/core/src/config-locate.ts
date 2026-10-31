import { isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';

export function locateConfigPath(
  source: string,
  path: string,
): { line: number; column: number } | null {
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter });
  if (doc.errors.length > 0) return null;
  let node: unknown = doc.contents;
  const segments = path === '' ? [] : path.split('.');
  for (const segment of segments) {
    if (isMap(node)) {
      const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === segment);
      if (!pair) return null;
      node = pair.value;
    } else if (isSeq(node)) {
      if (!/^\d+$/.test(segment)) return null;
      node = node.items[Number(segment)];
    } else {
      return null;
    }
  }
  if (!isNode(node) || !node.range) return null;
  const { line, col } = lineCounter.linePos(node.range[0]);
  return { line, column: col };
}
