/**
 * Loop discipline that does not need a model: it keeps a long run on course.
 *
 *  - {@link CallLedger}: remembers which tool calls were refused. A call repeated unchanged after a refusal is
 *    answered with a reflection (change the arguments, read first, or leave it out) and, after the limit, is not run
 *    again; calls that failed and were never redone are listed before the model finishes, so its closing sentence is
 *    honest about them.
 *  - {@link budgetNote}: a heads-up two turns before the turn limit and when the tool-call budget runs low, so the
 *    model wraps up instead of being cut off mid-edit.
 *  - {@link compactConversation}: old tool results shrink to a stub once a conversation grows past a budget (the
 *    request stays the model's own record; only bulk goes), so a long run keeps its context instead of ending.
 *  - {@link drainSteer}: messages the user typed while the run worked, read between turns.
 *  - {@link trimToAnswered}: the part of a cancelled run's conversation that can be continued.
 */
import { hashString } from '@aether/core';
export { COMPACT_AT_CHARS, COMPACT_KEEP_MESSAGES, compactConversation } from './conversation';
import { executeTool, type ExecutorContext, type ToolOutcome } from './executor';
import type { ChatMessage, ContentBlock } from './types';

/** Identical refused calls after which the call is no longer run. */
export const REPEAT_LIMIT = 3;
/** Calls of one tool refused in a row (whatever their arguments) that earn a "step back" reflection. */
export const STREAK_LIMIT = 3;

function stable(v: unknown, depth = 0): string {
  if (depth > 6 || v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => stable(x, depth + 1)).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k], depth + 1)}`).join(',')}}`;
}

/** What the ledger says about one call before and after it runs. */
export interface CallVerdict {
  /** Set when the call must not run: the result to give the model instead. */
  refuse?: string;
}

interface Failure {
  tool: string;
  reason: string;
  count: number;
  /** Order of the last failure (so "redone" can be told from "failed after"). */
  at: number;
}

/** Tracks refused tool calls across a run. */
export class CallLedger {
  private readonly failed = new Map<string, Failure>();
  private readonly lastOk = new Map<string, number>();
  private streakTool = '';
  private streak = 0;
  private tick = 0;

  private key(name: string, input: unknown): string {
    return `${name}:${hashString(stable(input)).toString(36)}`;
  }

  /** Before a call: refuse it when the very same call was refused {@link REPEAT_LIMIT} times already. */
  check(name: string, input: unknown): CallVerdict {
    const f = this.failed.get(this.key(name, input));
    if (f && f.count >= REPEAT_LIMIT) {
      return { refuse: `Not run: this exact ${name} call has been refused ${f.count} times with the same reason (${f.reason}). Sending it again cannot help. Change the arguments to fix that reason, read the current state first (query_scene), or leave this out and say so when you finish.` };
    }
    return {};
  }

  /** After a call ran: the text to append to its result (a reflection), or ''. */
  record(name: string, input: unknown, outcome: { isError: boolean; content: string; edited: boolean }): string {
    this.tick++;
    const k = this.key(name, input);
    if (name === 'finish') return '';
    if (!outcome.isError) {
      this.failed.delete(k);
      this.lastOk.set(name, this.tick);
      if (outcome.edited) {
        this.streak = 0;
        this.streakTool = '';
      }
      return '';
    }
    const reason = outcome.content.split('\n')[0]?.replace(/\s+/g, ' ').trim().slice(0, 160) ?? 'refused';
    const prev = this.failed.get(k);
    const count = (prev?.count ?? 0) + 1;
    this.failed.set(k, { tool: name, reason, count, at: this.tick });
    this.streak = this.streakTool === name ? this.streak + 1 : 1;
    this.streakTool = name;
    if (count >= 2) {
      return `\nNote: this exact call has now been refused ${count} times for the same reason. Do not send it unchanged: fix what the reason names, read the current state first (query_scene), or drop it and say so when you finish.${count >= REPEAT_LIMIT ? ' It will not be run again.' : ''}`;
    }
    if (this.streak >= STREAK_LIMIT) {
      this.streak = 0;
      return `\nNote: ${STREAK_LIMIT} ${name} calls in a row were refused. Step back: re-read the tool's rules and the current state (query_scene), find what they have in common, and change the approach rather than the details.`;
    }
    return '';
  }

  /** Refused calls that were never succeeded afterwards by the same tool: what the model should redo or admit to. */
  unresolved(): string[] {
    const out: string[] = [];
    for (const f of this.failed.values()) {
      if ((this.lastOk.get(f.tool) ?? 0) > f.at) continue;
      out.push(`${f.tool}: ${f.reason}`);
    }
    return out.slice(0, 6);
  }
}

/** Run a tool through the ledger: refuse a hopeless repeat, and append the reflection to a refusal. */
export async function guardedTool(ledger: CallLedger, ctx: ExecutorContext, name: string, input: unknown): Promise<ToolOutcome> {
  const v = ledger.check(name, input);
  if (v.refuse) return { content: v.refuse, isError: true, events: [], edited: false };
  const out = await executeTool(ctx, name, input);
  const note = ledger.record(name, input, out);
  return note ? { ...out, content: out.content + note } : out;
}

/**
 * A heads-up for the model: `turnsLeft` model turns remain and `callsLeft` tool calls. Spoken once per level
 * (the caller keeps `said`), empty when there is nothing to say.
 */
