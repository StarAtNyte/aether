/**
 * The camera director: plain language → a shot plan → a camera path.
 *
 * "slow dolly through the living room then rise above the roof" becomes two
 * shots ({ move: dolly, subject: "living room", speed: slow } and
 * { move: rise, subject: "roof" }), and each shot is resolved against the
 * scene's subjects (rooms of buildings, buildings and their roofs, named
 * objects, the whole world) into keyframes that continue from where the
 * previous shot ended.
 *
 * Two authors produce shot plans: {@link parseShotScript}, a deterministic
 * offline parser, and a connected language model (the studio sends it
 * {@link directorPrompt} and validates the reply with {@link ShotPlan}).
 * Either way the resolver below is the only thing that turns words into
 * coordinates, so model output can never place the camera arbitrarily.
 */
import { z } from 'zod';
import { DEFAULT_FOV, FOV_RANGE, MAX_KEYS, MAX_PATH_SECONDS, normalizePath, type CameraKey, type CameraPath, type Easing } from './cameraPath';

type Vec3 = [number, number, number];

/** Camera moves the director knows. */
export const MOVES = ['dolly', 'orbit', 'rise', 'descend', 'flythrough', 'push', 'pull', 'topdown', 'pan', 'establish', 'turntable', 'hold'] as const;
export type Move = (typeof MOVES)[number];

/** One shot of a plan (also the JSON a language model must return). */
export const Shot = z.object({
  move: z.enum(MOVES),
  /** Name of a subject ("living room", "roof", "tower"); absent: the whole scene. */
  subject: z.string().max(80).optional(),
  speed: z.enum(['slow', 'normal', 'fast']).optional(),
  /** Explicit length of the shot. */
  seconds: z.number().finite().min(0.5).max(60).optional(),
  direction: z.enum(['left', 'right', 'up', 'down']).optional(),
  height: z.enum(['low', 'eye', 'high', 'aerial']).optional(),
  /** Orbits: fraction of a full turn (0.25–3). */
  turns: z.number().finite().min(0.1).max(3).optional(),
});
export type Shot = z.infer<typeof Shot>;

/** A shot plan. */
export const ShotPlan = z.object({ shots: z.array(Shot).min(1).max(12) });
export type ShotPlan = z.infer<typeof ShotPlan>;

/** Something a shot can be about. */
export interface Subject {
  name: string;
  /** Extra words that refer to it ("lounge" for a living room). */
  aliases?: readonly string[];
  kind: 'room' | 'building' | 'roof' | 'object' | 'world';
  min: Vec3;
  max: Vec3;
}

/** The scene as the resolver sees it. */
export interface DirectorScene {
  /** Meaningful content sphere. */
  center: Vec3;
  radius: number;
  floorY: number;
  subjects: readonly Subject[];
  /** Where the camera is now (the first shot continues from it). */
  camera: { pos: Vec3; target: Vec3; fov: number };
}

/** Default length of each move (seconds, normal speed). */
export const MOVE_SECONDS: Readonly<Record<Move, number>> = {
  dolly: 6,
  orbit: 10,
  rise: 5,
  descend: 5,
  flythrough: 18,
  push: 4,
  pull: 5,
  topdown: 6,
  pan: 5,
  establish: 5,
  turntable: 10,
  hold: 2.5,
};

const SPEED_FACTOR = { slow: 1.6, normal: 1, fast: 0.6 } as const;

// ---------------------------------------------------------------------------
// Offline parser
// ---------------------------------------------------------------------------

