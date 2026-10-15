/**
 * Self-repair study. Take worlds that work, break each in a way a model
 * could plausibly get wrong, and run the real agent loop (plan, edit,
 * verify, repair turn, re-verify) with a scripted model that "wrote" the
 * broken world and, when it is shown a failing report that names the
 * problem, answers with the fix.
 *
 * What this measures is the loop and its reports, not model skill: a fault is
 * repaired only if verification notices it and its report names it. The
 * repairer is an oracle (it always knows the fix once told where to look), so
 * the repair rates are a ceiling that a real model approaches but does not
 * exceed. Two verification configurations are compared:
 *
 *  - verify: the physics tests the world ships with (what Aether runs today);
 *  - verify + playtest: the same, plus a bot that tries to win the game.
 */
import { applyPatches, createWorld, patchesBetween, type Json, type PatchInput, type Rule, type WorldDoc } from '@aether/core';
import type { CompletionRequest, CompletionResponse, ContentBlock, Provider } from '@aether/agent';
import type { SandboxRunner } from '@aether/procgen';
import { isWinnableKind, playtest } from './autoplay';
import { recordingProvider, runAgent, runVerify } from './world-eval';

/** A way to break a working world, with its repair. */
export interface Fault {
  id: string;
  title: string;
  /** What breaks: the bot's ability to win, or a physics test. */
  breaks: 'winnability' | 'physics';
  /** The faulty world, or null when the fault does not apply to `world`. */
  inject(world: WorldDoc): WorldDoc | null;
  /** A phrase a failing report must contain for the repairer to recognise the problem. */
  signature(world: WorldDoc, faulty: WorldDoc): RegExp;
}

function setBy(world: WorldDoc, patches: PatchInput[]): WorldDoc | null {
  const r = applyPatches(world, patches);
  return r.errors.length === 0 ? r.world : null;
}

function hasBehavior(world: WorldDoc, type: string): string[] {
  return Object.values(world.entities).filter((e) => e.parent === null && e.behaviors.some((b) => b.type === type)).map((e) => e.id).sort();
}

function winRule(world: WorldDoc): Rule | undefined {
  return world.rules.find((r) => JSON.stringify(r.then).includes('"win"') && (r.when as { on?: string; op?: string; value?: unknown }).on === 'state' && typeof (r.when as { value?: unknown }).value === 'number');
}

/** The fault catalogue. */
export const FAULTS: readonly Fault[] = Object.freeze([
  {
    id: 'unreachable-pickup',
    title: 'a pickup floats 30 m up',
    breaks: 'winnability',
    inject(world) {
      const id = hasBehavior(world, 'collectible').at(-1);
      const e = id ? world.entities[id] : undefined;
      if (!e || !id) return null;
      const [x, y, z] = e.transform.position;
      return setBy(world, [{ op: 'update', id, set: { transform: { position: [x, y + 30, z] } } }]);
    },
    signature: (world) => new RegExp(String(hasBehavior(world, 'collectible').at(-1))),
  },
  {
    id: 'unreachable-goal',
    title: 'the goal sits 30 m above its platform',
    breaks: 'winnability',
    inject(world) {
      const id = hasBehavior(world, 'goal')[0];
      const e = id ? world.entities[id] : undefined;
      if (!e || !id) return null;
      const [x, y, z] = e.transform.position;
      return setBy(world, [{ op: 'update', id, set: { transform: { position: [x, y + 30, z] } } }]);
    },
    signature: (world) => new RegExp(String(hasBehavior(world, 'goal')[0])),
  },
  {
    id: 'inflated-threshold',
    title: 'the win rule asks for 3 more points than exist',
    breaks: 'winnability',
    inject(world) {
      const rule = winRule(world);
      if (!rule) return null;
      const value = (rule.when as { value: number }).value;
      return setBy(world, [{ op: 'updateRule', id: rule.id, set: { when: { ...(rule.when as object), value: value + 3 } as Record<string, Json> } }]);
    },
    signature: (world) => new RegExp((winRule(world) as Rule).id),
  },
  {
    id: 'broken-chain',
    title: 'three dominoes are moved 3 m out of the line',
    breaks: 'physics',
    inject(world) {
      const ids = Object.values(world.entities).filter((e) => e.parent === null && e.tags.includes('domino')).map((e) => e.id).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      const mid = Math.floor(ids.length / 2);
      const patches: PatchInput[] = [];
      for (const id of ids.slice(Math.max(0, mid - 1), mid + 2)) {
        const e = world.entities[id];
        if (!e) continue;
        const [x, y, z] = e.transform.position;
        patches.push({ op: 'update', id, set: { transform: { position: [x, y, z + 3] } } });
      }
      return patches.length === 3 ? setBy(world, patches) : null;
    },
    signature: () => /domino|topple|chain/i,
  },
  {
    id: 'anchored-target',
    title: 'the object the test expects to move is bolted down',
    breaks: 'physics',
    inject(world) {
      const t = world.tests.find((x) => (x.kind === 'moves' || x.kind === 'topples') && !x.target.startsWith('#') && world.entities[x.target]?.physics?.body === 'dynamic');
      if (!t || !('target' in t)) return null;
      return setBy(world, [{ op: 'update', id: t.target, set: { physics: { body: 'static' } } }]);
    },
    signature: (world) => {
      const t = world.tests.find((x) => (x.kind === 'moves' || x.kind === 'topples') && !x.target.startsWith('#') && world.entities[x.target]?.physics?.body === 'dynamic');
      return new RegExp(t && 'target' in t ? t.target : 'moved|toppled');
    },
  },
]);

