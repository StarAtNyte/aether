/**
 * Checks the finished demo video: duration under 3 minutes, resolution, no black segments, no frozen segments, and
 * twelve evenly spaced frames written next to the video for a look by eye.
 *
 *   npx tsx scripts/demo/verify.ts [--video=<file>] [--frames=<dir>]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const VIDEO = resolve(arg('video') ?? join(homedir(), '.local/share/aether/demo/aether-demo.mp4'));
const FRAMES = resolve(arg('frames') ?? join(dirname(VIDEO), 'frames'));
const MAX_SECONDS = 180;
/** A frozen stretch longer than this fails (title cards and fades are animated, so none is expected). */
const MAX_FREEZE = 2.5;

const probe = (entries: string): string => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'default=nw=1:nk=1', VIDEO]).toString().trim();
const [width, height] = probe('stream=width,height').split('\n').map(Number) as [number, number];
const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', VIDEO]).toString());
let failed = false;
const check = (ok: boolean, msg: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed = true;
};

check(duration < MAX_SECONDS, `duration ${duration.toFixed(1)} s (limit ${MAX_SECONDS})`);
check((width === 1280 && height === 720) || (width === 1920 && height === 1080), `resolution ${width}x${height}`);

const detect = spawnSync('ffmpeg', ['-hide_banner', '-i', VIDEO, '-vf', `blackdetect=d=0.4:pix_th=0.1,freezedetect=n=-70dB:d=${MAX_FREEZE}`, '-an', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const blacks = [...detect.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => `${m[1]}-${m[2]}`);
const freezes = [...detect.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => m[1]);
check(blacks.length === 0, `no black segments${blacks.length ? ` (found ${blacks.join(', ')})` : ''}`);
check(freezes.length === 0, `no frozen frames over ${MAX_FREEZE} s${freezes.length ? ` (starts at ${freezes.join(', ')} s)` : ''}`);

mkdirSync(FRAMES, { recursive: true });
for (let i = 0; i < 12; i++) {
  const t = ((i + 0.5) / 12) * duration;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t.toFixed(2), '-i', VIDEO, '-frames:v', '1', join(FRAMES, `frame-${String(i + 1).padStart(2, '0')}.png`)]);
}
console.log(`12 frames in ${FRAMES}`);
if (failed) process.exitCode = 1;
