/**
 * Forge the library's signature "hero" objects with the asset forge
 * (`@aether/agent` `forgeGenerator`): the signed-in Claude Code (or Codex)
 * CLI writes a parametric generator from a detailed brief, the generator is
 * sandbox-checked (library acceptance rules), rendered from four sides in a
 * headless Chromium, critiqued, and patched — bounded to ≤ 8 heroes and
 * ≤ 40 model calls in total. Results ship as ordinary library generators
 * (`packages/procgen/library/<id>.json`, provenance "claude-code"/"codex")
 * plus catalog entries (`assets/heroes.json`, merged by `build.ts`) with a
 * rendered thumbnail. They are AI-generated procedural code, disclosed in
 * docs/THIRD_PARTY.md.
 *
 *   npx tsx scripts/assets/forge-heroes.ts [--backend=claude-code|codex] [--only=hero-fountain] [--max-calls=40] [--force]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GeneratorDef, Json } from '@aether/core';
import { buildCoderPrompt, forgeGenerator, type CompletionRequest, type Provider, type UsageTotals } from '@aether/agent';
import { BEHAVIOR_CATALOG, RULE_DOCS, SCRIPT_API_DTS } from '@aether/logic';
import { GENERATOR_API_DTS, GENERATOR_EXAMPLES, catalog, resolveParams, type GeneratorOutput } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { acceptLibraryGenerator, LibraryFileSchema, serializeLibraryFile, type LibraryFile } from '../../packages/procgen/src/library-tools';
import { createHeadlessProvider } from '../lib/live-provider';
import type { AssetCategory } from '../../packages/assets/src/schema';
import { withBrowserPage } from './browser';

const ROOT = resolve(import.meta.dirname, '../..');
const LIB_DIR = join(ROOT, 'packages/procgen/library');
const HEROES_FILE = join(ROOT, 'assets', 'heroes.json');
const THUMB_DIR = join(ROOT, 'assets', 'lib', 't');
/** Hard budget of the whole run. */
const MAX_TOTAL_CALLS = 40;
const MAX_HEROES = 8;

interface Hero {
  id: string;
  name: string;
  category: AssetCategory;
  libraryCategory: LibraryFile['entry']['category'];
  keywords: string[];
  brief: string;
}

