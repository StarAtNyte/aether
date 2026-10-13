/**
 * Build-time helpers of the offline generator library (used by
 * `scripts/build-generator-library.ts` and its tests): the on-disk file
 * format, the acceptance check every generator must pass before it ships,
 * and the generated catalog module. Not part of the runtime bundle.
 */
import { z } from 'zod';
import { GeneratorDef, ParamSpec, type Json } from '@aether/core';
import { resolveParams } from './params';
import { staticCheckSource } from './sandbox/static-check';
import { checkSilhouette } from './silhouette';
import type { SandboxRunner } from './types';

/** Acceptance limits of a library generator. */
export const LIBRARY_LIMITS = Object.freeze({
  /** Triangle budget per instance (library objects are props, not terrains). */
  MAX_TRIANGLES: 60_000,
  /** Sandbox time budget per run (ms). */
  RUN_TIMEOUT_MS: 2_000,
  /** Seeds every generator must succeed with. */
  SEEDS: [1, 7, 42] as readonly number[],
  MAX_KEYWORDS: 8,
});

const Keyword = z.string().regex(/^[a-z]+( [a-z]+){0,2}$/);

/** Catalog data of one library generator (also the shape stored in each file). */
export const LibraryEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  description: z.string().min(1).max(300),
  category: z.enum(['nature', 'architecture', 'props', 'vehicles', 'terrain', 'fx']),
  keywords: z.array(Keyword).min(1).max(LIBRARY_LIMITS.MAX_KEYWORDS),
  params: z.record(z.string(), ParamSpec),
  /** Bounding size [w, h, d] in metres at default params (placement footprint). */
  size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
});
export type LibraryEntryData = z.infer<typeof LibraryEntrySchema>;

/** One `packages/procgen/library/<id>.json` file. */
export const LibraryFileSchema = z.object({
  version: z.literal(1),
  entry: LibraryEntrySchema,
  def: GeneratorDef,
  provenance: z.object({
    /** "codex": written by the coding model; "example": a reviewed few-shot example. */
    source: z.enum(['codex', 'example']),
    model: z.string().max(80).optional(),
    effort: z.string().max(20).optional(),
    createdAt: z.string().max(40),
    attempts: z.number().int().min(0).max(10),
  }),
  checks: z.object({ triangles: z.number().int().nonnegative(), parts: z.number().int().nonnegative(), colliders: z.number().int().nonnegative() }),
});
export type LibraryFile = z.infer<typeof LibraryFileSchema>;

/** Outcome of {@link acceptLibraryGenerator}. */
export type LibraryCheck =
  | { ok: true; size: [number, number, number]; triangles: number; parts: number; colliders: number }
  | { ok: false; error: string };

function defaults(def: GeneratorDef): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [k, spec] of Object.entries(def.params)) out[k] = spec.default;
  return out;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Run `def` in the sandbox with default params for every seed and apply the
 * library acceptance rules: static check, valid output (enforced by the
 * runner), plausible size, grounded and centred, visible silhouette that is
 * more than one box, triangle budget, at least one collider (solid object).
 * The error text is phrased as an instruction for a repair attempt.
 */
export async function acceptLibraryGenerator(def: GeneratorDef, runner: SandboxRunner): Promise<LibraryCheck> {
  const report = staticCheckSource(def.source);
  if (!report.ok) return { ok: false, error: `source rejected: ${report.problems.slice(0, 5).join('; ')}` };
  const params = resolveParams(def.params, defaults(def));
  let first: LibraryCheck | null = null;
  for (const seed of LIBRARY_LIMITS.SEEDS) {
    let out;
    try {
      out = await runner.run(def, params, seed, { timeoutMs: LIBRARY_LIMITS.RUN_TIMEOUT_MS });
    } catch (e) {
      return { ok: false, error: `run failed (seed ${seed}): ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}` };
    }
    if (out.stats.triangles > LIBRARY_LIMITS.MAX_TRIANGLES) return { ok: false, error: `too many triangles (${out.stats.triangles}; keep under ${LIBRARY_LIMITS.MAX_TRIANGLES})` };
    const verdict = checkSilhouette(out);
    if (!verdict.ok) return { ok: false, error: verdict.error };
    if (out.colliders.length === 0) return { ok: false, error: 'no colliders: call api.autoColliders() or add api.collider(...) so the object is solid' };
    if (!first) {
      const { min, max } = out.bounds;
      first = { ok: true, size: [r3(max[0] - min[0]), r3(max[1] - min[1]), r3(max[2] - min[2])], triangles: out.stats.triangles, parts: out.parts.length, colliders: out.colliders.length };
    }
  }
  return first ?? { ok: false, error: 'no seeds configured' };
}

/** Stable JSON text of a library file (sorted keys come from construction order). */
export function serializeLibraryFile(file: LibraryFile): string {
  return `${JSON.stringify(LibraryFileSchema.parse(file), null, 2)}\n`;
}

/** Source of `library-index.ts` for the given (validated) entries, sorted by id. */
export function renderLibraryIndex(entries: readonly LibraryEntryData[]): string {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const ids = sorted.map((e) => LibraryEntrySchema.parse(e).id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate library ids');
  const lines = [
    '// Generated by scripts/build-generator-library.ts — do not edit by hand.',
    "import type { LibraryEntry } from './library';",
    '',
    '/** Catalog of the shipped library generators. */',
    `export const LIBRARY_ENTRIES: readonly LibraryEntry[] = ${JSON.stringify(sorted, null, 2)};`,
    '',
    '/** Lazy loaders (one JSON file per generator, its own chunk in the browser). */',
    'export const LIBRARY_LOADERS: Readonly<Record<string, () => Promise<unknown>>> = {',
    ...ids.map((id) => `  '${id}': () => import('../library/${id}.json'),`),
    '};',
    '',
  ];
  return lines.join('\n');
}
