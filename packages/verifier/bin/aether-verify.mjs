#!/usr/bin/env node
// The `aether-verify` command: checks the Node version, then runs the TypeScript sources through tsx.
const major = Number(process.versions.node.split('.')[0]);
if (!(major >= 22)) {
  process.stderr.write(`aether-verify needs Node.js 22 or newer (this is ${process.version}).\n`);
  process.exit(2);
}
const { register } = await import('tsx/esm/api');
register();
const { main } = await import('../src/cli.ts');
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`aether-verify: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 2;
}