/** The briefs (text references: no third-party images are used). */
export const HEROES: readonly Hero[] = [
  { id: 'hero-fountain', name: 'Ornate fountain', category: 'street', libraryCategory: 'architecture', keywords: ['ornate fountain', 'tiered fountain', 'plaza fountain'], brief: 'An ornate three-tier stone fountain for a town plaza, about 3.4 m wide and 3 m tall: a wide octagonal basin with a moulded rim and carved panels, a fluted central pedestal, two smaller scalloped bowls stacked above it, translucent blue water in each bowl and thin falling water sheets, and a pinecone finial on top. Weathered warm sandstone; water slightly emissive blue.' },
  { id: 'hero-statue', name: 'Ancient statue', category: 'decor', libraryCategory: 'props', keywords: ['ancient statue', 'marble statue', 'classical statue'], brief: 'A classical marble statue on a square stepped plinth, 2.8 m tall in total: a standing robed figure with draped toga folds (stacked tapered rings and offset drapes), one arm raised holding a laurel wreath, the other at its side, a rounded head with a curled-hair cap and a slight head tilt. White marble with faint grey veining; the plinth darker stone with an inscription band.' },
  { id: 'hero-lantern', name: 'Victorian street lantern', category: 'lighting', libraryCategory: 'props', keywords: ['victorian lantern', 'gas lamp', 'old street lamp'], brief: 'A Victorian cast-iron gas street lantern, 4.2 m tall: a fluted base, a slender tapered post with decorative rings, a ladder-rest cross bar, and a hexagonal glass lantern head with a domed cap and a finial. Black-green iron with brass accents; the glass glows warm yellow (emissive).' },
  { id: 'hero-ship', name: 'Sailing galleon', category: 'vehicles', libraryCategory: 'vehicles', keywords: ['galleon', 'sailing ship', 'tall ship'], brief: 'A three-masted sailing galleon about 14 m long and 13 m tall: a curved wooden hull (lofted cross-sections) with a row of gun ports, a raised stern castle with windows and a lantern, a forecastle, a bowsprit, three masts with yards carrying billowing cream square sails, rigging lines and small red pennants. Dark varnished wood, gold trim along the hull.' },
  { id: 'hero-car', name: 'Vintage roadster', category: 'vehicles', libraryCategory: 'vehicles', keywords: ['vintage car', 'classic car', 'roadster', 'old car'], brief: 'A 1930s two-seat vintage roadster, 4.3 m long: a long hood with a tall chrome radiator grille, flowing separate fenders arching over four spoked wheels with whitewall tyres, running boards, two big round chrome headlamps, a split windscreen, a small cabin with a folded soft top and a spare wheel mounted at the back. Deep burgundy paint, cream fenders, chrome details.' },
  { id: 'hero-explorer', name: 'Stylised explorer', category: 'characters', libraryCategory: 'props', keywords: ['explorer', 'adventurer', 'hiker figure'], brief: 'A stylised explorer figure 1.75 m tall in a friendly toy style: big rounded head with a wide-brim safari hat, simple face (eyes, nose), a scarf, rounded torso with a utility vest, a backpack with a rolled bedroll, arms slightly away from the body, sturdy boots, standing pose. Khaki and olive clothing, brown boots, red scarf.' },
  { id: 'hero-cherry-tree', name: 'Cherry blossom tree', category: 'nature', libraryCategory: 'nature', keywords: ['cherry blossom', 'sakura tree', 'blossom tree'], brief: 'A Japanese cherry blossom (sakura) tree about 5.5 m tall and 7 m wide: a gnarled, twisting dark trunk that splits into spreading curved branches, and a canopy of many overlapping puffy pink blossom clumps of varied size and shade, a few clumps hanging lower, and scattered pink petals on the ground around the trunk.' },
  { id: 'hero-gazebo', name: 'Garden gazebo', category: 'building', libraryCategory: 'architecture', keywords: ['gazebo', 'garden pavilion', 'bandstand'], brief: 'A Victorian octagonal garden gazebo, 4 m across and 4.6 m tall: a raised octagonal wooden floor with two entry steps, eight slender turned columns, decorative fretwork brackets and a low railing between the columns (open on the entrance side), an eight-sided curved roof with shingle bands and a weather-vane finial. White painted wood, slate-grey roof.' },
];

interface HeroRecord {
  id: string;
  name: string;
  category: AssetCategory;
  keywords: string[];
  size: [number, number, number];
  thumb: string;
  score: number | null;
  iterations: number;
  model: string;
}

function args(): { backend: 'claude-code' | 'codex'; only: Set<string> | null; maxCalls: number; force: boolean } {
  const get = (n: string): string | undefined => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const backend = get('backend') ?? 'claude-code';
  if (backend !== 'claude-code' && backend !== 'codex') throw new Error('--backend must be claude-code or codex');
  const only = get('only');
  return { backend, only: only ? new Set(only.split(',')) : null, maxCalls: Math.min(MAX_TOTAL_CALLS, Number(get('max-calls') ?? MAX_TOTAL_CALLS) || MAX_TOTAL_CALLS), force: process.argv.includes('--force') };
}

/** Counts calls across the whole run and refuses past the budget. */
function budgeted(base: Provider, max: number): Provider & { used(): number } {
  let calls = 0;
  return {
    ...base,
    used: () => calls,
    async complete(req: CompletionRequest, signal?: AbortSignal) {
      if (calls >= max) throw new Error(`call budget of ${max} reached`);
      calls++;
      return base.complete(req, signal);
    },
  } as Provider & { used(): number };
}

function b64(a: ArrayBufferView): string {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
}

