/**
 * Edit the raw takes from `record.ts` into the final demo video: cuts and speed ramps from each take's timeline,
 * captions and section titles burned in with ffmpeg drawtext, an intro card and an outro card, fades between scenes.
 *
 *   npx tsx scripts/demo/compose.ts [--raw=<dir>] [--out=<file>] [--size=1280x720]
 *
 * Needs ffmpeg with libfreetype and the Lato font (`FONT` env overrides the .ttf path; DejaVu Sans works too).
 * Music: none (nothing third-party is bundled).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Mark, Timeline } from './lib';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const RAW = resolve(arg('raw') ?? join(homedir(), '.local/share/aether/demo/raw'));
const OUT = resolve(arg('out') ?? join(homedir(), '.local/share/aether/demo/aether-demo.mp4'));
const [W, H] = (arg('size') ?? '1280x720').split('x').map(Number) as [number, number];
const FPS = 30;
const S = H / 720;
const FONT = process.env['FONT'] ?? ['/usr/share/fonts/truetype/lato/Lato-Semibold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find((f) => existsSync(f)) ?? '';
const FONT_BOLD = process.env['FONT_BOLD'] ?? ['/usr/share/fonts/truetype/lato/Lato-Heavy.ttf', FONT].find((f) => existsSync(f)) ?? FONT;
if (!FONT) throw new Error('no font found; set FONT=/path/to/font.ttf');
const SCENES = ['villa', 'photo', 'game'];
const tmp = mkdtempSync(join(tmpdir(), 'aether-compose-'));

const probe = (file: string): number => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString());
const ff = (args: string[]): void => void execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

interface Part {
  a: number;
  b: number;
  f: number;
  /** Start in the output (seconds). */
  o: number;
}

/** Kept parts of the raw take, in raw seconds, with speed factors. */
function parts(tl: Timeline, dur: number): Part[] {
  const cuts = tl.marks.filter((m): m is Extract<Mark, { kind: 'cut' }> => m.kind === 'cut').map((m) => [m.t0 / 1000, m.t1 / 1000] as const);
  const ramps = tl.marks.filter((m): m is Extract<Mark, { kind: 'ramp' }> => m.kind === 'ramp');
  const edges = new Set<number>([0, dur]);
  for (const [a, b] of cuts) [a, b].forEach((x) => edges.add(Math.min(dur, x)));
  for (const r of ramps) [r.t0 / 1000, r.t1 / 1000].forEach((x) => edges.add(Math.min(dur, x)));
  const xs = [...edges].sort((p, q) => p - q);
  const out: Part[] = [];
  let o = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i] as number;
    const b = xs[i + 1] as number;
    if (b - a < 0.04) continue;
    const mid = (a + b) / 2;
    if (cuts.some(([c0, c1]) => mid >= c0 && mid <= c1)) continue;
    const r = ramps.find((m) => mid >= m.t0 / 1000 && mid <= m.t1 / 1000);
    const f = r ? r.factor : 1;
    out.push({ a, b, f, o });
    o += (b - a) / f;
  }
  return out;
}

/** Map a raw time (seconds) to output time, clamped into kept parts. */
function mapT(ps: Part[], t: number): number {
  for (const p of ps) {
    if (t < p.a) return p.o;
    if (t <= p.b) return p.o + (t - p.a) / p.f;
  }
  const last = ps[ps.length - 1] as Part;
  return last.o + (last.b - last.a) / last.f;
}

let txtN = 0;
function textFile(s: string): string {
  const f = join(tmp, `t${txtN++}.txt`);
  writeFileSync(f, s);
  return f;
}
const esc = (p: string): string => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
const fade = (t0: number, t1: number, d = 0.3): string => `min(1\\,min((t-${t0.toFixed(3)})/${d}\\,(${t1.toFixed(3)}-t)/${d}))`;

