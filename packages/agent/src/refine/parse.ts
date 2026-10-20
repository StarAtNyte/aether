/**
 * Local intent parser for small edits: plain language → {@link Command}s,
 * without a model round trip. Deliberately conservative: when a clause is
 * not understood it yields nothing, and the request goes to the model.
 */
import type { Command, EnvIntent, Look, Placement, Ref } from './command';
import { MATERIAL_WORDS, SHADE_WORDS, COLOR_FAMILIES, COLOR_WORDS, TONE_ONLY_COLORS, amountMetres, findColor, findMaterial, parseNumber, singular, sizeFactor } from './lexicon';
import { cleanPhrase, flattenPart, isEmptyRef, parseRef, ROOM_WORDS } from './parse-ref';

/** Result of {@link parseEdit}. */
export interface ParsedEdit {
  commands: Command[];
  /** The user clearly asks for a new world (start over). */
  newWorld: boolean;
  /** The text is a question or chat, not an instruction. */
  question: boolean;
  /** Clauses that look like edits but were not understood. */
  unparsed: string[];
}

const LEAD = /^(?:(?:ok(?:ay)?|now|so|and|then|also|please|hey|well|actually|just|ah|um|yes|yeah|alright|right)[, ]+)*(?:(?:can|could|would|will) you(?: please)?|i(?:'d| would) like(?: you)? to|i want(?: you)? to|i need(?: you)? to|let'?s|lets|go ahead and|try to|you should|i'd like)?\s*/;

const NEW_WORLD = /\b(?:start (?:over|again|fresh|a new)|from scratch|new (?:world|scene|project|game|level)|brand new (?:world|scene|game)|build (?:me )?(?:a )?new|create (?:me )?(?:a )?new|different (?:world|scene)|replace (?:the )?(?:whole|entire) (?:world|scene)|scrap (?:this|it|everything)|throw (?:this|it) away|wipe (?:it|everything|the world))\b/;

const SIZE_UP = new Set(['bigger', 'larger', 'taller', 'wider', 'longer', 'thicker', 'huge', 'giant', 'massive', 'enormous', 'big', 'large', 'tall', 'wide', 'long', 'thick', 'bulkier', 'chunkier', 'enlarged', 'grown', 'higher']);
const SIZE_DOWN = new Set(['smaller', 'shorter', 'narrower', 'thinner', 'tinier', 'tiny', 'small', 'short', 'narrow', 'thin', 'slimmer', 'little', 'shrunk', 'lower', 'compact']);
const SIZE_WORDS = new Set([...SIZE_UP, ...SIZE_DOWN]);
const SHAPE_WORDS = new Set(['round', 'circular', 'square', 'rectangular', 'oval', 'hexagonal', 'octagonal', 'rounded', 'curved', 'straight', 'triangular', 'angular', 'elliptical']);
const SPEED_WORDS = new Set(['faster', 'slower', 'quicker', 'speedier', 'swifter', 'fast', 'slow', 'quick']);
const TONE_WORDS = new Set(['darker', 'lighter', 'brighter', 'dimmer', 'warmer', 'cooler', 'duller', 'paler', 'richer', 'deeper', 'softer']);
const LOOK_WORDS = new Set(['translucent', 'glow', 'glowing', 'luminous', 'emissive', 'see', 'through', 'striped', 'damask', 'geometric', 'scallop', 'checkered', 'checked', 'plaid', 'floral', 'patterned', 'polka', 'dotted', 'textured', 'glossy', 'matte', 'shiny', 'metallic', 'transparent', 'wallpaper', 'wallpapered', 'colour', 'color', 'finish', 'material', 'subway', 'brushed', 'frosted', 'black', 'gloss']);
const VIS_WORDS = new Set(['invisible', 'hidden', 'visible', 'gone']);
const PHYS_WORDS = new Set(['bouncy', 'bouncier', 'heavier', 'heavy', 'static', 'slippery', 'sticky', 'solid', 'floating']);
const DOOR_WORDS = new Set(['open', 'closed', 'shut', 'outwards', 'outward', 'inwards', 'inward']);
const BEHAVIOR_WORDS = new Set(['spin', 'spinning', 'rotate', 'rotating', 'bob', 'bobbing', 'float', 'hover', 'hovering']);
const MODS = new Set(['a', 'an', 'bit', 'little', 'slightly', 'much', 'way', 'lot', 'more', 'very', 'so', 'too', 'to', 'into', 'be', 'is', 'up', 'down', 'again', 'twice', 'as', 'half', 'times', 'x', 'percent', '%', 'm', 'meter', 'meters', 'metre', 'metres', 'cm', 'ft', 'feet', 'degrees', 'degree', 'deg', 'in', 'than', 'the', 'now', 'bit.', 'abit', 'far', 'bright', 'dark', 'light', 'deep', 'pale', 'tad', 'touch', 'somewhat', 'rather', 'also', 'its', 'of', 'with', 'and', 'on', 'for', 'all', 'over', 'out']);

const MATERIAL_SINGLES = new Set<string>();
for (const k of Object.keys(MATERIAL_WORDS)) for (const w of k.split(' ')) MATERIAL_SINGLES.add(w);

const PRED_VOCAB: ReadonlySet<string> = new Set([
  ...SIZE_WORDS, ...SHAPE_WORDS, ...SPEED_WORDS, ...TONE_WORDS, ...LOOK_WORDS, ...VIS_WORDS, ...PHYS_WORDS, ...DOOR_WORDS, ...BEHAVIOR_WORDS, ...MATERIAL_SINGLES, ...COLOR_WORDS, ...SHADE_WORDS,
]);

const ROOM_NOUNS: ReadonlySet<string> = ROOM_WORDS;

function words(text: string): string[] {
  return text.split(' ').filter(Boolean);
}

/** Split `rest` into (subject phrase, predicate words) by absorbing the longest predicate-vocabulary suffix. */
/** Which kind of predicate a word belongs to ('neutral': degree words, numbers). */
function predClass(t: string): 'size' | 'speed' | 'shape' | 'phys' | 'vis' | 'door' | 'behavior' | 'look' | 'neutral' {
  if (SIZE_WORDS.has(t)) return 'size';
  if (SPEED_WORDS.has(t)) return 'speed';
  if (SHAPE_WORDS.has(t)) return 'shape';
  if (PHYS_WORDS.has(t)) return 'phys';
  if (VIS_WORDS.has(t)) return 'vis';
  if (DOOR_WORDS.has(t)) return 'door';
  if (BEHAVIOR_WORDS.has(t)) return 'behavior';
  if (PRED_VOCAB.has(t) && !MODS.has(t)) return 'look';
  return 'neutral';
}

function splitPredicate(rest: string): { subject: string; pred: string } {
  const w = words(rest.replace(/\bcolou?r\b/g, ' ').replace(/\s+/g, ' ').trim());
  let i = w.length;
  // A predicate is about one thing: "bigger" ends it even if the word before is a material ("the hallway mirror bigger").
  const last = w[w.length - 1] ?? '';
  const lastClass = predClass(last);
  while (i > 0) {
    const t = w[i - 1] as string;
    const toneOnly = TONE_ONLY_COLORS.has(t) && !COLOR_FAMILIES.includes(w[i] ?? '');
    const cls = predClass(t);
    const sameKind = cls === 'neutral' || lastClass === 'neutral' || cls === lastClass;
    if (!toneOnly && sameKind && (PRED_VOCAB.has(t) || MODS.has(t) || /^\d+(\.\d+)?$/.test(t) || /^#[0-9a-f]{6}$/.test(t))) i--;
    else break;
  }
  // The subject keeps at least one noun: give predicate-vocabulary words back ("the carpet blue").
  const isNounish = (t: string): boolean => !MODS.has(t) && !/^\d+(\.\d+)?$/.test(t);
  const PRON = ['it', 'this', 'that', 'these', 'those', 'them'];
  while (i < w.length && !w.slice(0, i).some((t) => PRON.includes(t) || (isNounish(t) && !['the', 'a', 'an', 'my', 'its', 'all', 'every', 'each', 'both'].includes(t)))) i++;
  // Determiners at the boundary stay with the subject.
  while (i < w.length && ['the', 'a', 'an'].includes(w[i] as string) && i + 1 < w.length && false) i++;
  return { subject: w.slice(0, i).join(' '), pred: w.slice(i).join(' ') };
}

function placementOf(text: string): Placement | undefined {
  const t = cleanPhrase(text);
  if (!t) return undefined;
  const ref = parseRef(`x ${t}`);
  const out: Placement = {};
  if (ref.relation) out.relation = ref.relation;
  if (ref.room) out.room = ref.room;
  if (ref.side) out.side = ref.side;
  return out.relation || out.room || out.side ? out : undefined;
}

function lookOf(text: string): Look {
  const look: Look = {};
  const color = findColor(text);
  if (color) {
    look.color = color.hex;
    look.colorText = color.text;
  }
  if (/\bwallpaper(?:ed)?\b/.test(text)) look.material = 'wallpaper';
  else {
    const mat = findMaterial(text.replace(color ? color.text : '', ' '));
    if (mat) look.material = mat.text;
    // Words that are both a colour and a material ("walnut", "gold", "stone") mean the material.
    const whole = findMaterial(text);
    if (!mat && whole && color && whole.text === color.text.split(' ').pop()) {
      look.material = whole.text;
      delete look.color;
      delete look.colorText;
    }
  }
  const toneWord = /\b(dark|darker|light|lighter|deep|deeper|pale|paler|bright|brighter)\b/.exec(text);
  if (toneWord && !look.color && look.material && !/\bwallpaper\b/.test(text)) look.tone = toneWord[1] as string;
  if (/\b(transparent|see[- ]through|translucent)\b/.test(text)) look.opacity = 0.35;
  if (/\b(glowing|glow|luminous|emissive)\b/.test(text)) look.glow = true;
  if (/\bmetallic\b/.test(text)) look.metal = true;
  const pattern = /\b(striped|checkered|checked|plaid|floral|patterned|polka dot|dotted|damask|geometric|scallop)\b/.exec(text);
  if (pattern) look.pattern = pattern[1] as string;
  if (/\b(glossy|shiny|gloss|polished)\b/.test(text)) look.finish = 'glossy';
  else if (/\bmatte\b/.test(text)) look.finish = 'matte';
  const adj = /\b(darker|lighter|brighter|duller|warmer|cooler|paler|richer|deeper)\b/.exec(text);
  if (adj && !look.color) {
    const map: Record<string, NonNullable<Look['adjust']>['dir']> = { darker: 'darker', deeper: 'darker', richer: 'darker', lighter: 'lighter', paler: 'lighter', brighter: 'brighter', duller: 'duller', warmer: 'warmer', cooler: 'cooler' };
    const mild = /\b(?:a\s+)?(?:bit|little|slightly|touch|tad|somewhat)\b/.test(text);
    const strong = /\b(?:much|way|lot|far|a\s+lot)\b/.test(text);
    look.adjust = { dir: map[adj[1] as string] ?? 'darker', amount: mild ? 0.15 : strong ? 0.5 : 0.3 };
  }
  return look;
}

function hasLook(look: Look): boolean {
  return look.color !== undefined || look.material !== undefined || look.pattern !== undefined || look.finish !== undefined || look.adjust !== undefined || look.opacity !== undefined || look.glow === true || look.metal === true;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const WORLD_SUBJECT = /\b(?:it|the (?:sky|world|scene|time|day|weather|atmosphere|lighting|mood|environment|light|ground|terrain|place|map|level|everything)|everything|sky|time of day|the whole (?:thing|world|scene))\b/;

function timeFromText(t: string): number | undefined {
  const m = /\b(?:at |to |for |around |about )?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/.exec(t) ?? /\b(?:time|clock)\s+(?:to |at |of )?(\d{1,2}):(\d{2})\b()/.exec(t);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = (m[3] ?? '').replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 24) return undefined;
  return h + min / 60;
}

const ENV_VOCAB = new Set([
  'sky', 'skies', 'time', 'day', 'daytime', 'night', 'nighttime', 'midnight', 'noon', 'midday', 'morning', 'afternoon', 'evening', 'dusk', 'dawn', 'sunset', 'sunrise', 'twilight', 'golden', 'hour', 'moonlit', 'moonlight', 'starry', 'overcast', 'cloudy', 'clear',
  'rain', 'raining', 'rainy', 'storm', 'stormy', 'drizzle', 'snow', 'snowing', 'snowy', 'blizzard', 'fog', 'foggy', 'mist', 'misty', 'haze', 'hazy', 'dust', 'fireflies', 'petals', 'leaves', 'weather', 'winter', 'autumn', 'spring', 'summer', 'fall',
  'gravity', 'low', 'zero', 'high', 'normal', 'moon', 'lunar', 'light', 'lighting', 'brighter', 'darker', 'dimmer', 'lighter', 'bloom', 'glow', 'ground', 'terrain', 'grass', 'sand', 'sandy', 'muddy', 'later', 'earlier', 'hours', 'atmosphere', 'mood', 'look', 'vibe',
  'make', 'turn', 'set', 'change', 'switch', 'it', 'the', 'a', 'an', 'to', 'into', 'of', 'at', 'in', 'with', 'some', 'more', 'less', 'no', 'add', 'let', 'be', 'is', 'was', 'please', 'now', 'world', 'scene', 'everything', 'whole', 'thing', 'stop', 'remove', 'get', 'rid', 'go', 'and', 'then', 'also', 'give', 'put', 'sun', 'sunny', 'am', 'pm', 'real', 'very', 'much', 'bit', 'little', 'slightly', 'heavy', 'thick', 'thin', 'bright', 'dark', 'only', 'just', 'scenes',
]);

/** True when most of the clause is environment talk ("make it night") rather than a described scene ("a cozy village by a lake at sunset"). */
function mostlyEnvironment(t: string): boolean {
  const left = t.toLowerCase().replace(/\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?/g, ' ').split(/[^a-z]+/).filter((w) => w.length > 0 && !ENV_VOCAB.has(w));
  return left.length === 0;
}

/** Environment intent in `t`, or null. */
export function parseEnv(t: string): EnvIntent | null {
  if (!mostlyEnvironment(t)) return null;
  const env: EnvIntent = {};
  const about = WORLD_SUBJECT.test(t);
  const verb = /\b(?:make|turn|set|change|switch|give|put|let|have|bring|add|go|want|need|would like)\b/.test(t) || /^[a-z ]{0,24}$/.test(t);
  const bare = /^(?:(?:a|the|some|more|less|no|much|very|real|heavy|light)\s+){0,2}(?:night|nighttime|sunset|sunrise|dusk|dawn|day|daytime|noon|midnight|evening|morning|rain|rainy|snow|snowy|fog|foggy|misty|storm|stormy|winter|autumn|summer|spring|golden hour|overcast|cloudy|clear skies?)(?: time| scene| sky| mood| look| vibe)?$/.test(t.trim());
  if (!about && !bare && !/\b(?:sky|weather|fog|rain|snow|gravity|time of day|sunset|sunrise|daylight|moonlight|starry|stars)\b|^(?:more|less|stronger|weaker)\s+(?:bloom|glow)$/.test(t)) return null;
  // Entity-directed phrases are not environment changes ("make the roof snowy", "make the lamp brighter").
  const clock = timeFromText(t);
  if (clock !== undefined && /\b(?:time|clock|sun|hour|day|set it|make it|at)\b/.test(t)) env.timeOfDay = clock;
  if (/\b(?:night|nighttime|night-time|midnight|moonlit|moonlight|starry|nocturnal|dark sky)\b/.test(t)) Object.assign(env, { sky: 'night', timeOfDay: env.timeOfDay ?? 22 });
  else if (/\b(?:sunset|dusk|evening|golden hour|twilight)\b/.test(t)) Object.assign(env, { sky: 'sunset', timeOfDay: env.timeOfDay ?? 17.8 });
  else if (/\b(?:sunrise|dawn|daybreak|early morning)\b/.test(t)) Object.assign(env, { sky: 'dawn', timeOfDay: env.timeOfDay ?? 6.5 });
  else if (/\b(?:noon|midday|daytime|bright day|sunny day|full daylight|make it day|to day|during the day|clear day)\b/.test(t)) Object.assign(env, { sky: 'day', timeOfDay: env.timeOfDay ?? 12.5 });
  else if (/\b(?:overcast|cloudy sky|gloomy|grey sky|gray sky|dull sky)\b/.test(t)) env.sky = 'overcast';
  else if (/\b(?:space sky|outer space|in space)\b/.test(t)) env.sky = 'space';
  else if (/\b(?:morning)\b/.test(t) && about) Object.assign(env, { sky: 'dawn', timeOfDay: 8 });
  else if (/\b(?:afternoon)\b/.test(t) && about) Object.assign(env, { sky: 'day', timeOfDay: 15 });
  if (/\b(?:later|later in the day|an hour later|hours later)\b/.test(t) && about) env.timeShift = /(\d+)\s*hours?/.test(t) ? Number((/(\d+)\s*hours?/.exec(t) as RegExpExecArray)[1]) : 2;
  if (/\b(?:earlier|earlier in the day)\b/.test(t) && about) env.timeShift = /(\d+)\s*hours?/.test(t) ? -Number((/(\d+)\s*hours?/.exec(t) as RegExpExecArray)[1]) : -2;
  // Weather.
  if (/\b(?:stop|no more|without|remove|get rid of|clear|end|disable|turn off)\b[^.]*\b(?:rain|snow|storm|weather|fog|mist|haze)\b|\bclear (?:sky|skies|weather)\b|\bsunny\b/.test(t) && !/\bfog\b|\bmist\b|\bhaze\b/.test(t)) env.weather = 'clear';
  else if (/\b(?:rain|raining|rainy|drizzle|downpour|storm|stormy|thunder\w*|showers?)\b/.test(t)) env.weather = 'rain';
  else if (/\b(?:snow|snowing|snowy|snowfall|blizzard|flurries)\b/.test(t) && (about || bare || /\b(?:let it|make it|start|add|some)\b/.test(t))) env.weather = 'snow';
  else if (/\b(?:fireflies|glow ?worms)\b/.test(t)) env.weather = 'fireflies';
  else if (/\b(?:petals|cherry blossoms?|sakura)\b/.test(t) && about) env.weather = 'petals';
  else if (/\b(?:falling leaves|autumn leaves|leaves falling)\b/.test(t)) env.weather = 'leaves';
  else if (/\b(?:dust|sandstorm|dusty air)\b/.test(t) && about) env.weather = 'dust';
  // Fog.
  if (/\b(?:fog|foggy|mist|misty|haze|hazy|murky)\b/.test(t)) {
    if (/\b(?:no|remove|without|clear|less|stop|lift|get rid of|reduce|thinner|disable)\b/.test(t)) env.fog = /\bless|reduce|thinner\b/.test(t) ? 'less' : 'none';
    else if (/\b(?:more|thicker|denser|heavier|deeper)\b/.test(t)) env.fog = 'more';
    else env.fog = 'on';
  }
  // Sun / ambient brightness of the whole scene.
  const bright = /\b(?:brighter|lighter|more light|more sun|sunnier|lighten|brighten|more exposure)\b/.test(t);
  const dim = /\b(?:darker|dimmer|less light|dim|darken|moodier|gloomier)\b/.test(t);
  if ((bright || dim) && /\b(?:the (?:sky|world|scene|lighting|light|day|place|map|level|environment|atmosphere)|everything|the whole (?:thing|world|scene))\b/.test(t) && !env.sky && !env.weather) {
    const f = sizeFactor(t, bright);
    env.sunFactor = f;
    env.ambientFactor = f;
  }
  if (/\b(?:more|stronger|bigger)\s+(?:bloom|glow)\b|\bmore glow\b/.test(t)) env.bloomFactor = 1.5;
  if (/\b(?:less|weaker|no)\s+(?:bloom|glow)\b/.test(t)) env.bloomFactor = 0.4;
  // Gravity.
  if (/\b(?:zero|no) gravity\b|\bweightless\b/.test(t)) env.gravity = 'zero';
  else if (/\b(?:low|moon|lunar|reduced|weak|less|lower) gravity\b|\bmoon ?jump\b/.test(t)) env.gravity = 'low';
  else if (/\b(?:high|strong|heavy|more|double|higher|stronger) gravity\b/.test(t)) env.gravity = 'high';
  else if (/\b(?:normal|earth|regular|default) gravity\b/.test(t)) env.gravity = 'normal';
  // Seasons as a themed bundle.
  const season = /\b(?:winter|wintry|winterize|autumn|autumnal|fall foliage|spring|springtime|summer|summery)\b/.exec(t);
  if (season && (about || verb) && !/\b(?:the|a|an)\s+(?:winter|autumn|spring|summer)\s+(?:coat|jacket|dress)\b/.test(t)) {
    const s = season[0];
    env.season = /winter/.test(s) ? 'winter' : /autumn|fall/.test(s) ? 'autumn' : /spring/.test(s) ? 'spring' : 'summer';
  }
  // Ground.
  const gm = /\b(?:make|turn|change|set|cover)\s+(?:the\s+)?(?:ground|terrain|floor outside|grass|earth)\s+(?:to |into |with |in )?(.+)$/.exec(t);
  if (gm && /\b(?:ground|terrain|grass|earth)\b/.test(t)) {
    const rest = (gm[1] as string).replace(/\b(?:ly|y)\b/g, ' ');
    const look = lookOf(rest + ' ' + rest.replace(/(snow|sand|mud|rock|grass|dirt|gravel|stone|water|lava|ice)y\b/g, '$1'));
    const gmat = /\b(snow|sand|mud|dirt|grass|gravel|stone|rock|water|lava|ice)\w*/.exec(rest);
    if (gmat && !look.material) look.material = (gmat[1] === 'mud' ? 'dirt' : gmat[1] === 'rock' ? 'stone' : gmat[1]) as string;
    if (hasLook(look)) env.groundMaterial = look;
  }
  if (/\b(?:remove|delete|hide|no)\s+(?:the\s+)?ground\b|\bwithout (?:a )?ground\b/.test(t)) env.groundNone = true;
  return Object.keys(env).length > 0 ? env : null;
}

// ---------------------------------------------------------------------------
// Clause parsers
// ---------------------------------------------------------------------------

const MOVE_DIRS: ReadonlyArray<[RegExp, NonNullable<Extract<Command, { op: 'move' }>['direction']>]> = [
  [/\b(?:to the )?left\b/, 'left'],
  [/\b(?:to the )?right\b/, 'right'],
  [/\b(?:forward|forwards|away|further back|backwards? (?:in|into) the room|toward the back)\b/, 'forward'],
  [/\b(?:backward|backwards|back|towards me|closer|toward me|nearer)\b/, 'back'],
  [/\b(?:up|upward|upwards|higher|raise|lift)\b/, 'up'],
  [/\b(?:down|downward|downwards|lower|lower it|drop)\b/, 'down'],
  [/\bnorth(?:ward)?\b/, 'north'],
  [/\bsouth(?:ward)?\b/, 'south'],
  [/\beast(?:ward)?\b/, 'east'],
  [/\bwest(?:ward)?\b/, 'west'],
];

const REL_RE = /\b(?:to the left of|left of|to the right of|right of|on top of|above|over|below|beneath|underneath|under|behind|in front of|next to|beside|alongside|near|close to|by)\b/;

function parseMove(c: string): Command | null {
  const m = /^(?:move|shift|push|slide|nudge|drag|shove|bring|put|place|position|relocate|set|slip|pull|carry)\s+(.+)$/.exec(c) ?? /^(raise|lift|lower)\s+(.+)$/.exec(c);
  if (!m) return null;
  const verb = (c.match(/^[a-z]+/) as RegExpMatchArray)[0];
  // "onto the hill" / "on to the table" is "on top of"; so is "on" after a named object ("put the vase on the shelf").
  let rest = ((m[2] ?? m[1]) as string).replace(/\b(?:onto|on to)\b/, 'on top of');
  if (/^(?:the|that|this|my|those|these)\s/.test(rest) && !REL_RE.test(rest)) rest = rest.replace(/\s+on\s+(?=(?:the|that|this|my|a|an)\s)/, ' on top of ');
  if (verb === 'raise' || verb === 'lift' || verb === 'lower') {
    const { subject } = splitMoveSubjectRoom(rest);
    return { op: 'move', ref: parseRef(subject), direction: verb === 'lower' ? 'down' : 'up', metres: amountMetres(rest) === 1 && !/\d/.test(rest) ? 0.5 : amountMetres(rest) };
  }
  // "closer to the window": a relation to something, not a direction.
  const toward = /^(.+?)\s+(?:(?:a\s+(?:bit|little)|slightly|much)\s+)?(?:closer|nearer)\s+(?:to|towards?)\s+(?:the\s+)?(.+)$/.exec(rest) ?? /^(.+?)\s+towards?\s+(?:the\s+)?(.+)$/.exec(rest);
  if (toward) return { op: 'move', ref: parseRef(toward[1] as string), metres: 0, to: { rel: 'next to', anchor: parseRef(toward[2] as string) } };
  if (/\baway from\b/.test(rest)) return null;
  if (verb === 'set' || verb === 'put' || verb === 'place' || verb === 'position') {
    // "put the lamp next to the sofa" is a relative move; "put a rug ..." is an add.
    if (/^(?:an?|some|\d+|two|three|four|five)\s/.test(rest)) return null;
    if (!REL_RE.test(rest) && !/\b(?:left|right|forward|back|up|down|corner|centre|center|middle)\b/.test(rest)) return null;
    if (verb === 'set' && !/\bposition\b/.test(rest) && !REL_RE.test(rest)) return null;
  }
  // Relative to an anchor.
  const relM = REL_RE.exec(rest);
  if (relM) {
    const left = rest.slice(0, relM.index).trim();
    const right = rest.slice(relM.index).trim();
    // "move the lamp a bit left of the window" → relation; "move the lamp to the left, away from the window" ignored.
    const subj = splitMoveSubject(left).subject;
    const spec = parseRef(`${subj} ${right}`);
    if (spec.relation) {
      const { relation, ...base } = spec;
      return { op: 'move', ref: { ...base, text: subj.trim() || base.text }, metres: amountMetres(rest), to: relation };
    }
  }
  const to = /\b(?:to|into)\s+(?:the\s+)?(.+)$/.exec(rest);
  if (to && !MOVE_DIRS.some(([re]) => re.test(rest.replace(to[0], '')))) {
    const target = parseRef(to[1] as string);
    const subj = parseRef(rest.slice(0, to.index));
    if (target.noun && ROOM_NOUNS.has(target.noun)) return { op: 'move', ref: subj, metres: 0, toRoom: target };
  }
  const { subject, tail } = splitMoveSubjectRoom(rest);
  for (const [re, dir] of MOVE_DIRS) {
    if (re.test(tail) || (tail === '' && re.test(rest.slice(subject.length)))) {
      return { op: 'move', ref: parseRef(subject), direction: dir, metres: amountMetres(tail || rest) };
    }
  }
  return null;
}

/** Like {@link splitMoveSubject}, but "in the living room" belongs to the subject. */
function splitMoveSubjectRoom(rest: string): { subject: string; tail: string } {
  const split = splitMoveSubject(rest);
  const inRoom = /^(?:in|inside|within|of)\s+(?:the\s+)?((?:[a-z0-9]+\s+){0,2}(?:room|kitchen|hall|hallway|bathroom|bedroom|office|garage|studio|lobby|terrace|balcony|attic|cellar|basement|study|loft|toilet|nursery|pantry|cafe))\b\s*(.*)$/.exec(split.tail);
  return inRoom ? { subject: `${split.subject} in ${inRoom[1] as string}`, tail: inRoom[2] as string } : split;
}

/** Split "the lamp a bit to the left" into subject "the lamp" and tail "a bit to the left". */
function splitMoveSubject(rest: string): { subject: string; tail: string } {
  const w = words(rest);
  const stop = new Set(['a', 'an', 'bit', 'little', 'slightly', 'to', 'by', 'over', 'up', 'down', 'left', 'right', 'forward', 'forwards', 'back', 'backward', 'backwards', 'away', 'closer', 'higher', 'lower', 'further', 'more', 'some', 'just', 'much', 'way', 'lot', 'far', 'north', 'south', 'east', 'west', 'toward', 'towards', 'one', 'half', 'about', 'around', 'tiny', 'touch', 'tad', 'upward', 'downward', 'upwards', 'downwards', 'nearer', 'again', 'out', 'in']);
  let i = 0;
  while (i < w.length) {
    const t = w[i] as string;
    if (i > 0 && (stop.has(t) || /^\d/.test(t))) break;
    i++;
  }
  return { subject: w.slice(0, i).join(' '), tail: w.slice(i).join(' ') };
}

function parseRotate(c: string): Command | null {
  const m = /^(?:rotate|turn|spin|swivel|twist|flip|pivot|angle)\s+(.+)$/.exec(c);
  if (!m) return null;
  const rest = m[1] as string;
  if (!/\b(?:degrees?|deg|°|around|clockwise|counter-?clockwise|anti-?clockwise|quarter|half turn|face|facing|left|right|a bit|a little|slightly|flip|\d+)\b/.test(rest) && !/°/.test(rest)) return null;
  if (/\b(?:into|to)\s+(?:a\s+)?\w+/.test(rest) && !/\b(?:degrees?|deg|°|around|clockwise|quarter|half|face|left|right)\b/.test(rest)) return null;
  const deg = /(-?\d+(?:\.\d+)?)\s*(?:degrees?|deg|°)/.exec(rest);
  let degrees = deg ? Number(deg[1]) : /\bquarter\b/.test(rest) ? 90 : /\b(?:around|half|180|flip|opposite)\b/.test(rest) ? 180 : /\b(?:a\s+)?(?:bit|little|slightly)\b/.test(rest) ? 15 : 90;
  if (/\b(?:counter-?clockwise|anti-?clockwise|left)\b/.test(rest)) degrees = Math.abs(degrees);
  else if (/\b(?:clockwise|right)\b/.test(rest)) degrees = -Math.abs(degrees);
  const subject = rest.replace(/\b(?:by|to|around|degrees?|deg|°|clockwise|counter-?clockwise|anti-?clockwise|a bit|a little|slightly|quarter turn|half turn|turn|left|right|-?\d+(?:\.\d+)?)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!subject) return null;
  return { op: 'rotate', ref: parseRef(subject), degrees };
}

const DIMENSION_WORDS: Readonly<Record<string, 'width' | 'height' | 'depth' | 'length' | 'radius' | 'size' | 'thickness'>> = {
  tall: 'height', high: 'height', height: 'height', wide: 'width', width: 'width', long: 'length', length: 'length', deep: 'depth', depth: 'depth', thick: 'thickness', thickness: 'thickness', radius: 'radius', diameter: 'radius', size: 'size',
};

function unitToMetres(value: number, unit: string): number {
  if (/^cm|centi/.test(unit)) return value / 100;
  if (/^(?:ft|feet|foot)/.test(unit)) return value * 0.3048;
  if (/^(?:in|inch)/.test(unit)) return value * 0.0254;
  return value;
}

function parseScale(c: string): Command | null {
  // "make X N meters tall", "set the table width to 2 m"
  const abs = /^(?:make|set|resize|change)\s+(.+?)\s+(?:(?:to\s+)?(?:be\s+)?)?(\d+(?:\.\d+)?)\s*(m|cm|meters?|metres?|centimet\w+|ft|feet|foot|inch(?:es)?)\s*(tall|high|wide|long|deep|thick)?$/.exec(c) ?? /^(?:set|change)\s+(?:the\s+)?(.+?)\s+(height|width|length|depth|thickness|radius|size)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(m|cm|meters?|metres?|ft|feet)?$/.exec(c);
  if (abs) {
    if (c.includes(' height ') || c.includes(' width ') || c.includes(' length ') || c.includes(' depth ') || c.includes(' radius ') || c.includes(' thickness ') || c.includes(' size ')) {
      const dim = DIMENSION_WORDS[abs[2] as string] ?? 'size';
      return { op: 'resize', ref: parseRef(abs[1] as string), dimension: dim, value: unitToMetres(Number(abs[3]), (abs[4] as string | undefined) ?? 'm') };
    }
    const dim = DIMENSION_WORDS[(abs[4] as string | undefined) ?? 'size'] ?? 'size';
    return { op: 'resize', ref: parseRef(abs[1] as string), dimension: dim, value: unitToMetres(Number(abs[2]), abs[3] as string) };
  }
  const verb = /^(enlarge|expand|grow|shrink|scale|resize|stretch|squash|widen|lengthen|heighten|thicken|thin|narrow|shorten|enlarge)\s+(.+)$/.exec(c);
  if (verb) {
    const v = verb[1] as string;
    const rest = verb[2] as string;
    const grow = /^(?:enlarge|expand|grow|widen|lengthen|heighten|thicken|stretch)$/.test(v) ? true : /^(?:shrink|squash|thin|narrow|shorten)$/.test(v) ? false : !/\b(?:down|smaller|less|half)\b/.test(rest);
    const subject = rest.replace(/\b(?:by|to|a bit|a little|slightly|much|double|twice|half|by a factor of|\d+(?:\.\d+)?\s*(?:%|percent|x|times)?|up|down)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const axis = v === 'widen' || v === 'narrow' ? 'x' : v === 'heighten' || v === 'shorten' ? 'y' : v === 'lengthen' ? 'z' : undefined;
    if (!subject) return null;
    return { op: 'scale', ref: parseRef(subject), factor: sizeFactor(rest, grow), ...(axis ? { axis } : {}) };
  }
  if (/^(?:double|halve|triple)\s+/.test(c)) {
    const m = /^(double|halve|triple)\s+(?:the\s+)?(?:size of\s+)?(.+)$/.exec(c);
    if (m) return { op: 'scale', ref: parseRef(m[2] as string), factor: m[1] === 'double' ? 2 : m[1] === 'triple' ? 3 : 0.5 };
  }
  return null;
}

function parseShape(c: string): Command | null {
  const m = /^(?:make|turn|change|set|convert|reshape)\s+(.+?)\s+(?:into |to |a |an |be |more )*(round|circular|square|rectangular|oval|hexagonal|octagonal|rounded|curved|straight|triangular|elliptical)(?: one)?$/.exec(c);
  if (!m) return null;
  return { op: 'shape', ref: parseRef(m[1] as string), word: m[2] as string };
}

function parseRemove(c: string): Command | null {
  const out = /^take\s+(?:the\s+)?(.+?)\s+out(?:\s+of\s+(?:the\s+)?(.+))?$/.exec(c);
  if (out) {
    const ref = parseRef(out[2] ? `${out[1] as string} in ${out[2]}` : (out[1] as string));
    if (!isEmptyRef(ref)) return { op: 'remove', ref };
  }
  const m = /^(?:remove|delete|destroy|erase|get rid of|take away|take out|clear away|eliminate|trash|scrap|drop|dismiss|lose|ditch|bin|clear)\s+(?:the\s+)?(.+)$/.exec(c);
  if (!m) return null;
  const rest = m[1] as string;
  if (/^(?:the )?(?:fog|rain|snow|weather|mist|haze|storm|clouds?\b)/.test(rest) && !/\b(?:clouds? from|tree)\b/.test(rest)) return null;
  const ref = parseRef(rest);
  if (isEmptyRef(ref)) return null;
  return { op: 'remove', ref };
}

const COUNT_WORDS = /^(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|some|several|a few|a couple of|a couple|a pair of|a dozen|a bunch of|few|more|another|extra|couple)\s+/;

function countOf(word: string | undefined): number {
  if (!word) return 1;
  const w = word.trim().toLowerCase();
  if (/^(?:a|an|one|another)$/.test(w)) return 1;
  if (/^(?:some|several|few|a few|more)$/.test(w)) return 3;
  if (/^(?:a couple|a couple of|couple|a pair of)$/.test(w)) return 2;
  if (/^(?:a dozen)$/.test(w)) return 12;
  if (/^(?:a bunch of)$/.test(w)) return 6;
  return Math.max(1, Math.min(100, parseNumber(w) ?? 1));
}

function parseAdd(c: string): Command | null {
  const m = /^(?:add|place|put|spawn|plant|build|insert|create|install|hang|drop|throw in|include|fit|set up|stick|pop|give (?:me|us|it)|bring in|introduce|get me|i want|i need|there should be|let there be)\s+(?:in\s+)?(.+)$/.exec(c);
  if (!m) return null;
  let rest = m[1] as string;
  rest = rest.replace(/^(?:in|into)\s+/, '');
  // Surface treatments are paint, not new objects.
  if (/\b(?:wallpaper|paint|tiles?|panelling|paneling|cladding|plaster|render|stain|varnish)\b/.test(rest) && /\b(?:on|to|for|over|across|onto|in|around)\b/.test(rest)) return null;
  const cm = COUNT_WORDS.exec(rest);
  const count = countOf(cm?.[1]);
  const body = cm ? rest.slice(cm[0].length) : rest;
  // Split noun phrase from placement.
  const placeIdx = body.search(/\b(?:to|in|on|at|under|above|over|below|beneath|beside|next to|near|behind|by|against|around|inside|between|in front of|left of|right of|along|across)\b/);
  const nounPart = placeIdx > 0 ? body.slice(0, placeIdx).trim() : body.trim();
  const placeText = placeIdx > 0 ? body.slice(placeIdx).trim() : '';
  if (!nounPart) return null;
  // "a medieval village with a windmill and a market" is a scene to build, not one small thing to add.
  if (/\b(?:with|and|that|which|full of|filled|featuring|including|where|containing|plus)\b/.test(nounPart) || words(cleanPhrase(nounPart)).length > 4) return null;
  const look = lookOf(nounPart);
  const nounWords = words(cleanPhrase(nounPart)).filter((w) => !COLOR_WORDS.has(w) && !SHADE_WORDS.has(w) && !['new', 'extra', 'more', 'other', 'little', 'small', 'big', 'large', 'tiny', 'huge', 'nice', 'beautiful', 'cozy', 'cosy'].includes(w));
  if (nounWords.length === 0) return null;
  const noun = singular(nounWords[nounWords.length - 1] as string);
  const adjectives = nounWords.slice(0, -1);
  const placement = placementOf(placeText);
  return { op: 'add', noun, count: count === 1 && /s$/.test(nounWords[nounWords.length - 1] as string) && !/ss$/.test(nounWords[nounWords.length - 1] as string) && !cm ? 3 : count, adjectives, ...(hasLook(look) ? { look } : {}), ...(placement ? { placement } : {}), text: nounPart };
}

function parseDensity(c: string): Command | null {
  let m = /^(?:make|let|get)\s+(.+?)\s+(?:a\s+(?:bit|little|lot)\s+|much\s+|way\s+)?(denser|thicker|fuller|sparser|thinner|emptier)$/.exec(c);
  if (m) return { op: 'density', ref: parseRef(m[1] as string), factor: /denser|thicker|fuller/.test(m[2] as string) ? sizeFactor(c, true) : sizeFactor(c, false) };
  m = /^(?:thin out|thicken|densify)\s+(?:the\s+)?(.+)$/.exec(c);
  if (m) return { op: 'density', ref: parseRef(m[1] as string), factor: /^thin out/.test(c) ? 0.6 : 1.5 };
  m = /^(more|fewer|less)\s+(.+)$/.exec(c);
  if (m && !/\b(?:time|light|fog|rain|snow|gravity|glow|bloom|sun)\b/.test(m[2] as string)) {
    const more = m[1] === 'more';
    const ref = parseRef(m[2] as string);
    if (!isEmptyRef(ref)) return { op: 'density', ref, factor: more ? 1.6 : 0.55, ...(more ? { fallbackAdd: { noun: ref.noun, count: 3 } } : {}) };
  }
  return null;
}

function parseDuplicate(c: string): Command | null {
  const m = /^(?:duplicate|copy|clone|double up|replicate|make (?:a )?(?:copy|duplicate) of|make (\d+|two|three|four|five|another) more of)\s*(?:the\s+)?(.*)$/.exec(c);
  if (!m) return null;
  const refText = (m[2] as string).trim();
  if (!refText) return null;
  const nm = /\b(\d+|two|three|four|five)\s+(?:copies|times)\b/.exec(c);
  const count = nm ? countOf(nm[1]) : m[1] ? countOf(m[1]) : 1;
  const rel = /^(.+?)\s+((?:next to|beside|behind|in front of|to the left of|left of|to the right of|right of|above|under|near).+)$/.exec(refText);
  const placement = rel ? placementOf(rel[2] as string) : undefined;
  return { op: 'duplicate', ref: parseRef(rel ? (rel[1] as string) : refText), count, ...(placement ? { placement } : {}) };
}

function parseRename(c: string): Command | null {
  const m = /^(?:rename|re-name|call|name|label|title)\s+(?:the\s+)?(.+?)\s+(?:to|as|:)\s+["']?(.+?)["']?$/.exec(c) ?? /^(?:rename|call|name)\s+(?:the\s+)?(.+?)\s+["']?([A-Z][\w' -]{0,40})["']?$/.exec(c);
  if (!m) return null;
  return { op: 'rename', ref: parseRef(m[1] as string), name: (m[2] as string).trim().slice(0, 60) };
}

function parseVisibility(c: string): Command | null {
  let m = /^(?:hide|conceal|make\s+(.+?)\s+invisible|make\s+(.+?)\s+hidden)\s*(?:the\s+)?(.*)$/.exec(c);
  if (m) {
    const t = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (t) return { op: 'visibility', ref: parseRef(t), visible: false };
  }
  m = /^(?:show|reveal|unhide|make\s+(.+?)\s+visible)\s*(?:the\s+)?(.*)$/.exec(c);
  if (m) {
    const t = (m[1] ?? m[2] ?? '').trim();
    if (t) return { op: 'visibility', ref: parseRef(t), visible: true };
  }
  return null;
}

function parseDoor(c: string): Command | null {
  if (!/\bdoors?\b/.test(c) && !/\bgate\b/.test(c)) return null;
  const outwards = /\b(?:outwards?|outside|other way|opposite|reverse|away from)\b/.test(c) ? true : /\b(?:inwards?|inside|into the room)\b/.test(c) ? false : undefined;
  const hinge = /\bhinge[sd]?\s+(?:on\s+)?(?:the\s+)?(left|right)\b/.exec(c)?.[1] as 'left' | 'right' | undefined;
  const open = /^(?:open|unlock)\b/.test(c) ? true : /^(?:close|shut)\b/.test(c) ? false : undefined;
  if (outwards === undefined && hinge === undefined && open === undefined) return null;
  const subject = c.replace(/\b(?:make|let|have|set|swing|open|close|shut|unlock|open outwards?|outwards?|inwards?|the other way|to open|opens?|that|so that|so|should|swings?|which way|hinge[sd]?|on the (?:left|right)|opposite|reverse|away from|into the room)\b/g, ' ').replace(/\s+/g, ' ').trim() || 'door';
  return { op: 'door', ref: parseRef(subject), ...(open !== undefined ? { open } : {}), ...(outwards !== undefined ? { outwards } : {}), ...(hinge ? { hinge } : {}) };
}

function parseDialogue(c: string): Command | null {
  const m = /^(?:make|have|let|get)\s+(.+?)\s+(?:say|tell|greet|shout|whisper|talk about)\s+["“]?(.+?)["”]?$/.exec(c) ?? /^(?:change|set|update)\s+(?:what\s+)?(?:the\s+)?(.+?)\s+(?:says?|dialogue|line|greeting|speech|text)\s+(?:to\s+|is\s+)?["“]?(.+?)["”]?$/.exec(c) ?? /^(.+?)\s+(?:should|must|will)\s+say\s+["“]?(.+?)["”]?$/.exec(c);
  if (!m) return null;
  return { op: 'dialogue', ref: parseRef(m[1] as string), text: (m[2] as string).trim().slice(0, 240) };
}

function parseSpeed(c: string): Command | null {
  // "make the coins spin faster", "speed up the enemy", "slow down the cars", "make X twice as fast"
  let m = /^(?:make|let|have|get)\s+(.+?)\s+(?:(?:spin|rotate|move|go|run|walk|patrol|drive|bob|float|fly|turn|fall|swing|wander)\s+)?(?:(a bit|a little|slightly|much|way|a lot)\s+)?(faster|slower|quicker|speedier|swifter)$/.exec(c);
  if (m) return { op: 'speed', ref: parseRef(m[1] as string), factor: /faster|quicker|speedier|swifter/.test(m[3] as string) ? sizeFactor(m[2] ?? '', true) : sizeFactor(m[2] ?? '', false), what: /\bspin|rotate|turn\b/.test(c) ? 'spin' : /\bbob|float\b/.test(c) ? 'bob' : undefined } as Command;
  m = /^(speed up|slow down|accelerate|speed|slow)\s+(?:the\s+)?(.+?)(?:\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*(?:x|times|%|percent))?$/.exec(c);
  if (m) {
    const up = /speed up|accelerate|^speed$/.test(m[1] as string);
    return { op: 'speed', ref: parseRef(m[2] as string), factor: m[3] ? (/%|percent/.test(c) ? (up ? 1 + Number(m[3]) / 100 : 1 - Number(m[3]) / 100) : up ? Number(m[3]) : 1 / Number(m[3])) : sizeFactor(c, up) };
  }
  m = /^(?:make|let)\s+(.+?)\s+(twice|half|(\d+(?:\.\d+)?)\s*(?:x|times))\s+as\s+(fast|slow|quick)$/.exec(c);
  if (m) {
    const f = m[2] === 'twice' ? 2 : m[2] === 'half' ? 0.5 : Number(m[3]);
    return { op: 'speed', ref: parseRef(m[1] as string), factor: m[4] === 'slow' ? 1 / f : f };
  }
  m = /^(?:set|change)\s+(?:the\s+)?(.+?)\s+speed\s+(?:to\s+)?(\d+(?:\.\d+)?)$/.exec(c) ?? /^(?:set|change)\s+(?:the\s+)?speed\s+of\s+(?:the\s+)?(.+?)\s+to\s+(\d+(?:\.\d+)?)$/.exec(c);
  if (m) return { op: 'speed', ref: parseRef(m[1] as string), value: Number(m[2]) };
  return null;
}

/** "it a bit" becomes "it": degree words at the end of a subject belong to the predicate. */
function stripMods(subject: string): string {
  return subject.replace(/\s+(?:a\s+(?:bit|little|lot)|slightly|much|way|far|even|a\s+touch|quite|very)$/, '').trim();
}

function parseLight(c: string): Command | null {
  // entity lights: "brighter lights in the hallway", "dim the lamp", "turn off the lights", "warmer light"
  let m = /^(?:make|turn|set|give)?\s*(?:the\s+)?(.*?)\s*(brighter|dimmer|warmer|cooler|softer|stronger|weaker)\s+(?:lights?|lamps?|lighting|bulbs?|pendants?)\s*(.*)$/.exec(c);
  if (m && /\b(light|lamp|lighting|bulb|pendant)/.test(c)) {
    const dir = m[2] as string;
    const refText = `${/lights?|lamps?|lighting|bulbs?|pendants?/.exec(c.slice(c.indexOf(dir)))?.[0] ?? 'lights'} ${m[3] as string}`.trim();
    const ref = parseRef(`${m[1] ? `${m[1]} ` : ''}${refText}`.trim());
    if (dir === 'warmer' || dir === 'cooler') return { op: 'light', ref, warmth: dir };
    return { op: 'light', ref, factor: sizeFactor(c, /brighter|stronger/.test(dir)) };
  }
  m = /^(?:make|turn|set)\s+(.+?)\s+(?:(?:a\s+(?:bit|little|lot)|slightly|much|way|far|even)\s+)?(brighter|dimmer|warmer|cooler|softer|stronger|weaker)$/.exec(c);
  if (m) {
    const ref = parseRef(stripMods(m[1] as string));
    const dir = m[2] as string;
    if (dir === 'warmer' || dir === 'cooler') return { op: 'light', ref, warmth: dir };
    return { op: 'light', ref, factor: sizeFactor(c, /brighter|stronger/.test(dir)) };
  }
  m = /^(?:dim|brighten|lighten)\s+(?:the\s+)?(.+)$/.exec(c);
  if (m) return { op: 'light', ref: parseRef(m[1] as string), factor: sizeFactor(c, /^brighten|^lighten/.test(c)) };
  m = /^(?:turn|switch|put)\s+(on|off)\s+(?:the\s+)?(.+)$/.exec(c) ?? /^(?:turn|switch)\s+(?:the\s+)?(.+?)\s+(on|off)$/.exec(c);
  if (m) {
    const onoff = (m[1] === 'on' || m[1] === 'off' ? m[1] : m[2]) as string;
    const target = (m[1] === 'on' || m[1] === 'off' ? m[2] : m[1]) as string;
    if (/\b(?:light|lamp|pendant|chandelier|lantern|sconce|torch|candle|fire|neon|lighting|bulb|lights)\b/.test(target)) return { op: 'light', ref: parseRef(target), on: onoff === 'on' };
  }
  return null;
}

function parseBehavior(c: string): Command | null {
  let m = /^(?:make|let|have|get)\s+(.+?)\s+(spin|rotate|bob|float|hover)$/.exec(c);
  if (m) return { op: 'behavior', ref: parseRef(m[1] as string), behavior: /spin|rotate/.test(m[2] as string) ? 'spin' : 'bob', enabled: true };
  m = /^(?:stop|disable|freeze)\s+(?:the\s+)?(.+?)\s+(?:from\s+)?(spinning|rotating|bobbing|floating|hovering|moving)$/.exec(c) ?? /^(?:stop|freeze)\s+(?:the\s+)?(.+?)\s+(spin|rotate)$/.exec(c);
  if (m) return { op: 'behavior', ref: parseRef(m[1] as string), behavior: /spin|rotat/.test(m[2] as string) ? 'spin' : 'bob', enabled: false };
  return null;
}

function parsePhysics(c: string): Command | null {
  const m = /^(?:make|let)\s+(.+?)\s+(?:a bit |more |much |very )?(bouncy|bouncier|heavier|heavy|lighter|static|slippery|sticky|solid|immovable|floaty)$/.exec(c);
  if (!m) return null;
  const w = m[2] as string;
  if (w === 'lighter' && !/\b(?:ball|crate|box|barrel|weight|domino|brick|rock|boulder)\b/.test(c)) return null;
  const what = /bouncy|bouncier/.test(w) ? 'bouncy' : /heav/.test(w) ? 'heavy' : w === 'lighter' || w === 'floaty' ? 'light' : /static|solid|immovable/.test(w) ? 'static' : w === 'slippery' ? 'slippery' : 'sticky';
  return { op: 'physics', ref: parseRef(m[1] as string), what };
}

function parseGame(c: string): Command | null {
  let m = /^(?:give|set|make|change|increase|extend|raise|add)\s+(?:me\s+|us\s+|the player\s+)?(?:the\s+)?(?:time limit|timer|time|countdown|clock)\s*(?:to|of|by|=)?\s*(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m)?$/.exec(c) ?? /^(?:give|set|make)\s+(?:me\s+|us\s+)?(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?)\s*(?:on the clock|total|to play|to finish|to win)?$/.exec(c);
  if (m) {
    const n = Number(m[1]);
    const unit = (m[2] ?? 's') as string;
    return { op: 'game', key: 'timeLimit', value: /^m/.test(unit) ? n * 60 : n };
  }
  m = /^(?:give|allow|add)\s+(?:me\s+|us\s+|the player\s+)?(?:some\s+|a\s+)?(more|less|extra)\s+time$/.exec(c) ?? /^(?:more|less|extra)\s+time$/.exec(c);
  if (m) return { op: 'game', key: 'timeLimit', factor: /less/.test(c) ? 0.7 : 1.4 };
  m = /^(double|halve|triple)\s+(?:the\s+)?(?:time limit|timer|time|countdown|clock)$/.exec(c);
  if (m) return { op: 'game', key: 'timeLimit', factor: m[1] === 'double' ? 2 : m[1] === 'triple' ? 3 : 0.5 };
  m = /^(?:make|set)\s+(?:the\s+)?(?:time limit|timer|countdown|clock)\s+(longer|shorter)$/.exec(c);
  if (m) return { op: 'game', key: 'timeLimit', factor: m[1] === 'longer' ? 1.4 : 0.7 };
  m = /^(?:require|need|make it|set the (?:target|goal|score)(?: to)?|win (?:at|with|after)|collect|change the (?:goal|target) to)\s+(\d+)\s*(?:coins?|points?|stars?|lanterns?|items?|pickups?|orbs?|gems?|cells?|checkpoints?|laps?)?(?:\s+to win)?$/.exec(c);
  if (m && /\b(?:to win|goal|target|win|need|require|collect|score)\b/.test(c)) return { op: 'game', key: 'targetScore', value: Number(m[1]) };
  m = /^(?:make|set)\s+(?:the\s+)?(?:goal|target|score target|win score)\s+(?:to\s+)?(\d+)$/.exec(c);
  if (m) return { op: 'game', key: 'targetScore', value: Number(m[1]) };
  m = /^(?:make|let)\s+(?:the\s+)?(?:player|me|hero|character|avatar)\s+(?:jump|leap)\s+(higher|lower|more|less)$/.exec(c) ?? /^(?:jump|leap)\s+(higher|lower)$/.exec(c) ?? /^(?:increase|raise|reduce|lower)\s+(?:the\s+)?jump(?: height| power)?$/.exec(c);
  if (m) return { op: 'game', key: 'jumpHeight', factor: /lower|less|reduce/.test(c) ? 0.7 : 1.4 };
  m = /^(?:make|set)\s+(?:the\s+)?(?:game|level|it|this)\s+(harder|easier|more difficult|less difficult|more challenging|tougher)$/.exec(c) ?? /^(?:increase|raise|reduce|lower|decrease)\s+(?:the\s+)?difficulty$/.exec(c) ?? /^(?:harder|easier)$/.exec(c);
  if (m) return { op: 'game', key: 'difficulty', factor: /easier|less|reduce|lower|decrease/.test(c) ? 0.75 : 1.35 };
  m = /^(?:switch|change|set|go)\s+(?:to\s+)?(?:the\s+)?(?:camera|view)\s+(?:to\s+|mode\s+to\s+)?(first[- ]person|third[- ]person|orbit|vehicle)(?:\s+view|\s+mode|\s+camera)?$/.exec(c) ?? /^(?:switch|change|set|go)\s+to\s+(first[- ]person|third[- ]person|orbit)(?:\s+view|\s+mode|\s+camera)?$/.exec(c) ?? /^(?:use|make it)\s+(first[- ]person|third[- ]person)(?:\s+view|\s+mode|\s+camera)?$/.exec(c);
  if (m) return { op: 'game', key: 'cameraMode', label: (m[1] as string).replace(/[ ]/g, '-') };
  m = /^(?:make|set)\s+(?:the\s+)?(?:player|me|hero|character)\s+(faster|slower)$/.exec(c);
  if (m) return { op: 'game', key: 'playerSpeed', factor: m[1] === 'faster' ? 1.4 : 0.7 };
  return null;
}

function parsePaint(c: string): Command | null {
  // "put/add/apply X on/to Y" (surface treatments)
  let m = /^(?:put|add|apply|install|use|hang|lay|fit|paste|stick|cover|wrap|give)\s+(.+?)\s+(?:on|to|onto|for|over|across|in|around|up on)\s+(?:the\s+)?(.+)$/.exec(c);
  if (m) {
    const look = lookOf(m[1] as string);
    const surface = /\b(?:wall|walls|floor|floors|ceiling|counter|worktop|countertop|backsplash|splashback|roof|door|doors|window|windows|table|desk|island|sofa|couch|chair|bed|wardrobe|cabinet|shelf|bookshelf|garden|terrace|wall's|splash)\b/.test(m[2] as string);
    if (hasLook(look) && (look.material === 'wallpaper' || surface || /\b(?:paint|tiles?|panelling|cladding|plaster)\b/.test(m[1] as string))) return { op: 'paint', ref: parseRef(m[2] as string), look };
  }
  m = /^(?:wallpaper(?:ed)?)\s+(?:(?:on|for|to|onto|over|in)\s+)?(?:the\s+)?(.+?)(?:\s+(?:with|in)\s+(.+))?$/.exec(c);
  if (m) return { op: 'paint', ref: parseRef(m[1] as string), look: { ...lookOf(m[2] ?? ''), material: 'wallpaper' } };
  m = /^(?:swap|replace|switch|change|update|convert|redo|refinish|re-?do|re-?paint|retile|re-?tile)\s+(?:out\s+)?(?:the\s+)?(.+?)\s+(?:finish|material|colou?r|tiles?|texture)?\s*(?:to|with|for|into|by|using)\s+(?:a\s+|an\s+|some\s+)?(.+)$/.exec(c);
  if (m) {
    const look = lookOf(m[2] as string);
    if (hasLook(look)) return { op: 'paint', ref: parseRef(`${m[1] as string}${/tiles?/.test(c.slice(0, c.indexOf(' to ') > 0 ? c.indexOf(' to ') : c.length)) && !/tile/.test(m[1] as string) ? ' tiles' : ''}`), look };
  }
  m = /^(?:change|set|update)\s+(?:the\s+)?colou?r\s+of\s+(?:the\s+)?(.+?)\s+to\s+(.+)$/.exec(c);
  if (m) {
    const look = lookOf(m[2] as string);
    if (hasLook(look)) return { op: 'paint', ref: parseRef(m[1] as string), look };
  }
  // "(make|turn|paint|colour|dye|tint) REF PRED"
  m = /^(?:make|turn|paint|colou?r|dye|tint|recolou?r|repaint|set|change|switch|give|finish|upholster|cover|stain|refinish)\s+(.+)$/.exec(c);
  if (m) {
    let { subject, pred } = splitPredicate(m[1] as string);
    if (!pred) return null;
    const num = /^(\d+)\s+(.+)$/.exec(pred);
    if (num && (findColor(num[2] as string) !== null) && !/^(?:m|cm|meters?|metres?|ft|feet|percent|%|x|times|degrees?)\b/.test(num[2] as string)) {
      subject = `${subject} ${num[1] as string}`;
      pred = num[2] as string;
    }
    const look = lookOf(pred);
    if (!hasLook(look)) return null;
    // "give the sofa a velvet finish" – subject ends with "a"
    subject = subject.replace(/\s+(?:a|an|some|in|to|into|with|be)$/, '').trim();
    if (!subject) return null;
    return { op: 'paint', ref: parseRef(subject), look };
  }
  // "the armchair in grey fabric", "the walls in white"
  m = /^(?:the\s+)?(.+?)\s+(?:in|with|as)\s+(.+)$/.exec(c);
  if (m && !/^(?:make|turn|paint|put|add|set|change|move|remove|delete)\b/.test(c)) {
    const look = lookOf(m[2] as string);
    const rhsHasRoom = ROOM_NOUNS.has(singular(words(m[2] as string).pop() ?? ''));
    if (hasLook(look) && !rhsHasRoom) return { op: 'paint', ref: parseRef(m[1] as string), look };
  }
  // "the sofa should be dark green" / "i want the walls white"
  m = /^(?:the\s+)?(.+?)\s+(?:should|must|needs to|need to|ought to)\s+(?:be|look)\s+(.+)$/.exec(c) ?? /^(?:i want|i'd like|i need)\s+(?:the\s+)?(.+?)\s+(?:to be\s+|in\s+)?(.+)$/.exec(c);
  if (m) {
    const look = lookOf(m[2] as string);
    if (hasLook(look)) return { op: 'paint', ref: parseRef(m[1] as string), look };
  }
  return null;
}

function parseRepeat(c: string): Command | null {
  const too = /^(?:and\s+)?(?:the\s+)?(.+?)\s+(?:too|as well|also)$/.exec(c);
  if (too && !/^(?:make|add|remove|delete|move|put|place|turn|set|paint|give|change|rotate|rename)\b/.test(c)) return { op: 'repeat', ref: parseRef(too[1] as string) };
  const m = /^(?:do|apply|repeat|use)\s+(?:the\s+)?(?:same|that|this|it)\s*(?:thing|change|edit)?\s*(?:again\s+)?(?:for|to|on|with|in)\s+(?:the\s+)?(.+)$/.exec(c) ?? /^(?:same|likewise|same thing)\s+(?:for|to|on|with|in)\s+(?:the\s+)?(.+)$/.exec(c) ?? /^(?:and\s+)?(?:the\s+)?(other\s+.+?)\s+(?:too|as well|also)$/.exec(c) ?? /^(?:and\s+)?(?:do\s+)?(?:the\s+)?(same\s+for\s+)?(?:all\s+)?(?:the\s+)?(?:rest|others)$/.exec(c) ?? /^(?:the\s+)?(other\s+(?:one|ones|\w+))$/.exec(c);
  if (!m) {
    if (/^(?:again|once more|one more time|do it again|repeat(?: that| it)?)$/.test(c)) return { op: 'repeat', ref: { text: 'it', noun: '', adjectives: [], pronoun: 'same' } };
    return null;
  }
  const refText = (m[1] ?? 'other ones') as string;
  const ref = parseRef(/^same for/.test(refText) ? 'other ones' : refText);
  if (/\b(?:rest|others)\b/.test(c)) ref.other = true;
  return { op: 'repeat', ref };
}

const CLAUSE_SPLIT = /\s*(?:[;.!]|,\s*(?:and\s+)?(?=(?:make|add|remove|delete|turn|paint|put|place|set|change|move|rotate|rename|swap|replace|give|colou?r|hide|show|switch|raise|lower|dim|brighten|speed|slow|double|duplicate|copy|undo|redo|open|close)\b)|\s+(?:and then|then|and also|also|after that|afterwards|plus)\s+|\s+and\s+(?=(?:make|add|remove|delete|turn|paint|put|place|set|change|move|rotate|rename|swap|replace|give|colou?r|hide|show|switch|raise|lower|dim|brighten|speed|slow|double|duplicate|copy|undo|redo|open|close)\b))\s*/;

/** Parse a request into commands. Never throws. */
export function parseEdit(input: string): ParsedEdit {
  const out: ParsedEdit = { commands: [], newWorld: false, question: false, unparsed: [] };
  const raw = input.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().slice(0, 1_000);
  if (!raw) return out;
  if (NEW_WORLD.test(raw)) out.newWorld = true;
  if (/\?\s*$/.test(raw) && !/^(?:can|could|would|will) you\b/.test(raw) || /^(?:what|why|how|who|where|when|which|explain|describe|tell me about|show me how)\b/.test(raw)) {
    out.question = true;
    return out;
  }
  // "make the first tent red and the second tent blue": the second clause borrows the verb.
  const lead = /^(make|paint|turn|colou?r|set|change|dye)\b/.exec(raw)?.[1];
  const predWords = [...COLOR_WORDS, ...SIZE_WORDS, ...SPEED_WORDS, ...TONE_WORDS].join('|');
  const twin = lead ? new RegExp(`\\b(${[...COLOR_WORDS, ...Object.keys(MATERIAL_WORDS), ...SIZE_WORDS, ...SPEED_WORDS, ...TONE_WORDS].join('|')})\\s+and\\s+(?=(?:the\\s+)?(?:\\w+\\s+){1,3}(?:${predWords})\\b)`) : null;
  const text = lead && twin ? raw.replace(twin, `$1; ${lead} `) : raw;
  for (const part of text.split(CLAUSE_SPLIT)) {
    const clause = part.replace(LEAD, '').replace(/[,"]+$/g, '').replace(/[, ]+(?:please|thanks|thank you|for me|now|if you can|would be great)$/, '').trim();
    if (!clause) continue;
    const cmd = parseClause(clause);
    if (cmd) out.commands.push(...cmd);
    else out.unparsed.push(clause);
  }
  return out;
}

function parseClause(c: string): Command[] | null {
  if (/^(?:undo|revert|go back|take (?:that|it) back|undo (?:that|it|the last(?: change| edit)?)|cancel that|never ?mind|nevermind|step back)$/.test(c)) return [{ op: 'undo' }];
  if (/^(?:redo|do (?:that|it) again after undo|put (?:it|that) back|re-?apply)$/.test(c)) return [{ op: 'redo' }];
  const rep = parseRepeat(c);
  if (rep) return [rep];
  // "the trees should be taller", "the walls need to be white": a wish is an edit.
  const wish = /^(?:the\s+)?(.+?)\s+(?:should|must|needs? to|has to|have to|ought to)\s+(?:be|become|look|get)\s+(.+)$/.exec(c);
  if (wish && !/^(?:make|let|have|get|set|turn|paint|change)\b/.test(c)) return parseClause(`make the ${wish[1] as string} ${wish[2] as string}`);
  // World-level environment first ("make it night", "turn the sky to sunset", "less fog").
  const env = parseEnv(c);
  if (env && !/\b(?:the|a|an)\s+(?:lamp|sofa|chair|table|wall|tree|car|door|roof|floor|window|house|bed|rug)\b/.test(c.replace(/\b(?:the sky|the ground)\b/, ''))) return [{ op: 'env', set: env }];
  const parsers = [parseGame, parseDialogue, parseRename, parseRemove, parseDensity, parseDuplicate, parseVisibility, parseDoor, parseLight, parseSpeed, parseBehavior, parsePhysics, parseShape, parseScale, parseRotate, parseMove, parseAdd, parsePaint];
  for (const p of parsers) {
    const r = p(c);
    // Only colour edits address a part of an object ("the sofa legs"); elsewhere "log seat" is just a name.
    if (r) return [r.op !== 'paint' && 'ref' in r && r.ref?.part ? ({ ...r, ref: flattenPart(r.ref) } as Command) : r];
  }
  // No subject at all ("a bit bigger", "darker"): the thing just edited.
  const implicit = /^(?:(?:a\s+(?:bit|little|lot)|slightly|much|way|even|far)\s+)?(bigger|larger|smaller|taller|shorter|wider|darker|lighter|brighter|dimmer|faster|slower)$/.exec(c);
  if (implicit) return parseClause(`make it ${c}`);
  // Comparative on a named thing without an explicit verb: "the sofa darker", "bigger table".
  const bare = /^(?:the\s+)?(.+?)\s+(darker|lighter|bigger|smaller|taller|shorter|brighter|dimmer|faster|slower)$/.exec(c);
  if (bare && !/^(?:make|let|turn|set|change|paint|give|get|have)\b/.test(c)) return parseClause(`make the ${bare[1] as string} ${bare[2] as string}`);
  // Size comparatives for scaling (after the paint parser had a chance to treat tone words as colours).
  const cmp = /^(?:make|let)\s+(.+?)\s+((?:a bit |a little |slightly |much |way |a lot |far )?(?:bigger|larger|taller|wider|longer|thicker|smaller|shorter|narrower|thinner|tinier|huge|giant|tiny|massive|enormous|big|large|small|tall|short))$/.exec(c);
  if (cmp) {
    const adj = (cmp[2] as string).split(' ').pop() as string;
    const grow = SIZE_UP.has(adj);
    const axis = adj === 'taller' || adj === 'shorter' || adj === 'tall' || adj === 'short' ? 'y' : adj === 'wider' || adj === 'narrower' ? 'x' : adj === 'longer' ? 'z' : undefined;
    return [{ op: 'scale', ref: parseRef(cmp[1] as string), factor: sizeFactor(cmp[2] as string, grow), ...(axis ? { axis } : {}) }];
  }
  return null;
}

// Re-exports for the planner.
export { findColor, findMaterial };
