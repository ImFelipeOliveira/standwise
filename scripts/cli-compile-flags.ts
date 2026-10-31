export const CLI_COMPILE_FLAGS = [
  '--compile',
  '--no-compile-autoload-dotenv',
  '--no-compile-autoload-bunfig',
  '--no-compile-autoload-tsconfig',
  '--no-compile-autoload-package-json',
];

export const FALLBACK_DEFAULT_API_URL = 'https://api.standwise.dev';

export function resolveDefaultApiUrl(env: Record<string, string | undefined>): string {
  const value = env.STANDWISE_DEFAULT_API_URL || FALLBACK_DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`STANDWISE_DEFAULT_API_URL is not a valid URL: ${value}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`STANDWISE_DEFAULT_API_URL must use https: ${value}`);
  }
  return value.replace(/\/+$/, '');
}

export function cliDefineFlags(env: Record<string, string | undefined>): string[] {
  return ['--define', `STANDWISE_DEFAULT_API_URL=${JSON.stringify(resolveDefaultApiUrl(env))}`];
}
