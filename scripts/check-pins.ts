import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FULL_SHA = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST = /@sha256:[0-9a-f]{64}$/;

export function checkWorkflow(text: string): string[] {
  const errors: string[] = [];
  text.split('\n').forEach((line, index) => {
    const match = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)/);
    if (match === null) return;
    const ref = match[1] ?? '';
    if (ref.startsWith('./') || ref.startsWith('docker://')) return;
    const version = ref.split('@')[1] ?? '';
    if (!FULL_SHA.test(version)) {
      errors.push(`line ${index + 1}: action ${ref} must be pinned to a 40-character commit sha`);
    }
  });
  return errors;
}

export function checkDockerfile(text: string): string[] {
  const errors: string[] = [];
  const stages = new Set<string>();
  text.split('\n').forEach((line, index) => {
    const match = line.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i);
    if (match === null) return;
    const image = match[1] ?? '';
    const isStage = stages.has(image);
    if (match[2] !== undefined) stages.add(match[2]);
    if (isStage || image === 'scratch') return;
    if (!IMAGE_DIGEST.test(image)) {
      errors.push(`line ${index + 1}: image ${image} must be pinned with @sha256:<digest>`);
    }
  });
  text.split('\n').forEach((line, index) => {
    const match = line.match(/^\s*COPY\s+.*--from=(\S+)/i);
    const source = match?.[1];
    if (source === undefined || stages.has(source) || /^\d+$/.test(source)) return;
    if (!IMAGE_DIGEST.test(source)) {
      errors.push(`line ${index + 1}: image ${source} must be pinned with @sha256:<digest>`);
    }
  });
  return errors;
}

export function checkCompose(text: string): string[] {
  const errors: string[] = [];
  text.split('\n').forEach((line, index) => {
    const match = line.match(/^\s*image:\s*(\S+)/);
    if (match === null) return;
    const image = match[1] ?? '';
    if (!IMAGE_DIGEST.test(image)) {
      errors.push(`line ${index + 1}: image ${image} must be pinned with @sha256:<digest>`);
    }
  });
  return errors;
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function checkRepo(root: string): Promise<string[]> {
  const errors: string[] = [];
  const workflowDir = join(root, '.github/workflows');
  const workflows = (await readdir(workflowDir)).filter((f) => /\.ya?ml$/.test(f)).sort();
  for (const file of workflows) {
    const text = await readFile(join(workflowDir, file), 'utf8');
    errors.push(...checkWorkflow(text).map((e) => `.github/workflows/${file}: ${e}`));
    errors.push(...checkCompose(text).map((e) => `.github/workflows/${file}: ${e}`));
  }
  const dockerfile = await readIfExists(join(root, 'Dockerfile'));
  if (dockerfile !== null)
    errors.push(...checkDockerfile(dockerfile).map((e) => `Dockerfile: ${e}`));
  const compose = await readIfExists(join(root, 'docker-compose.yml'));
  if (compose !== null)
    errors.push(...checkCompose(compose).map((e) => `docker-compose.yml: ${e}`));
  return errors;
}

if (import.meta.main) {
  const errors = await checkRepo(join(import.meta.dir, '..'));
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exit(1);
  console.log('pins: all checks passed');
}
