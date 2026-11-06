/**
 * Take down a world published from the editor (api/cook-upload.ts): delete everything under a `users/` path of the cooked
 * dataset in one commit, so the share links that name it load live again.
 *
 *   npx tsx scripts/cook-takedown.ts users/<anon>/<world>     one published world
 *   npx tsx scripts/cook-takedown.ts users/<anon>             everything one anonymous id published
 *   npx tsx scripts/cook-takedown.ts --dry-run users/<anon>   list what would go
 *
 * Only paths under `users/` are accepted (templates are managed by scripts/cook-upload.ts). The write token comes from
 * ~/.config/aether/hf-write.token, else `HF_TOKEN`; it is never printed.
 */
import { COOKED_REPO, hfCliOps, hubToken } from './lib/cook-upload';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const path = (args.find((a) => !a.startsWith('--')) ?? '').replace(/^\/+|\/+$/g, '');

/** The path a takedown accepts: `users/<anon>` or `users/<anon>/<world>` (16 hex each), or under `users/_test` (the local test's). */
export function takedownPath(p: string): string | null {
  return /^users\/(?:[0-9a-f]{16}(?:\/[0-9a-f]{16})?|_test(?:\/[0-9a-f]{16}){0,2})$/.test(p) ? p : null;
}

async function main(): Promise<void> {
  if (!takedownPath(path)) throw new Error('give a path users/<anon> or users/<anon>/<world> (16 hex each)');
  const files = await hfCliOps({ log: () => undefined }).listFiles(path);
  if (files.length === 0) {
    console.log(`${path}: nothing on ${COOKED_REPO}`);
    return;
  }
  console.log(`${path}: ${files.length} files${dry ? ' (dry run)' : ''}`);
  for (const f of files.slice(0, 20)) console.log(`  ${f}`);
  if (files.length > 20) console.log(`  … ${files.length - 20} more`);
  if (dry) return;
  const token = hubToken();
  const lines = [{ key: 'header', value: { summary: `Take down ${path}`, description: '' } }, ...files.map((f) => ({ key: 'deletedFile', value: { path: f } }))].map((l) => JSON.stringify(l)).join('\n');
  const res = await fetch(`https://huggingface.co/api/datasets/${COOKED_REPO}/commit/main`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-ndjson' }, body: lines });
  if (!res.ok) throw new Error(`the dataset refused the commit (HTTP ${res.status}): ${(await res.text()).split(token).join('***').slice(0, 300)}`);
  const left = await hfCliOps({ log: () => undefined }).listFiles(path);
  console.log(left.length === 0 ? `${path}: deleted` : `${path}: ${left.length} files still listed (the listing may lag; run again to check)`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
