/**
 * Production dependency licences must be permissive, and every one must be named in docs/THIRD_PARTY.md
 * (platform binaries of an already listed package, and workspace packages, are covered by their parent entry).
 * Usage: tsx scripts/check-licences.ts   (exit 1 on a non-permissive or unlisted licence)
 */
import { readFileSync } from 'node:fs';

const PERMISSIVE = /^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|BlueOak-1\.0\.0|CC0-1\.0|Unlicense|Python-2\.0)$/;
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, { version?: string; license?: string; dev?: boolean; link?: boolean }> };
const doc = readFileSync('docs/THIRD_PARTY.md', 'utf8');
const bad: string[] = [], unlisted: string[] = [];
for (const [key, pkg] of Object.entries(lock.packages)) {
  if (!key || pkg.dev || pkg.link || !key.includes('node_modules/')) continue;
  const name = key.replace(/.*node_modules\//, '');
  const licence = pkg.license ?? 'UNKNOWN';
  if (!PERMISSIVE.test(licence)) bad.push(`${name}@${pkg.version}: ${licence}`);
  const scope = name.startsWith('@') ? name.split('/')[0]! : name;
  if (!doc.includes(name) && !doc.includes(`${scope}/`) && !doc.includes(name.replace(/-(darwin|linux|win32|android|freebsd|netbsd|openbsd|sunos|aix|openharmony)-.*$/, ''))) unlisted.push(`${name}@${pkg.version}`);
}
if (bad.length) console.error(`Non-permissive production licences:\n  ${bad.join('\n  ')}`);
if (unlisted.length) console.error(`Not in docs/THIRD_PARTY.md:\n  ${unlisted.join('\n  ')}`);
if (bad.length || unlisted.length) process.exit(1);
console.log('licences ok');