/** Page-side renderer of generator outputs (four orthographic views + a thumbnail). */
const PAGE = `
import * as THREE from 'three';
const S = 256;
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
r.setPixelRatio(1);
r.outputColorSpace = THREE.SRGBColorSpace;
r.toneMapping = THREE.ACESFilmicToneMapping;
const dec = (s, T) => { const b = Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); return new T(b.buffer); };
function build(parts) {
  const g = new THREE.Group();
  for (const p of parts) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(dec(p.positions, Float32Array), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(dec(p.normals, Float32Array), 3));
    if (p.colors) geo.setAttribute('color', new THREE.BufferAttribute(dec(p.colors, Float32Array), 3));
    geo.setIndex(new THREE.BufferAttribute(dec(p.indices, Uint32Array), 1));
    const m = p.material || {};
    const mat = new THREE.MeshStandardMaterial({ color: m.color || '#c8c8c8', roughness: m.roughness ?? 0.7, metalness: m.metalness ?? 0, vertexColors: !!p.colors, flatShading: !!m.flatShading, transparent: (m.opacity ?? 1) < 1, opacity: m.opacity ?? 1, emissive: m.emissive || '#000000', emissiveIntensity: m.emissiveIntensity ?? (m.emissive ? 1 : 0), side: THREE.DoubleSide });
    g.add(new THREE.Mesh(geo, mat));
  }
  return g;
}
function scene(obj) {
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0x777066, 1.4));
  const d = new THREE.DirectionalLight(0xffffff, 1.8); d.position.set(4, 8, 6); s.add(d);
  s.add(obj);
  return s;
}
window.__views = (parts) => {
  const obj = build(parts);
  const s = scene(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const R = Math.max(size.x, size.y, size.z) * 0.62;
  r.setSize(S * 2, S * 2, false);
  r.setClearColor(0xe9ebef, 1);
  r.setScissorTest(true);
  const dirs = [[0, 0, 1], [1, 0, 0], [0, 1, 0.0001], [1, 0.8, 1.2]];
  dirs.forEach((dv, i) => {
    const cam = new THREE.OrthographicCamera(-R, R, R, -R, 0.01, R * 20);
    const v = new THREE.Vector3(...dv).normalize();
    cam.position.copy(c).addScaledVector(v, R * 6);
    cam.up.set(0, i === 2 ? 0 : 1, i === 2 ? -1 : 0);
    cam.lookAt(c);
    const x = (i % 2) * S, y = (1 - Math.floor(i / 2)) * S;
    r.setViewport(x, y, S, S); r.setScissor(x, y, S, S);
    r.render(s, cam);
  });
  r.setScissorTest(false);
  const sheet = canvas.toDataURL('image/jpeg', 0.85);
  // Thumbnail: three-quarter perspective on transparent background.
  r.setSize(192, 192, false);
  r.setViewport(0, 0, 192, 192);
  r.setClearColor(0x000000, 0);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 1000);
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const dist = sph.radius / Math.sin(THREE.MathUtils.degToRad(14)) * 1.04;
  cam.position.copy(sph.center).addScaledVector(new THREE.Vector3(1, 0.72, 1.35).normalize(), dist);
  cam.lookAt(sph.center);
  r.render(s, cam);
  const thumb = canvas.toDataURL('image/webp', 0.86);
  obj.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return { sheet, thumb };
};
window.__ready = true;
`;

