/**
 * Keyword/regex intent recognition for the mock planner: themes, moods,
 * environment overrides and edit commands from a natural-language request.
 */
import type { Json } from '@aether/core';
import type { Mood } from './builder';
import { COLORS, parseCount } from './lexicon';
import type { Theme } from './theme';
import { BUILT_THEMES } from './themes-built';
import { GAME_THEMES } from './themes-games';
import { NATURE_THEMES } from './themes-nature';
import { TECH_THEMES } from './themes-tech';

/** Every theme, settings first. */
export const ALL_THEMES: readonly Theme[] = [...TECH_THEMES, ...NATURE_THEMES, ...BUILT_THEMES, ...GAME_THEMES];

/** Property changes understood by "make the X …". */
export type Change =
  | { kind: 'scale'; factor: number; axis?: 'y' }
  | { kind: 'color'; color: string }
  | { kind: 'bouncy' }
  | { kind: 'mass'; heavy: boolean }
  | { kind: 'glow' }
  | { kind: 'behavior'; behavior: 'spin' | 'bob' }
  | { kind: 'body'; body: 'dynamic' | 'static' }
  | { kind: 'visible'; visible: boolean }
  | { kind: 'speed'; factor: number };

/** One edit command. */
export type Edit =
  | { kind: 'add'; phrase: string; count: number }
  | { kind: 'remove'; target: string; all: boolean }
  | { kind: 'modify'; target: string; all: boolean; change: Change };

/** Everything recognized in a request. */
export interface Intent {
  text: string;
  mood: Mood;
  /** Environment overrides from mood words, applied after themes. */
  env: Record<string, Json>;
  settings: Theme[];
  activities: Theme[];
  /** First number in the request that is not a duration ("collect 12 coins", "30 dominoes"). */
  count?: number;
  /** A time limit in seconds ("in 60 seconds", "within 2 minutes"), clamped to 10..900. */
  seconds?: number;
  edits: Edit[];
  /** "start over", "new world", … */
  clear: boolean;
  /** Explicit creation verb ("create a …", "build me a …"). */
  create: boolean;
  /**
   * The request reads as a description of a whole scene ("a cozy lakeside
   * camp at sunset", "bowling alley: knock down 15 crates") rather than an
   * instruction to change the current one ("add …", "make it …", "more …").
   */
  describesScene: boolean;
}

const MOODS = {
  night: /\b(night|midnight|nighttime|night-time|moonlit|moonlight|starry|nocturnal)\b/,
  dusk: /\b(sunset|dusk|evening|golden hour|twilight)\b/,
  dawn: /\b(dawn|sunrise|early morning|daybreak)\b/,
  day: /\b(daytime|noon|midday|day ?light|sunny day|make it day)\b/,
  rain: /\b(rain|rainy|raining|storm|stormy|thunder\w*|drizzle)\b/,
  snow: /\b(snow|snowy|snowing|blizzard|snowfall)\b/,
  fog: /\b(fog|foggy|mist|misty|haze|hazy|murky)\b/,
  water: /\b(lake(?:side|shore|front)?|river(?:side|bank)?|pond|creek|stream|waterside|shore)\b/,
  clearSky: /\b(clear (?:sky|skies|weather)|stop (?:the )?(?:rain|snow)|no (?:rain|snow|fog))\b/,
  lowGravity: /\b(low|moon|lunar|reduced|weak|less) gravity\b|\bmoon ?jump/,
  zeroGravity: /\b(zero|no) gravity\b|\bweightless\b/,
  highGravity: /\b(high|strong|heavy|more|double) gravity\b/,
  normalGravity: /\b(normal|earth|regular) gravity\b/,
};

