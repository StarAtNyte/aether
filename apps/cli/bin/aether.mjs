#!/usr/bin/env node
// The `aether` command. Checks the Node version first (before loading anything
// that needs a newer one), then runs the TypeScript sources through tsx.
const major = Number(process.versions.node.split('.')[0]);
if (!(major >= 22)) {
  process.stderr.write(`Aether needs Node.js 22 or newer (this is ${process.version}). Install it from https://nodejs.org and try again.\n`);
  process.exit(1);
}
const { register } = await import('tsx/esm/api');
register();
const { main } = await import('../src/main.ts');
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`aether: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