function drawCaption(text: string, t0: number, t1: number, high = false, top = false): string {
  const size = Math.round(30 * S);
  return `drawtext=fontfile='${esc(FONT)}':textfile='${esc(textFile(text))}':fontsize=${size}:fontcolor=white:box=1:boxcolor=0x0b1020@0.72:boxborderw=${Math.round(16 * S)}:x=(w-text_w)/2:y=${top ? String(Math.round(140 * S)) : `h-${Math.round((high ? 168 : 78) * S)}-text_h`}:alpha='${fade(t0, t1)}':enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;
}
function drawNote(text: string, t0: number, t1: number): string {
  const size = Math.round(19 * S);
  return `drawtext=fontfile='${esc(FONT)}':textfile='${esc(textFile(text))}':fontsize=${size}:fontcolor=0xf2f4ff:box=1:boxcolor=0x3b2f08@0.82:boxborderw=${Math.round(9 * S)}:x=w-text_w-${Math.round(22 * S)}:y=${Math.round(20 * S)}:alpha='${fade(t0, t1)}':enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;
}
function drawTitle(text: string, t0: number, t1: number): string {
  const size = Math.round(46 * S);
  return `drawtext=fontfile='${esc(FONT_BOLD)}':textfile='${esc(textFile(text))}':fontsize=${size}:fontcolor=white:box=1:boxcolor=0x4059e8@0.92:boxborderw=${Math.round(20 * S)}:x=${Math.round(48 * S)}:y=${Math.round(44 * S)}:alpha='${fade(t0, t1, 0.35)}':enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;
}
function drawRamp(factor: number, t0: number, t1: number): string {
  const size = Math.round(24 * S);
  return `drawtext=fontfile='${esc(FONT_BOLD)}':textfile='${esc(textFile(`sped up x${Math.round(factor)}`))}':fontsize=${size}:fontcolor=white:box=1:boxcolor=0x000000@0.6:boxborderw=${Math.round(10 * S)}:x=w-text_w-${Math.round(22 * S)}:y=h-${Math.round(60 * S)}-text_h:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`;
}

function scene(name: string): string {
  const video = join(RAW, `${name}.webm`);
  const tl = JSON.parse(readFileSync(join(RAW, `${name}.json`), 'utf8')) as Timeline;
  const dur = probe(video);
  const ps = parts(tl, dur);
  const total = ps.reduce((s, p) => s + (p.b - p.a) / p.f, 0);
  const chain: string[] = [];
  ps.forEach((p, i) => chain.push(`[0:v]trim=start=${p.a.toFixed(3)}:end=${p.b.toFixed(3)},setpts=(PTS-STARTPTS)/${p.f},fps=${FPS}[p${i}]`));
  chain.push(`${ps.map((_, i) => `[p${i}]`).join('')}concat=n=${ps.length}:v=1:a=0[cat]`);
  const draws: string[] = [`scale=${W}:${H}:flags=lanczos`, `format=yuv420p`];
  for (const m of tl.marks) {
    if (m.kind === 'caption') {
      const t0 = mapT(ps, m.t0 / 1000);
      const t1 = Math.min(mapT(ps, m.t1 / 1000), total);
      if (t1 - t0 < 0.9) continue;
      draws.push(m.note ? drawNote(m.text, t0, t1) : drawCaption(m.text, t0, t1, m.high, m.top));
    } else if (m.kind === 'title') {
      const t0 = mapT(ps, m.t0 / 1000);
      draws.push(drawTitle(m.text, t0, Math.min(total, t0 + (m.t1 - m.t0) / 1000)));
    } else if (m.kind === 'ramp') {
      draws.push(drawRamp(m.factor, mapT(ps, m.t0 / 1000), mapT(ps, m.t1 / 1000)));
    }
  }
  draws.push(`fade=t=in:st=0:d=0.4`, `fade=t=out:st=${(total - 0.4).toFixed(3)}:d=0.4`);
  chain.push(`[cat]${draws.join(',')}[v]`);
  const script = join(tmp, `${name}.fg`);
  writeFileSync(script, chain.join(';\n'));
  const out = join(tmp, `${name}.mp4`);
  ff(['-i', video, '-filter_complex_script', script, '-map', '[v]', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', out]);
  console.log(`${name}: ${total.toFixed(1)} s`);
  return out;
}

function card(name: string, lines: Array<{ text: string; size: number; bold?: boolean; y: number; alpha?: number }>, secs: number): string {
  const out = join(tmp, `${name}.mp4`);
  const draws = lines.map((l) => `drawtext=fontfile='${esc(l.bold ? FONT_BOLD : FONT)}':textfile='${esc(textFile(l.text))}':fontsize=${Math.round(l.size * S)}:fontcolor=white@${l.alpha ?? 1}:x=(w-text_w)/2:y=${Math.round(l.y * S)}-t*${Math.round(5 * S)}`);
  ff(['-f', 'lavfi', '-i', `color=c=0x0b1020:s=${W}x${H}:r=${FPS}:d=${secs}`, '-vf', [`geq=r='clip(11+30*Y/H+22*exp(-pow((X-W/2-W*0.14*sin(T*0.9))/(W*0.35)\\,2)-pow((Y-H*0.4)/(H*0.5)\\,2))\\,0\\,255)':g='clip(16+34*Y/H+34*exp(-pow((X-W/2-W*0.14*sin(T*0.9))/(W*0.35)\\,2)-pow((Y-H*0.4)/(H*0.5)\\,2))\\,0\\,255)':b='clip(32+50*Y/H+70*exp(-pow((X-W/2-W*0.14*sin(T*0.9))/(W*0.35)\\,2)-pow((Y-H*0.4)/(H*0.5)\\,2))\\,0\\,255)'`, ...draws, `fade=t=in:st=0:d=0.6`, `fade=t=out:st=${secs - 0.6}:d=0.6`, 'format=yuv420p'].join(','), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', out]);
  return out;
}

function main(): void {
  mkdirSync(dirname(OUT), { recursive: true });
  const clips: string[] = [];
  clips.push(card('intro', [{ text: 'Aether', size: 110, bold: true, y: 270 }, { text: 'Language in, a working world out.', size: 38, y: 410, alpha: 0.9 }], 4));
  for (const s of SCENES) clips.push(scene(s));
  clips.push(
    card(
      'outro',
      [
        { text: 'Aether', size: 90, bold: true, y: 250 },
        { text: 'Describe it. Build it. Prove it plays.', size: 36, y: 370, alpha: 0.92 },
        { text: 'Open source \u00b7 runs in your browser \u00b7 works offline', size: 26, y: 445, alpha: 0.7 },
      ],
      5,
    ),
  );
  const list = join(tmp, 'list.txt');
  writeFileSync(list, clips.map((c) => `file '${c}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT]);
  console.log(`wrote ${OUT} (${probe(OUT).toFixed(1)} s)`);
}

main();
