import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlenderPlanRequestSchema, createBlenderToolRunner, type BlenderHostDeps } from '@aether/agent/blender';
import { BlenderService } from '../src/index';
import { conceptPrompt, summarizeReport, type CharacterJob } from '../src/blender/characters';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'aether-character-'));
  dirs.push(d);
  return d;
}

const BRIEF = { id: 'harbour-fisherman', name: 'Old Fisherman', style: 'anime' as const, age: 68, build: 'sturdy' as const, hair: { style: 'short', colour: '#d8d4cc' }, outfit: [{ item: 'jacket', colour: '#3b4a5a' }] };

/** A service whose Blender run writes what the pipeline would: a report, a turnaround and a model. */
function service(o: { concept?: boolean; failRun?: boolean } = {}) {
  const dir = tmp();
  const script = join(dir, 'build.py');
  writeFileSync(script, '# pipeline');
  const runs: CharacterJob[] = [];
  const prompts: string[] = [];
  const svc = new BlenderService({
    dataDir: dir,
    ttlMs: 0,
    detect: () => ({ blender: '/x/blender', addon: null, uvx: null }),
    probeSocket: async () => false,
    connect: async () => Promise.reject(new Error('no MCP needed')),
    characterScript: script,
    runCharacter: async (job) => {
      runs.push({ ...job, argv: [...job.argv] });
      if (o.failRun) return { code: 1, log: 'Traceback: boom' };
      writeFileSync(job.report, JSON.stringify({ passed: true, iterations: 2, triangles: 41000, silhouette_iou: 0.86, issues: ['bangs 4 mm off the brow (fixed)'] }));
      writeFileSync(job.turnaround, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      writeFileSync(job.glb, Buffer.from('glTF-fake'));
      return { code: 0, log: '' };
    },
    ...(o.concept ? { concept: async (prompt: string) => (prompts.push(prompt), { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }) } : {}),
  });
  return { svc, runs, prompts, dir };
}

describe('the character pipeline actions', () => {
  it('accepts a brief and refuses a bad id or unknown input keys', () => {
    expect(BlenderPlanRequestSchema.safeParse({ action: 'character_create', input: { brief: BRIEF } }).success).toBe(true);
    expect(BlenderPlanRequestSchema.safeParse({ action: 'character_create', input: { brief: { ...BRIEF, id: 'Bad Id' } } }).success).toBe(false);
    expect(BlenderPlanRequestSchema.safeParse({ action: 'character_create', input: { brief: BRIEF, confirm: true } }).success).toBe(false);
    expect(BlenderPlanRequestSchema.safeParse({ action: 'character_review', input: { id: 'harbour-fisherman' } }).success).toBe(true);
  });

  it('plans a headless run showing the exact command and brief, needs confirmation, and needs no MCP session', async () => {
    const { svc, runs } = service();
    await svc.setEnabled(true);
    const plan = await svc.plan({ action: 'character_create', input: { brief: BRIEF } });
    expect(plan.python).toBe(true);
    expect(plan.code).toContain('-b --factory-startup -P');
    expect(plan.code).toContain('"harbour-fisherman"');
    await expect(svc.run(plan.planId, false)).rejects.toMatchObject({ code: 'confirmation_required' });
    const again = await svc.plan({ action: 'character_create', input: { brief: BRIEF } });
    const out = await svc.run(again.planId, true);
    expect(out.kind).toBe('json');
    if (out.kind !== 'json') return;
    expect(out.result.text).toContain('QA passed after 2 iteration(s)');
    expect(out.result.text).toContain('silhouette_iou: 0.86');
    expect(out.result.image).toMatch(/^data:image\/png;base64,/);
    expect(out.result.glb).toMatch(/^data:model\/gltf-binary;base64,/);
    expect(runs[0]?.argv).toContain('--brief');
    expect(runs[0]?.argv).not.toContain('--sheet');
  });

  it('makes a concept sheet when none is sent, then revises and reviews from the same folder', async () => {
    const { svc, runs, prompts } = service({ concept: true });
    await svc.setEnabled(true);
    const p = await svc.plan({ action: 'character_create', input: { brief: BRIEF } });
    await svc.run(p.planId, true);
    expect(prompts[0]).toContain('Old Fisherman');
    expect(runs[0]?.argv).toContain('--sheet');
    const r = await svc.plan({ action: 'character_revise', input: { id: 'harbour-fisherman', notes: 'a fuller beard' } });
    expect(r.code).toContain('a fuller beard');
    await svc.run(r.planId, true);
    expect(runs[1]?.argv).toContain('--revise');
    const v = await svc.plan({ action: 'character_review', input: { id: 'harbour-fisherman' } });
    const out = await svc.run(v.planId, true);
    expect(runs[2]?.argv).toContain('--review');
    if (out.kind === 'json') expect(out.result.glb).toBeUndefined();
  });

  it('refuses a revision of a character never built, and reports a failed run with its log', async () => {
    const { svc } = service({ failRun: true });
    await svc.setEnabled(true);
    await expect(svc.plan({ action: 'character_revise', input: { id: 'nobody', notes: 'x' } })).rejects.toMatchObject({ code: 'not_found' });
    const p = await svc.plan({ action: 'character_create', input: { brief: BRIEF } });
    await expect(svc.run(p.planId, true)).rejects.toThrow(/Traceback: boom/);
  });

  it('offers the agent create, revise and review tools that import the built model', async () => {
    const imported: string[] = [];
    const deps: BlenderHostDeps = {
      api: {
        status: async () => ({ state: 'ready', enabled: true, detail: '' }),
        setEnabled: async () => ({ state: 'ready', enabled: true, detail: '' }),
        plan: async (req) => ({ planId: '00000000-0000-4000-8000-000000000000', action: req.action, python: true, code: 'blender -b', expiresAt: 1 }),
        run: async () => ({ text: 'Built.', glb: 'data:model/gltf-binary;base64,Z2xURg==' }),
        runExport: async () => new Uint8Array(),
      },
      confirm: async () => true,
      importGlb: async (bytes, name) => (imported.push(`${name}:${bytes.length}`), { ok: true, id: 'user-1', summary: '1 mesh' }),
    };
    const runner = createBlenderToolRunner(deps);
    expect(runner.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['character_create', 'character_revise', 'character_review']));
    const out = await runner.run('character_create', { brief: BRIEF });
    expect(out.isError).toBeFalsy();
    expect(out.text).toContain('user-1');
    expect(imported).toEqual(['Old Fisherman:4']);
  });

  it('writes a concept prompt and a report summary', () => {
    expect(conceptPrompt(BRIEF)).toContain('ORIGINAL anime-style character aged 68');
    expect(summarizeReport({ passed: false, issues: ['skirt clips the thigh in run frame 12'] })).toContain('QA FAILED');
  });
});