async function main(): Promise<void> {
  const a = args();
  const sandbox = createNodeSandbox();
  const base = createHeadlessProvider(a.backend, { effort: 'medium', timeoutMs: 600_000 });
  const provider = budgeted(base, a.maxCalls);
  const coderSystem = buildCoderPrompt({ generators: catalog(), behaviors: BEHAVIOR_CATALOG, ruleDocs: RULE_DOCS, generatorApiDts: GENERATOR_API_DTS, generatorExamples: GENERATOR_EXAMPLES, scriptApiDts: SCRIPT_API_DTS });
  const records: HeroRecord[] = existsSync(HEROES_FILE) ? (JSON.parse(readFileSync(HEROES_FILE, 'utf8')) as { heroes: HeroRecord[] }).heroes : [];
  const todo = HEROES.slice(0, MAX_HEROES).filter((h) => (!a.only || a.only.has(h.id)) && (a.force || !records.some((r) => r.id === h.id)));
  mkdirSync(THUMB_DIR, { recursive: true });
  await withBrowserPage(async (page) => {
    await page.addScriptTag({ type: 'module', content: PAGE });
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
    const outputs = new Map<string, GeneratorOutput>();
    const runDefault = async (def: GeneratorDef): Promise<GeneratorOutput> => {
      const defaults: Record<string, Json> = {};
      for (const [k, s] of Object.entries(def.params)) defaults[k] = s.default;
      return sandbox.run(def, resolveParams(def.params, defaults), 1, { timeoutMs: 4000 });
    };
    const views = async (def: GeneratorDef): Promise<{ sheet: string; thumb: string }> => {
      const out = outputs.get(def.source) ?? (await runDefault(def));
      outputs.set(def.source, out);
      const parts = out.parts.map((p) => ({ positions: b64(p.positions), normals: b64(p.normals), indices: b64(p.indices), ...(p.colors ? { colors: b64(p.colors) } : {}), material: p.material }));
      return page.evaluate((ps) => (window as unknown as { __views(p: unknown): { sheet: string; thumb: string } }).__views(ps), parts);
    };
    for (const hero of todo) {
      if (provider.used() >= a.maxCalls) {
        console.log(`budget of ${a.maxCalls} calls reached; stopping`);
        break;
      }
      const remaining = a.maxCalls - provider.used();
      const usage: UsageTotals = { calls: 0, inputTokens: 0, outputTokens: 0 };
      console.log(`forging ${hero.id} (≤ ${Math.min(5, remaining)} calls)…`);
      let result;
      try {
        result = await forgeGenerator(
          {
            provider,
            coderSystem,
            validate: async (def) => {
              const check = await acceptLibraryGenerator(def, sandbox);
              return check.ok ? { ok: true } : { ok: false, error: check.error };
            },
            render: async (def) => (await views(def)).sheet,
            usage,
            vision: true,
            maxIterations: 2,
            maxCalls: Math.min(5, remaining),
            gate: 0.78,
            onIteration: (it) => console.log(`  pass ${it.index + 1}: score ${it.score ?? '—'} ${it.critique?.summary ?? it.error ?? ''}`),
          },
          { id: hero.id, description: hero.brief },
        );
      } catch (e) {
        console.log(`  failed: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      if (!result.def) {
        console.log(`  no valid generator (${result.error ?? result.reason})`);
        continue;
      }
      const def = result.def;
      const check = await acceptLibraryGenerator(def, sandbox);
      if (!check.ok) {
        console.log(`  rejected: ${check.error}`);
        continue;
      }
      const { thumb } = await views(def);
      const data = Buffer.from(thumb.split(',')[1] ?? '', 'base64');
      const h = createHash('sha256').update(data).digest('hex').slice(0, 8);
      const thumbPath = `t/${hero.id}.${h}.webp`;
      writeFileSync(join(ROOT, 'assets', 'lib', thumbPath), data);
      const file: LibraryFile = LibraryFileSchema.parse({
        version: 1,
        entry: { id: hero.id, description: hero.name + ': ' + def.description.slice(0, 280 - hero.name.length), category: hero.libraryCategory, keywords: hero.keywords, params: def.params, size: check.size },
        def,
        provenance: { source: a.backend, effort: 'medium', createdAt: new Date().toISOString(), attempts: result.iterations.length },
        checks: { triangles: check.triangles, parts: check.parts, colliders: check.colliders },
      });
      writeFileSync(join(LIB_DIR, `${hero.id}.json`), serializeLibraryFile(file));
      const rec: HeroRecord = { id: hero.id, name: hero.name, category: hero.category, keywords: hero.keywords, size: check.size, thumb: thumbPath, score: result.best?.score ?? null, iterations: result.iterations.length, model: a.backend };
      const i = records.findIndex((r) => r.id === hero.id);
      if (i >= 0) records[i] = rec;
      else records.push(rec);
      writeFileSync(HEROES_FILE, `${JSON.stringify({ $comment: 'AI-generated procedural generators (asset forge). Merged into the catalog by scripts/assets/build.ts.', heroes: records }, null, 2)}\n`);
      console.log(`  saved ${hero.id}: score ${rec.score}, ${check.triangles} tris, ${usage.calls} calls`);
    }
  });
  sandbox.dispose?.();
  console.log(`done: ${provider.used()} model calls`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