export function budgetNote(turnsLeft: number, callsLeft: number, callBudget: number, said: Set<string>): string {
  const parts: string[] = [];
  if (turnsLeft <= 2 && !said.has(`t${turnsLeft}`)) {
    said.add(`t${turnsLeft}`);
    parts.push(turnsLeft <= 1 ? 'This is your LAST model turn: make the one change that matters most, or call finish and say what is left undone.' : `${turnsLeft} model turns remain: finish the essential edits now and keep the rest for finish's message.`);
  }
  if (callBudget >= 10 && callsLeft <= Math.ceil(callBudget * 0.15) && callsLeft > 0 && !said.has('c')) {
    said.add('c');
    parts.push(`Only ${callsLeft} tool call${callsLeft === 1 ? '' : 's'} remain in the budget: batch the rest into fewer, larger calls.`);
  }
  return parts.join(' ');
}

/** Most messages taken from the queue at once, and the length of each. */
export const STEER_MAX = 4;
export const STEER_CHARS = 2000;

/** Read the user's queued messages (never throws; at most {@link STEER_MAX}, each cut to {@link STEER_CHARS}). */
export async function drainSteer(steer: (() => readonly string[] | Promise<readonly string[]>) | undefined): Promise<string[]> {
  if (!steer) return [];
  try {
    const got = await steer();
    return got.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, STEER_MAX).map((t) => t.trim().slice(0, STEER_CHARS));
  } catch {
    return [];
  }
}

/** The text that hands queued messages to the model. */
export function steerText(texts: readonly string[]): string {
  const body = texts.map((t) => `<queued_message>\n${t.replace(/<\/?queued_message>/gi, '')}\n</queued_message>`).join('\n');
  return `The user sent ${texts.length === 1 ? 'this message' : 'these messages'} while you were working. ${texts.length === 1 ? 'It adds to or changes' : 'They add to or change'} the request: follow ${texts.length === 1 ? 'it' : 'them'} from here, keep what is already done unless ${texts.length === 1 ? 'it says' : 'they say'} otherwise, and mention it in your closing message.\n${body}`;
}

/**
 * The part of a cancelled run's conversation the next run can continue: cut back to the last user turn, so no
 * assistant turn is left with tool calls that were never answered. Null when nothing would be left to continue.
 */
export function trimToAnswered(messages: readonly ChatMessage[]): ChatMessage[] | null {
  let end = messages.length;
  while (end > 0 && messages[end - 1]?.role !== 'user') end--;
  if (end < 2) return null;
  const kept = messages.slice(0, end);
  const last = kept[kept.length - 1];
  const note: ContentBlock = { type: 'text', text: 'The user cancelled the run at this point. Treat the work above as interrupted: what the scene holds now is what counts, and the next request says what to do.' };
  if (last && typeof last.content !== 'string') return [...kept.slice(0, -1), { role: 'user', content: [...last.content, note] }];
  return [...kept, { role: 'user', content: [note] }];
}

const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * A short human label for a finished tool call ("Placing 4 items", "Reading the scene"), for the step list the user can
 * open. Never throws; an unknown tool gets its name.
 */
export function stepLabel(name: string, input: unknown, ok: boolean): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const n = (key: string): number => count(i[key]);
  let text: string;
  switch (name) {
    case 'apply_patches':
      text = n('patches') > 0 ? `Applying ${plural(n('patches'), 'change')}` : 'Applying changes';
      break;
    case 'build_architecture':
      text = 'Building the architecture';
      break;
    case 'design_plan':
      text = 'Planning the building';
      break;
    case 'place_items':
      text = n('items') > 0 ? `Placing ${plural(n('items'), 'item')}` : 'Placing items';
      break;
    case 'edit_items':
      text = n('edits') > 0 ? `Editing ${plural(n('edits'), 'item')}` : 'Editing items';
      break;
    case 'query_scene':
      text = typeof i['q'] === 'string' ? `Reading the scene (${i['q'].slice(0, 24)})` : 'Reading the scene';
      break;
    case 'query_level':
      text = 'Measuring the level';
      break;
    case 'place_level_items':
      text = n('items') > 0 ? `Placing ${plural(n('items'), 'item')} on the ground` : 'Placing items on the ground';
      break;
    case 'inspect':
      text = typeof i['id'] === 'string' ? `Inspecting ${i['id'].slice(0, 32)}` : 'Inspecting the world';
      break;
    case 'tune_look':
      text = 'Setting the look';
      break;
    case 'bake_light':
      text = 'Baking the interior light';
      break;
    case 'sculpt':
      text = typeof i['id'] === 'string' ? `Sculpting ${i['id'].slice(0, 32)}` : 'Sculpting';
      break;
    case 'tune_feel':
      text = 'Tuning the game feel';
      break;
    case 'shape_land':
      text = 'Shaping the land';
      break;
    case 'write_generator':
    case 'request_asset':
      text = 'Making a new asset';
      break;
    case 'write_script':
      text = 'Writing a script';
      break;
    case 'search_assets':
      text = 'Searching the asset library';
      break;
    case 'find_model':
      text = 'Choosing a real model';
      break;
    case 'simready_search':
      text = 'Looking for a model outside the library';
      break;
    case 'import_asset':
      text = 'Importing a model from SimReady Central';
      break;
    case 'run_verification':
      text = 'Running the checks';
      break;
    case 'report_differences':
      text = 'Listing what differs';
      break;
    case 'report_verdicts':
      text = 'Judging each item';
      break;
    case 'sample_photo':
      text = 'Reading colours from the photo';
      break;
    case 'look_closer':
      text = 'Looking closer';
      break;
    default:
      text = name.slice(0, 40);
  }
  return ok ? text : `${text} (refused)`;
}