/** Keyword rules, most specific first. */
const MOVE_RULES: ReadonlyArray<[RegExp, Move]> = [
  [/\b(turn ?table|spin(?:ning)?|rotate around)\b/, 'turntable'],
  [/\b(fly ?through|fly ?around|tour|fly over everything)\b/, 'flythrough'],
  [/\b(top[- ]?down|bird'?s?[- ]?eye|overhead|plan view|straight down)\b/, 'topdown'],
  [/\b(orbit|circle|circling|go around|around the|360)\b/, 'orbit'],
  [/\b(rise|rises|rising|ascend|crane up|crane|lift|soar|climb|go up|move up|up and over|up above|above the|over the top)\b/, 'rise'],
  [/\b(descend|drop down|come down|lower|move down|sink)\b/, 'descend'],
  [/\b(push in|push|zoom in|close[- ]?up|approach|move closer|get closer|towards?)\b/, 'push'],
  [/\b(pull back|pull out|pull away|zoom out|back away|reveal|move back|step back)\b/, 'pull'],
  [/\b(dolly|walk|glide|track|travel|move|drift|stroll|through|along|across|into)\b/, 'dolly'],
  [/\b(pan|sweep|look across|scan)\b/, 'pan'],
  [/\b(establishing|wide shot|overview|wide view|whole scene)\b/, 'establish'],
  [/\b(hold|pause|wait|linger|stay)\b/, 'hold'],
];

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'to', 'into', 'through', 'around', 'above', 'over', 'past', 'along', 'across', 'towards', 'toward', 'on', 'in', 'at', 'from', 'up', 'down', 'and', 'then', 'shot', 'camera', 'slow', 'slowly', 'fast', 'quick', 'quickly', 'gentle', 'gently', 'move', 'dolly', 'orbit', 'rise', 'pan', 'push', 'pull', 'back', 'out', 'reveal', 'whole', 'scene', 'view']);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 0);
}

function singular(w: string): string {
  return w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
}

/** Score how well `phrase` names `subject` (0 = not at all). */
export function subjectScore(phrase: string, subject: Subject): number {
  const want = words(phrase).filter((w) => !STOP_WORDS.has(w)).map(singular);
  if (want.length === 0) return 0;
  const names = [subject.name, ...(subject.aliases ?? [])].map((n) => words(n).map(singular));
  let best = 0;
  for (const name of names) {
    if (name.length === 0) continue;
    const hit = want.filter((w) => name.includes(w)).length;
    if (hit === 0) continue;
    // All of the subject's words present beats a partial match; fewer extra words is better.
    const score = hit / Math.max(want.length, name.length) + (name.every((n) => want.includes(n)) ? 1 : 0);
    best = Math.max(best, score);
  }
  return best;
}

/** The subject a phrase refers to, or null for "the whole scene". */
export function findSubject(phrase: string | undefined, subjects: readonly Subject[]): Subject | null {
  if (!phrase) return null;
  let best: Subject | null = null;
  let score = 0;
  for (const s of subjects) {
    const v = subjectScore(phrase, s);
    if (v > score) {
      score = v;
      best = s;
    }
  }
  return best;
}