const SIZE: Readonly<Record<string, number>> = { bigger: 1.6, larger: 1.6, big: 1.6, large: 1.6, taller: 1.5, huge: 2.5, giant: 3, enormous: 3, smaller: 0.6, small: 0.6, shorter: 0.7, tiny: 0.35, little: 0.5 };
const CHANGE_WORDS = [
  ...Object.keys(SIZE), ...Object.keys(COLORS), 'bouncy', 'bouncier', 'heavy', 'heavier', 'light', 'lighter', 'glow', 'glowing', 'glowy', 'shine', 'shiny',
  'spin', 'spinning', 'rotate', 'rotating', 'bob', 'bobbing', 'float', 'floating', 'hover', 'fall', 'falling', 'dynamic', 'physical', 'static', 'solid',
  'invisible', 'hidden', 'disappear', 'visible', 'appear', 'faster', 'slower',
].sort((a, b) => b.length - a.length);
const MODIFY = new RegExp(`\\b(?:make|turn|paint|color|colour|set|change|let)\\s+(?:all\\s+(?:of\\s+)?)?(?:the\\s+|my\\s+|every\\s+|those\\s+|these\\s+)?(.+?)\\s+(?:to\\s+|into\\s+)?(?:be\\s+|more\\s+|go\\s+|a\\s+bit\\s+|much\\s+)?(${CHANGE_WORDS.join('|')})\\b`);
const REMOVE = /\b(?:remove|delete|destroy|erase|get rid of|take away|take out|clear away|eliminate)\s+(all\s+(?:of\s+)?)?(?:the\s+|my\s+|those\s+|these\s+)?([a-z0-9][a-z0-9 _-]*)/;
const ADD = /\b(?:add|place|put|spawn|plant|build|create|insert|drop|make|give (?:me|it|us))\s+(?:(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|hundred|some|several|many|lots of|a few|a couple of|a pair of|a dozen|a bunch of|few|more)\s+)?(?:more\s+|new\s+|extra\s+|other\s+)?([a-z][a-z -]*?)(?=\s+(?:to|in|on|around|near|at|next|by|beside|behind|over|under|along|here|there|that|which|so|for|with)\b|$)/;
const CLEAR = /\b(start over|start again|from scratch|clear (?:the )?(?:world|scene|everything|all)|reset the (?:world|scene)|new (?:world|scene)|empty (?:the )?(?:world|scene)|wipe)\b/;
/** Requests that open with an edit verb (after polite fillers) change the current world. */
const EDIT_LEAD =
  /^(?:(?:now|please|ok|okay|and|then|also|so|can you|could you|would you|let's|lets)\s+)*(?:add|place|put|spawn|plant|insert|drop|make|remove|delete|destroy|erase|get rid|take|clear away|eliminate|move|turn|paint|color|colour|set|change|give|increase|decrease|raise|lower|double|halve|scale|rotate|swap|replace|switch|enable|disable|fix|rename|resize|shrink|grow|more|another|extra|bigger|smaller)\b/;
/** A number followed by a time unit ("60 seconds", "2 min", "90s"). */
const DURATION_RE = /\b(\d{1,4})\s*(s|secs?|seconds?|mins?|minutes?)\b/;
/** The first number that is not a duration. */
const COUNT_RE = /\b(\d{1,3})\b(?!\s*(?:s|secs?|seconds?|mins?|minutes?)\b)/;
/** Words that imply adding to what already exists. */
const INCREMENTAL = /\b(?:more|another|extra|also|too|as well|again|additional)\b/;
const CREATE = /\b(create|generate|build|design|give me|show me|i want|i'd like|let'?s (?:make|build)|turn (?:it|this|the world|everything) into|make (?:me )?(?:an?|the) (?:\w+ )?(?:world|scene|level|map|game))\b/;

function changeFor(word: string): Change | null {
  if (word === 'taller' || word === 'shorter') return { kind: 'scale', factor: SIZE[word] as number, axis: 'y' };
  if (SIZE[word] !== undefined) return { kind: 'scale', factor: SIZE[word] as number };
  if (COLORS[word]) return { kind: 'color', color: COLORS[word] as string };
  if (word === 'bouncy' || word === 'bouncier') return { kind: 'bouncy' };
  if (word === 'heavy' || word === 'heavier') return { kind: 'mass', heavy: true };
  if (word === 'light' || word === 'lighter') return { kind: 'mass', heavy: false };
  if (/^(glow|glowing|glowy|shine|shiny)$/.test(word)) return { kind: 'glow' };
  if (/^(spin|spinning|rotate|rotating)$/.test(word)) return { kind: 'behavior', behavior: 'spin' };
  if (/^(bob|bobbing|float|floating|hover)$/.test(word)) return { kind: 'behavior', behavior: 'bob' };
  if (/^(fall|falling|dynamic|physical)$/.test(word)) return { kind: 'body', body: 'dynamic' };
  if (/^(static|solid)$/.test(word)) return { kind: 'body', body: 'static' };
  if (/^(invisible|hidden|disappear)$/.test(word)) return { kind: 'visible', visible: false };
  if (/^(visible|appear)$/.test(word)) return { kind: 'visible', visible: true };
  if (word === 'faster') return { kind: 'speed', factor: 2 };
  if (word === 'slower') return { kind: 'speed', factor: 0.5 };
  return null;
}

/** Targets that mean "the world itself", handled by environment overrides. */
const WORLD_TARGETS = /^(it|everything|the world|world|the scene|scene|sky|the sky|this|things|all)$/;

function isPlural(target: string): boolean {
  return /s$/.test(target) && !/ss$/.test(target);
}

function parseClause(clause: string): Edit | null {
  let m = MODIFY.exec(clause);
  if (m && !/^(an?|some|one|\d+)$/.test((m[1] as string).trim())) {
    const target = (m[1] as string).trim();
    const change = changeFor(m[2] as string);
    if (change && !WORLD_TARGETS.test(target)) return { kind: 'modify', target, all: /\ball\b|\bevery\b/.test(clause) || isPlural(target), change };
    if (change) return null;
  }
  m = REMOVE.exec(clause);
  if (m) {
    const target = (m[2] as string).trim();
    if (target && !WORLD_TARGETS.test(target)) return { kind: 'remove', target, all: Boolean(m[1]) || isPlural(target) };
  }
  m = ADD.exec(clause);
  if (m) {
    const phrase = (m[2] as string).trim();
    if (phrase && !WORLD_TARGETS.test(phrase) && !/^(it|sure|them)\b/.test(phrase)) {
      const count = parseCount(m[1]) ?? (isPlural(phrase.split(' ').pop() ?? '') ? 5 : 1);
      return { kind: 'add', phrase, count: Math.max(1, Math.min(200, count)) };
    }
  }
  return null;
}

/** Environment overrides implied by mood words. */
function moodEnv(mood: Mood, text: string): Record<string, Json> {
  const env: Record<string, Json> = {};
  if (MOODS.day.test(text)) Object.assign(env, { sky: 'day', timeOfDay: 12, sunIntensity: 2.5, ambientIntensity: 0.45 });
  if (mood.dawn) Object.assign(env, { sky: 'dawn', timeOfDay: 6.5 });
  if (mood.dusk) Object.assign(env, { sky: 'sunset', timeOfDay: 17.5, bloom: 0.9 });
  if (mood.night) Object.assign(env, { sky: 'night', timeOfDay: 22, bloom: 1.2, ambientIntensity: 0.25, sunIntensity: 0.5 });
  if (mood.rain) Object.assign(env, { weather: 'rain', fog: { color: mood.night ? '#1d2430' : '#8a96a3', density: 0.02 }, ...(mood.night ? {} : { sky: 'overcast' }) });
  if (mood.snow) Object.assign(env, { weather: 'snow', fog: { color: mood.night ? '#2a3240' : '#dfe7ef', density: 0.015 } });
  if (mood.fog) env['fog'] = { color: mood.night ? '#1b2030' : '#c9d2dc', density: 0.03 };
  if (MOODS.clearSky.test(text)) Object.assign(env, { weather: 'clear', fog: null });
  if (MOODS.zeroGravity.test(text)) env['gravity'] = [0, 0, 0];
  else if (mood.lowGravity) env['gravity'] = [0, -1.62, 0];
  else if (MOODS.highGravity.test(text)) env['gravity'] = [0, -20, 0];
  else if (MOODS.normalGravity.test(text)) env['gravity'] = [0, -9.81, 0];
  return env;
}

function matchIndex(theme: Theme, text: string): number {
  const m = theme.match.exec(text);
  return m ? m.index : -1;
}

/** Normalize a raw request for matching. */
export function normalizeRequest(raw: string): string {
  return raw.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().slice(0, 2000);
}

/** Recognize themes, moods and edit commands. */
export function parseIntent(raw: string): Intent {
  const text = normalizeRequest(raw);
  const mood: Mood = {
    night: MOODS.night.test(text),
    dusk: MOODS.dusk.test(text),
    dawn: MOODS.dawn.test(text),
    rain: MOODS.rain.test(text),
    snow: MOODS.snow.test(text),
    fog: MOODS.fog.test(text),
    lowGravity: MOODS.lowGravity.test(text) || MOODS.zeroGravity.test(text),
    water: MOODS.water.test(text),
  };
  const ranked = ALL_THEMES.map((t) => ({ t, i: matchIndex(t, text) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i);
  const settings = ranked.filter((x) => x.t.kind === 'setting').map((x) => x.t);
  const activities = ranked.filter((x) => x.t.kind === 'activity').map((x) => x.t);
  const countMatch = COUNT_RE.exec(text);
  const durationMatch = DURATION_RE.exec(text);
  const edits: Edit[] = [];
  const clauses = text.split(/[,.;!?]|\band then\b|\bthen\b|\balso\b|\band\b(?=\s+(?:add|make|remove|delete|turn|paint|put|place|spawn|plant|set|change|give|color|colour|get rid)\b)/);
  for (const clause of clauses) {
    const e = parseClause(clause.trim());
    if (e) edits.push(e);
  }
  const intent: Intent = { text, mood, env: moodEnv(mood, text), settings, activities, edits, clear: CLEAR.test(text),
    create: CREATE.test(text),
    describesScene: !EDIT_LEAD.test(text) && !INCREMENTAL.test(text),
  };
  if (countMatch) intent.count = Number(countMatch[1]);
  if (durationMatch) {
    const unit = durationMatch[2] ?? 's';
    const secs = Number(durationMatch[1]) * (unit.startsWith('m') ? 60 : 1);
    intent.seconds = Math.min(900, Math.max(10, secs));
  }
  return intent;
}
