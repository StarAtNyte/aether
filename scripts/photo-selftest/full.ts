/**
 * Variance-aware evaluation of the FULL pipeline (the language model in the loop) on the self-test photos, scored against the truth.
 * One run of a stochastic pipeline proves little, so each photo is run `--repeat` times and the report gives mean +- spread
 * (standard deviation and range) of the entity-level scores, the judge pass rate (waivers never counted as passes), rounds, time and calls.
 *
 *   npx tsx scripts/photo-selftest/full.ts --photos=photo-twin-room/end,scandi-living-room/end --repeat=3 --tag=after
 *        [--out=dir] [--effort=medium] [--env=AETHER_PLACEMENT_GATE=off] [--summarise]   (--summarise: only aggregate what is on disk)
 *
 * Claude Code only. Every run is taken under `flock ~/.local/share/aether/heavy2.lock nice -n 19` (one heavy job at a time) and written to
 * <out>/<tag>/<photo>/r<i>/ (the eval-photo output folder, `selftest-score.json` from score-world.ts, the log). A run that exists is not
 * repeated, so an interrupted batch continues.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k: string, d: string): string => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const photos = opt('photos', 'photo-twin-room/end,scandi-living-room/end').split(',');
const repeat = Math.max(1, Number(opt('repeat', '3')));
const tag = opt('tag', 'run');
const effort = opt('effort', 'medium');
const out = opt('out', join(homedir(), '.local/share/aether/qa/selftest-full'));
const envs = args.filter((a) => a.startsWith('--env=')).map((a) => a.slice(6).split('=') as [string, string]);
const summariseOnly = args.includes('--summarise');
const lock = join(homedir(), '.local/share/aether/heavy2.lock');

interface One { photo: string; i: number; ok: boolean; m: Record<string, number | null> }

function metrics(dir: string, log: string): Record<string, number | null> | null {
  const sp = join(dir, 'selftest-score.json');
  if (!existsSync(sp)) return null;
  const s = JSON.parse(readFileSync(sp, 'utf8')) as { entities: Record<string, number>; judge?: { passed: number; total: number; passRate: number } | null; run: { rounds: number | null; calls: number | null; minutes: number | null } };
  const run = existsSync(join(dir, 'run.json')) ? (JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as { objectLines?: string[] }) : {};
  const last = (run.objectLines ?? []).slice(-1)[0] ?? '';
  const rate = /pass rate (\d+)%/.exec(last);
  const waived = /(\d+) objects? waived/.exec(last);
  const e = s.entities;
  const sizeErr = e['widthErrMedian'] !== undefined && e['heightErrMedian'] !== undefined ? (e['widthErrMedian'] + e['heightErrMedian']) / 2 : null;
  const moves = existsSync(log) ? (readFileSync(log, 'utf8').match(/NOT APPLIED, measured placement/g) ?? []).length : null;
  return {
    posMedianM: e['posMedianM'] ?? null, sizeErr, colourDE: e['colourDEMedian'] ?? null, matched: e['matched'] ?? null, truth: e['truthEligible'] ?? null,
    maskIou: e['maskIouMedian'] ?? null, checklistPass: s.judge ? s.judge.passRate : null, objectPassNoWaiver: rate ? Number(rate[1]) / 100 : null, waivedObjects: waived ? Number(waived[1]) : 0,
    rounds: s.run.rounds, minutes: s.run.minutes, calls: s.run.calls, heldEdits: moves,
  };
}

const done: One[] = [];
for (const photo of photos) {
  for (let i = 1; i <= repeat; i++) {
    const dir = join(out, tag, photo.replace('/', '_'), `r${i}`);
    const log = `${dir}.log`;
    mkdirSync(dir, { recursive: true });
    let m = metrics(join(dir, `selftest_${photo.replace('/', '_')}`), log);
    if (!m && !summariseOnly) {
      const t0 = Date.now();
      const env = { ...process.env, GEN_GPU: process.env['GEN_GPU'] ?? 'intel', ...Object.fromEntries(envs) };
      const r = spawnSync('flock', [lock, 'nice', '-n', '19', 'npx', 'tsx', 'scripts/eval-photo.ts', `--photo=selftest:${photo}`, '--mode=live', '--backend=claude-code', `--effort=${effort}`, '--render=gpu', `--out=${dir}`], { env, encoding: 'utf8', maxBuffer: 1 << 28 });
      writeFileSync(log, `${r.stdout}\n${r.stderr}\nelapsed ${Math.round((Date.now() - t0) / 1000)}s\n`);
      if (/usage limit/i.test(`${r.stdout}${r.stderr}`)) { console.log('usage limit reached; stopping'); break; }
      const sub = join(dir, `selftest_${photo.replace('/', '_')}`);
      if (existsSync(sub)) spawnSync('npx', ['tsx', 'scripts/photo-selftest/score-world.ts', sub, photo], { encoding: 'utf8' });
      m = metrics(sub, log);
    }
    if (m) done.push({ photo, i, ok: true, m });
    else console.log(`${photo} r${i}: no result`);
  }
}

const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: number[]): number => (v.length < 2 ? 0 : Math.sqrt(v.reduce((a, b) => a + (b - mean(v)) ** 2, 0) / (v.length - 1)));
const KEYS: Array<[string, string, number]> = [['posMedianM', 'median position error m', 2], ['sizeErr', 'size error (w,h)', 2], ['colourDE', 'colour deltaE', 1], ['matched', 'matched pieces', 1], ['maskIou', 'mask IoU', 2], ['checklistPass', 'checklist pass rate', 2], ['objectPassNoWaiver', 'object pass rate, no waivers', 2], ['waivedObjects', 'waived objects', 1], ['rounds', 'rounds', 1], ['minutes', 'minutes', 1], ['calls', 'model calls', 0], ['heldEdits', 'edits held for a reason', 1]];
const lines: string[] = [`tag ${tag}: ${done.length} runs (${photos.map((p) => `${p} x${done.filter((d) => d.photo === p).length}`).join(', ')})`];
for (const scope of [...photos, 'all']) {
  const rs = done.filter((d) => scope === 'all' || d.photo === scope);
  if (rs.length === 0) continue;
  lines.push(`\n${scope} (n=${rs.length})`);
  for (const [k, label, d] of KEYS) {
    const v = rs.map((r) => r.m[k]).filter((x): x is number => typeof x === 'number');
    if (v.length === 0) continue;
    lines.push(`  ${label.padEnd(30)} ${mean(v).toFixed(d)} +- ${sd(v).toFixed(d)} (sd)  range ${Math.min(...v).toFixed(d)} to ${Math.max(...v).toFixed(d)}  [${v.map((x) => x.toFixed(d)).join(', ')}]`);
  }
}
const text = lines.join('\n');
console.log(text);
mkdirSync(join(out, tag), { recursive: true });
writeFileSync(join(out, tag, 'summary.txt'), `${text}\n`);
writeFileSync(join(out, tag, 'summary.json'), `${JSON.stringify(done, null, 1)}\n`);
