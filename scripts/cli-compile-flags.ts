import { resolveDefaultApiUrl } from '../apps/cli/src/default-api-url';

export const CLI_COMPILE_FLAGS = [
  '--compile',
  '--no-compile-autoload-dotenv',
  '--no-compile-autoload-bunfig',
  '--no-compile-autoload-tsconfig',
  '--no-compile-autoload-package-json',
];

export function cliDefineFlags(env: Record<string, string | undefined>): string[] {
  return [
    '--define',
    `STANDWISE_DEFAULT_API_URL=${JSON.stringify(resolveDefaultApiUrl(env.STANDWISE_DEFAULT_API_URL))}`,
  ];
}
