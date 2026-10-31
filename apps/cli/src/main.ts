import { run } from './cli';
import { openBrowser } from './device-flow';

const code = await run(process.argv.slice(2), {
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin: () => Bun.stdin.text(),
  sleep: (ms) => Bun.sleep(ms),
  openBrowser,
});
process.exit(code);
