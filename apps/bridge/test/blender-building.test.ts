import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlenderPlanRequestSchema, BuildingBriefSchema, createBlenderToolRunner, type BlenderHostDeps } from '@aether/agent/blender';
import { BlenderService } from '../src/index';
import { summarizeBuildingReport, type BuildingJob } from '../src/blender/buildings';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'aether-building-'));
  dirs.push(d);
  return d;
}

const BRIEF = {
  id: 'harbour-shop',
  name: 'Corner shop',
  style: 'anime' as const,
  kind: 'shop' as const,
  footprint: { w: 8, d: 7 },
  storeys: 2,
  roof: { type: 'gable' as const, pitch_deg: 26 },
  palette: { wall: '#efe2c8', roof: '#4a4d5c' },
  wear: 0.5,
  features: { signage: 'SHIOKAZE STORE' },
};

/** A service whose Blender run writes what the building pipeline would: a report, the stills and a model. */
function service(o: { failRun?: boolean } = {}) {
  const dir = tmp();
  const script = join(dir, 'build.py');
  writeFileSync(script, '# pipeline');
  const runs: BuildingJob[] = [];
  const svc = new BlenderService({
    dataDir: dir,
    ttlMs: 0,
    detect: () => ({ blender: '/x/blender', addon: null, uvx: null }),
    probeSocket: async () => false,
    connect: async () => Promise.reject(new Error('no MCP needed')),
    buildingScript: script,
    runBuilding: async (job) => {
      runs.push({ ...job, argv: [...job.argv] });
      if (o.failRun) return { code: 1, log: 'Traceback: roof' };
      writeFileSync(job.report, JSON.stringify({ passed: true, iterations: 1, tier: 'hero', triangles: 9800, interpenetration: { parts: 24, failed: 0 }, issues: [] }));
      writeFileSync(job.stills, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      writeFileSync(job.glb, Buffer.from('glTF-fake'));
      return { code: 0, log: '' };
    },
  });
  return { svc, runs, dir };
}

describe('the building pipeline actions', () => {
  it('accepts a brief and refuses bad ids, colours or unknown input keys', () => {
    expect(BuildingBriefSchema.safeParse(BRIEF).success).toBe(true);
    expect(BlenderPlanRequestSchema.safeParse({ action: 'building_create', input: { brief: BRIEF } }).success).toBe(true);
    expect(BlenderPlanRequestSchema.safeParse({ action: 'building_create', input: { brief: { ...BRIEF, id: 'Bad Id' } } }).success).toBe(false);
    expect(BlenderPlanRequestSchema.safeParse({ action: 'building_create', input: { brief: { ...BRIEF, palette: { wall: 'cream' } } } }).success).toBe(false);
    expect(BlenderPlanRequestSchema.safeParse({ action: 'building_create', input: { brief: { ...BRIEF, storeys: 9 } } }).success).toBe(false);
    expect(BlenderPlanRequestSchema.safeParse({ action: 'building_create', input: { brief: BRIEF, confirm: true } }).success).toBe(false);
    expect(BlenderPlanRequestSchema.safeParse({ action: 'building_review', input: { id: 'harbour-shop' } }).success).toBe(true);
  });

  it('plans a headless run showing the exact command and brief, needs confirmation, and returns the stills and model', async () => {
    const { svc, runs } = service();
    await svc.setEnabled(true);
    const plan = await svc.plan({ action: 'building_create', input: { brief: BRIEF } });
    expect(plan.python).toBe(true);
    expect(plan.code).toContain('-b --factory-startup -P');
    expect(plan.code).toContain('"harbour-shop"');
    await expect(svc.run(plan.planId, false)).rejects.toMatchObject({ code: 'confirmation_required' });
    const again = await svc.plan({ action: 'building_create', input: { brief: BRIEF } });
    const out = await svc.run(again.planId, true);
    expect(out.kind).toBe('json');
    if (out.kind !== 'json') return;
    expect(out.result.text).toContain('Built building "harbour-shop"');
    expect(out.result.text).toContain('QA passed after 1 iteration(s)');
    expect(out.result.image).toMatch(/^data:image\/png;base64,/);
    expect(out.result.glb).toMatch(/^data:model\/gltf-binary;base64,/);
    expect(runs[0]?.argv).toContain('--brief');
    expect(runs[0]?.dir).toContain(join('buildings', 'harbour-shop'));
  });

  it('revises with notes and reviews from the same folder', async () => {
    const { svc, runs } = service();
    await svc.setEnabled(true);
    const p = await svc.plan({ action: 'building_create', input: { brief: BRIEF } });
    await svc.run(p.planId, true);
    const r = await svc.plan({ action: 'building_revise', input: { id: 'harbour-shop', notes: 'more wear, steeper roof', brief: { storeys: 3 } } });
    expect(r.code).toContain('more wear, steeper roof');
    expect(r.code).toContain('"storeys": 3');
    await svc.run(r.planId, true);
    expect(runs[1]?.argv).toContain('--revise');
    const v = await svc.plan({ action: 'building_review', input: { id: 'harbour-shop' } });
    const out = await svc.run(v.planId, true);
    expect(runs[2]?.argv).toContain('--review');
    if (out.kind === 'json') expect(out.result.glb).toBeUndefined();
  });

  it('refuses a revision of a building never built, and reports a failed run with its log', async () => {
    const { svc } = service({ failRun: true });
    await svc.setEnabled(true);
    await expect(svc.plan({ action: 'building_revise', input: { id: 'nowhere', notes: 'x' } })).rejects.toMatchObject({ code: 'not_found' });
    const p = await svc.plan({ action: 'building_create', input: { brief: BRIEF } });
    await expect(svc.run(p.planId, true)).rejects.toThrow(/Traceback: roof/);
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
      importGlb: async (bytes, name) => (imported.push(`${name}:${bytes.length}`), { ok: true, id: 'user-2', summary: '1 mesh' }),
    };
    const runner = createBlenderToolRunner(deps);
    expect(runner.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['building_create', 'building_revise', 'building_review']));
    const out = await runner.run('building_create', { brief: BRIEF });
    expect(out.isError).toBeFalsy();
    expect(out.text).toContain('user-2');
    expect(imported).toEqual(['Corner shop:4']);
    const bad = await runner.run('building_create', { brief: { ...BRIEF, style: 'cartoon' } });
    expect(bad.isError).toBe(true);
  });

  it('summarizes a report', () => {
    expect(summarizeBuildingReport({ passed: false, triangles: 17000, issues: ['triangles 17000 over the hero budget 16000'] })).toContain('QA FAILED');
  });
});