/** Text of a message's text blocks. */
function textOf(content: string | ContentBlock[]): string {
  return typeof content === 'string' ? content : content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
}

/**
 * A scripted model: first it "writes" the faulty world, later, if shown a
 * failing report whose text matches `signature`, it sends `fix`.
 */
export function scriptedModel(build: readonly PatchInput[], fix: readonly PatchInput[], signature: RegExp): Provider {
  let stage: 'build' | 'repair' = 'build';
  const chunks = (list: readonly PatchInput[], tag: string): ContentBlock[] => {
    const out: ContentBlock[] = [];
    for (let i = 0; i < list.length; i += 400) out.push({ type: 'tool_use', id: `${tag}-${i / 400}`, name: 'apply_patches', input: { patches: list.slice(i, i + 400), message: `${tag} (${i / 400 + 1})` } });
    return out;
  };
  return {
    name: 'scripted',
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const last = [...req.messages].reverse().find((m) => m.role === 'user');
      const text = last ? textOf(last.content) : '';
      const reply = (content: ContentBlock[], stop: CompletionResponse['stopReason']): CompletionResponse => ({ content, stopReason: stop, usage: { inputTokens: Math.ceil(text.length / 4), outputTokens: Math.ceil(JSON.stringify(content).length / 4) }, model: 'scripted' });
      if (stage === 'build') {
        stage = 'repair';
        return reply([{ type: 'text', text: 'Building the world.' }, ...chunks(build, 'build'), { type: 'tool_use', id: 'fin-1', name: 'finish', input: { message: 'Built.' } }], 'tool_use');
      }
      if (/verification failed/i.test(text) && signature.test(text)) {
        return reply([{ type: 'text', text: 'Fixing the reported problem.' }, ...chunks(fix, 'fix'), { type: 'tool_use', id: 'fin-2', name: 'finish', input: { message: 'Fixed.' } }], 'tool_use');
      }
      return reply([{ type: 'text', text: 'Nothing I can act on.' }], 'end');
    },
  };
}

/** Is the world healthy: the game is winnable (when it has a win) and its tests pass. */
export async function healthy(world: WorldDoc): Promise<{ ok: boolean; verify: boolean; won: boolean | null; summary: string }> {
  const v = await runVerify(world);
  const won = isWinnableKind(world) ? (await playtest(world)).won : null;
  return { ok: v.passed && won !== false, verify: v.passed, won, summary: v.summary };
}

/** One configuration's outcome. */
export interface RepairArm {
  /** The first verification already failed (the loop noticed). */
  detected: boolean;
  /** The loop ran at least one repair turn. */
  repairTurns: number;
  /** Healthy at the end. */
  repaired: boolean;
  modelCalls: number;
  outputTokens: number;
  ms: number;
}

/** One broken world. */
export interface RepairRow {
  worldId: string;
  fault: string;
  breaks: Fault['breaks'];
  /** The injected fault really broke the world (bot lost / test failed). */
  effective: boolean;
  verifyOnly: RepairArm;
  withPlaytest: RepairArm;
}

async function arm(faulty: WorldDoc, fix: PatchInput[], sig: RegExp, sandbox: SandboxRunner, playtestInLoop: boolean): Promise<RepairArm> {
  const build = patchesBetween(createWorld(), faulty) as PatchInput[];
  const provider = recordingProvider(scriptedModel(build, fix, sig));
  const run = await runAgent('build the world', {
    provider,
    sandbox,
    maxRepairs: 2,
    ...(playtestInLoop
      ? {
          verifyOverride: async (w: WorldDoc) => {
            if (!isWinnableKind(w)) return { report: null, summary: '', passed: true };
            const r = await playtest(w);
            return { report: null, summary: `Playtest FAILED: ${r.summary}`, passed: r.won };
          },
        }
      : {}),
  });
  const end = await healthy(run.world);
  if (process.env['BENCH_DEBUG']) console.log('   dbg', playtestInLoop, run.verdicts, run.events.filter((e) => e.type === 'repair').map((e) => (e as { text: string }).text.slice(0, 300)), JSON.stringify(end));
  return {
    detected: run.verdicts.length > 0 ? run.repairs > 0 || run.verdicts[0] === false : false,
    repairTurns: run.repairs,
    repaired: end.ok,
    modelCalls: run.calls,
    outputTokens: run.outputTokens,
    ms: run.ms,
  };
}

/** Run every applicable fault on one working world. */
export async function repairStudy(worldId: string, clean: WorldDoc, sandbox: SandboxRunner): Promise<RepairRow[]> {
  const rows: RepairRow[] = [];
  for (const f of FAULTS) {
    const faulty = f.inject(clean);
    if (!faulty) continue;
    const broken = await healthy(faulty);
    const effective = !broken.ok;
    const fix = patchesBetween(faulty, clean) as PatchInput[];
    const sig = f.signature(clean, faulty);
    rows.push({
      worldId,
      fault: f.id,
      breaks: f.breaks,
      effective,
      verifyOnly: await arm(faulty, fix, sig, sandbox, false),
      withPlaytest: await arm(faulty, fix, sig, sandbox, true),
    });
  }
  return rows;
}