/** The subject phrase of a clause: the words after the move's preposition. */
function subjectPhrase(clause: string): string | undefined {
  // Modifiers are not subjects: durations, directions, turn counts, heights, speeds.
  const bare = clause
    .replace(/\b(for|over|in)?\s*\d+(\.\d+)?\s*(s|sec|secs|second|seconds)\b/gi, ' ')
    .replace(/\b(?:(?:to|towards?) the |to )?(left|right|counter[- ]?clockwise|anticlockwise|clockwise)\b/gi, ' ')
    .replace(/\b(twice|once|half|quarter|full turn|two (?:full )?(?:turns|times)|360|180|90)\b/gi, ' ')
    .replace(/\b(?:at |from )?(eye[- ]level|eye height|walking height|ground level|low|high|aerial|drone)\b/gi, ' ')
    .replace(/\b(slow|slowly|gentle|gently|lazy|leisurely|calm|fast|quick|quickly|rapid|swift|swiftly)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = /\b(?:through|around|above|over|past|along|across|into|towards?|toward|on|at|of|in|to|from|reveal(?:ing)?)\s+(?:the\s+|a\s+|an\s+)?([a-z0-9' -]{2,60})$/i.exec(bare);
  if (m) return (m[1] as string).trim();
  const tail = words(bare).filter((w) => !STOP_WORDS.has(w));
  return tail.length > 0 ? tail.join(' ') : undefined;
}

/** Deterministic text → shot plan. Unknown clauses are skipped; null when nothing is recognised. */
export function parseShotScript(text: string): ShotPlan | null {
  if (typeof text !== 'string') return null;
  const clauses = text
    .slice(0, 1000)
    .toLowerCase()
    // Sentence breaks, but never the point of a decimal number ("1.5 seconds").
    .split(/\b(?:and then|then|after that|afterwards|next|finally|before)\b|(?<!\d)\.|\.(?!\d)|[;,!?\n]+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const shots: Shot[] = [];
  for (const clause of clauses) {
    const rule = MOVE_RULES.find(([re]) => re.test(clause));
    if (!rule) continue;
    const move = rule[1];
    const shot: Shot = { move };
    if (/\b(slow|slowly|gentle|gently|lazy|leisurely|calm)\b/.test(clause)) shot.speed = 'slow';
    else if (/\b(fast|quick|quickly|rapid|swift|swiftly|rush)\b/.test(clause)) shot.speed = 'fast';
    const secs = /(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/.exec(clause);
    if (secs) shot.seconds = Math.min(60, Math.max(0.5, Number(secs[1])));
    if (/\b(left|counter[- ]?clockwise|anticlockwise)\b/.test(clause)) shot.direction = 'left';
    else if (/\b(right|clockwise)\b/.test(clause)) shot.direction = 'right';
    if (/\b(low|ground level|close to the ground)\b/.test(clause)) shot.height = 'low';
    else if (/\b(eye[- ]level|eye height|walking height)\b/.test(clause)) shot.height = 'eye';
    else if (/\b(aerial|drone|sky)\b/.test(clause)) shot.height = 'aerial';
    else if (/\b(high|from above)\b/.test(clause)) shot.height = 'high';
    if (move === 'orbit') {
      if (/\b(half|180)\b/.test(clause)) shot.turns = 0.5;
      else if (/\b(quarter|90)\b/.test(clause)) shot.turns = 0.25;
      else if (/\b(twice|two (?:full )?(?:turns|times))\b/.test(clause)) shot.turns = 2;
    }
    if (move !== 'flythrough' && move !== 'establish' && move !== 'turntable' && move !== 'hold') {
      const phrase = subjectPhrase(clause);
      if (phrase && !/^(scene|everything|world|it|all)$/.test(phrase)) shot.subject = phrase;
    }
    shots.push(shot);
    if (shots.length >= 12) break;
  }
  return shots.length > 0 ? { shots } : null;
}

// ---------------------------------------------------------------------------
// Resolver: plan → keys
// ---------------------------------------------------------------------------

function centerOf(s: { min: Vec3; max: Vec3 }): Vec3 {
  return [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2];
}

function radiusOf(s: { min: Vec3; max: Vec3 }): number {
  return Math.max(0.5, Math.hypot(s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]) / 2);
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function finite3(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/** Resolve a plan into a camera path (keys continue from the scene's camera). */
export function resolvePlan(plan: ShotPlan, scene: DirectorScene, name = 'Directed shot'): CameraPath {
  const world: Subject = {
    name: 'scene',
    kind: 'world',
    min: [scene.center[0] - scene.radius, scene.center[1] - scene.radius, scene.center[2] - scene.radius],
    max: [scene.center[0] + scene.radius, scene.center[1] + scene.radius, scene.center[2] + scene.radius],
  };
  const fy = Number.isFinite(scene.floorY) ? scene.floorY : 0.3;
  const fov = Math.min(FOV_RANGE[1], Math.max(FOV_RANGE[0], scene.camera.fov || DEFAULT_FOV));
  const keys: CameraKey[] = [];
  let t = 0;
  let pos: Vec3 = [...scene.camera.pos];
  let target: Vec3 = [...scene.camera.target];
  const push = (time: number, p: Vec3, tg: Vec3, e: Easing = 'linear', f = fov): void => {
    if (!finite3(p) || !finite3(tg) || keys.length >= MAX_KEYS) return;
    const q: Vec3 = [p[0], Math.max(fy, p[1]), p[2]];
    keys.push({ t: Math.round(time * 1000) / 1000, pos: q.map((v) => Math.round(v * 1000) / 1000) as Vec3, target: tg.map((v) => Math.round(v * 1000) / 1000) as Vec3, fov: f, ease: e });
    pos = q;
    target = tg;
  };
  push(0, pos, target);
  for (const shot of plan.shots) {
    const subject = findSubject(shot.subject, scene.subjects) ?? world;
    const c = centerOf(subject);
    const r = radiusOf(subject);
    const secs = Math.min(60, shot.seconds ?? MOVE_SECONDS[shot.move] * SPEED_FACTOR[shot.speed ?? 'normal']);
    const start = t;
    const end = Math.min(MAX_PATH_SECONDS, t + secs);
    const span = end - start;
    if (span <= 0) break;
    const side = shot.direction === 'left' ? -1 : 1;
    const a0 = Math.atan2(pos[0] - c[0], pos[2] - c[2]);
    switch (shot.move) {
      case 'dolly': {
        if (subject.kind === 'room') {
          // Walk through the room along its long axis at eye height.
          const floor = subject.min[1];
          const eye = Math.min(subject.max[1] - 0.3, floor + 1.55);
          const alongX = subject.max[0] - subject.min[0] >= subject.max[2] - subject.min[2];
          const a: Vec3 = alongX ? [subject.min[0] + (subject.max[0] - subject.min[0]) * 0.12, eye, c[2]] : [c[0], eye, subject.min[2] + (subject.max[2] - subject.min[2]) * 0.12];
          const b: Vec3 = alongX ? [subject.max[0] - (subject.max[0] - subject.min[0]) * 0.12, eye, c[2]] : [c[0], eye, subject.max[2] - (subject.max[2] - subject.min[2]) * 0.12];
          // Start from the end nearer to where the camera is.
          const [from, to] = Math.hypot(pos[0] - a[0], pos[2] - a[2]) <= Math.hypot(pos[0] - b[0], pos[2] - b[2]) ? [a, b] : [b, a];
          const dir: Vec3 = [to[0] - from[0], 0, to[2] - from[2]];
          const ahead = (p: Vec3): Vec3 => [p[0] + dir[0], eye - 0.15, p[2] + dir[2]];
          if (keys.length > 0 && Math.hypot(pos[0] - from[0], pos[1] - from[1], pos[2] - from[2]) > 0.5) {
            push(start + span * 0.25, from, ahead(from), 'ease');
            push(end, to, ahead(to), 'linear');
          } else {
            push(start, from, ahead(from));
            push(end, to, ahead(to));
          }
        } else {
          // Track past the subject, looking at it.
          const dist = Math.max(r * 1.7, 2.5);
          const y = shot.height === 'low' ? fy + 0.4 : shot.height === 'high' || shot.height === 'aerial' ? c[1] + r * 1.2 : Math.max(fy + 1.4, c[1]);
          const a1 = a0 - side * 0.6;
          const a2 = a0 + side * 0.6;
          push(start + span * 0.15, [c[0] + Math.sin(a1) * dist, y, c[2] + Math.cos(a1) * dist], c, 'ease');
          push(end, [c[0] + Math.sin(a2) * dist * 0.85, y, c[2] + Math.cos(a2) * dist * 0.85], c);
        }
        break;
      }
      case 'orbit':
      case 'turntable': {
        const turns = (shot.turns ?? 1) * side;
        const dist = shot.move === 'turntable' ? r * 2.4 : Math.max(r * 2.1, 2.5);
        const y = shot.height === 'low' ? Math.max(fy, c[1] - r * 0.3) : shot.height === 'aerial' ? c[1] + r * 1.6 : shot.height === 'high' ? c[1] + r : c[1] + r * 0.45;
        const steps = Math.max(3, Math.round(Math.abs(turns) * 8));
        for (let i = 0; i <= steps; i++) {
          const a = a0 + (i / steps) * Math.PI * 2 * turns;
          push(start + (i / steps) * span, [c[0] + Math.sin(a) * dist, y, c[2] + Math.cos(a) * dist], c);
        }
        break;
      }
      case 'rise': {
        // Above a building's roof (or the subject's top), looking down at it.
        const top = subject.max[1];
        const off = Math.max(r * 0.35, 1.5);
        const endPos: Vec3 = [c[0] + Math.sin(a0) * off, top + Math.max(r * 0.8, 4), c[2] + Math.cos(a0) * off];
        const mid: Vec3 = lerp3(pos, endPos, 0.5);
        mid[1] = Math.max(mid[1], top * 0.6 + endPos[1] * 0.4);
        push(start + span * 0.5, mid, lerp3(target, c, 0.6));
        push(end, endPos, [c[0], top * 0.5 + c[1] * 0.5, c[2]], 'ease');
        break;
      }
      case 'descend': {
        const endPos: Vec3 = [pos[0] + (c[0] - pos[0]) * 0.3, Math.max(fy + 1.2, c[1]), pos[2] + (c[2] - pos[2]) * 0.3];
        push(end, endPos, c, 'ease');
        break;
      }
      case 'push': {
        const close = Math.max(r * 1.1, 1.2);
        const dir: Vec3 = [pos[0] - c[0], pos[1] - c[1], pos[2] - c[2]];
        const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        push(end, [c[0] + (dir[0] / len) * close, c[1] + (dir[1] / len) * close, c[2] + (dir[2] / len) * close], c, 'ease');
        break;
      }
      case 'pull': {
        const far = Math.max(r * 2.8, 5);
        const dir: Vec3 = [pos[0] - c[0], Math.max(0.3, pos[1] - c[1]), pos[2] - c[2]];
        const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        push(end, [c[0] + (dir[0] / len) * far, c[1] + (dir[1] / len) * far + r * 0.4, c[2] + (dir[2] / len) * far], c, 'ease');
        break;
      }
      case 'topdown': {
        const h = c[1] + Math.max(r * 2.4, 8);
        const off = Math.max(0.5, r * 0.1);
        push(start + span * 0.35, [c[0] + Math.sin(a0) * off * 3, h, c[2] + Math.cos(a0) * off * 3], c, 'ease');
        push(end, [c[0] + Math.sin(a0 + side * 0.5) * off, h - r * 0.3, c[2] + Math.cos(a0 + side * 0.5) * off], c);
        break;
      }
      case 'pan': {
        // Keep the eye, swing the look direction across the subject.
        const dx = target[0] - pos[0];
        const dz = target[2] - pos[2];
        const yaw = Math.atan2(dx, dz) + side * 0.9;
        const dist = Math.hypot(dx, dz) || r;
        push(end, pos, [pos[0] + Math.sin(yaw) * dist, target[1], pos[2] + Math.cos(yaw) * dist], 'ease');
        break;
      }
      case 'establish': {
        const dist = r * 2.6;
        const p: Vec3 = [c[0] + Math.sin(a0) * dist, c[1] + r * 1.1, c[2] + Math.cos(a0) * dist];
        push(start + span * 0.4, p, c, 'ease');
        push(end, [c[0] + Math.sin(a0 + side * 0.15) * dist, c[1] + r * 1.1, c[2] + Math.cos(a0 + side * 0.15) * dist], c);
        break;
      }
      case 'flythrough': {
        const stops = 6;
        const cw = world.max[0] - world.min[0] > 0 ? scene.radius : r;
        for (let i = 1; i <= stops; i++) {
          const a = a0 + (i / (stops + 1)) * Math.PI * 2 * side;
          const low = i % 2 === 1;
          const dist = cw * (low ? 0.75 : 1.55);
          push(start + (i / stops) * span, [scene.center[0] + Math.sin(a) * dist, scene.center[1] + cw * (low ? 0.12 : 0.65), scene.center[2] + Math.cos(a) * dist], scene.center);
        }
        break;
      }
      case 'hold':
        push(end, pos, target);
        break;
    }
    t = end;
  }
  const duration = Math.max(0.5, t);
  return normalizePath({ v: 1, name, duration, keys: keys.length > 0 ? keys : [{ t: 0, pos: scene.camera.pos, target: scene.camera.target, fov, ease: 'linear' }], easeInOut: true });
}

/** Parse + resolve in one step (null when nothing in the text was understood). */
export function directOffline(text: string, scene: DirectorScene): CameraPath | null {
  const plan = parseShotScript(text);
  return plan ? resolvePlan(plan, scene, text.trim().slice(0, 60) || 'Directed shot') : null;
}

/** System prompt for a language model that writes shot plans. */
export function directorPrompt(subjects: readonly Subject[]): string {
  const names = subjects.slice(0, 40).map((s) => `- ${s.name} (${s.kind})`).join('\n') || '- (no named subjects; use the whole scene)';
  return [
    'You are a film director planning camera moves for a 3D scene.',
    'Reply with ONLY a JSON object: {"shots":[{"move":…, "subject":…, "speed":…, "seconds":…, "direction":…, "height":…, "turns":…}]}.',
    `move is one of: ${MOVES.join(', ')}. subject (optional) must be one of the names below; omit it for the whole scene.`,
    'speed: slow | normal | fast. seconds: 0.5–60 per shot. direction: left | right | up | down. height: low | eye | high | aerial. turns: 0.1–3 (orbit/turntable only).',
    'Use at most 12 shots. Never invent coordinates.',
    'Subjects in this scene:',
    names,
  ].join('\n');
}

/** Extract and validate a shot plan from model text (first JSON object found). */
export function parseModelPlan(text: string): ShotPlan | null {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start || end - start > 20_000) return null;
  try {
    const r = ShotPlan.safeParse(JSON.parse(text.slice(start, end + 1)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
