import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { scoreFindings } from '@aether/arch';
import { describe, expect, it } from 'vitest';
import { artifactFindings, findBuildingsInRock, findLandEnds, findMeshClouds, findPlainPlanes, findPlantsInFalls, findSkyPieces, withArtifacts } from '../src/artifacts';
import type { ReviewSnapshot } from '../src/review';

function world(entities: Array<Record<string, unknown>>, env: Record<string, unknown> = {}): WorldDoc {
  const base = createWorld();
  const out = applyPatches({ ...base, environment: { ...base.environment, ...env } } as WorldDoc, entities.map((entity) => ({ op: 'add', entity })) as never);
  expect(out.errors).toEqual([]);
  return out.world;
}

const proc = (id: string, generator: string, params: Record<string, unknown>, position: [number, number, number], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  shape: { kind: 'procedural', generator, params, seed: 1 },
  transform: { position },
  ...extra,
});

const CLIFF = { width: 40, height: 30, depth: 16, variant: 1 };

describe('pieces in the sky', () => {
  it('finds a solid piece hanging high over the ground with nothing under it', () => {
    const w = world([
      proc('sky-crate', 'crate', {}, [0, 30, 0]),
      proc('drone-crate', 'crate', {}, [10, 30, 0], { tags: ['flying'] }),
      { id: 'tower', shape: { kind: 'primitive', primitive: 'box', size: [4, 30, 4] }, transform: { position: [-10, 15, 0] } },
      proc('on-tower', 'crate', {}, [-10, 30, 0]),
      proc('on-ground', 'crate', {}, [20, 0, 0]),
    ]);
    const ids = findSkyPieces(w).flatMap((a) => a.ids);
    expect(ids).toEqual(['sky-crate']);
  });

  it('does not report a piece standing on the real top of a cliff', () => {
    const w = world([proc('cliff', 'cliff-face', CLIFF, [0, 0, 0]), proc('shrine-crate', 'crate', {}, [0, 29, -2])]);
    expect(findSkyPieces(w)).toEqual([]);
  });
});

describe('cloud meshes', () => {
  it('finds cloud meshes in front of a photographed sky, and leaves an analytic sky or a tagged cloud alone', () => {
    const clouds = [proc('cloud-1', 'cloud', { size: 20 }, [0, 120, -200], { tags: ['backdrop'] }), proc('cloud-2', 'cloud', { size: 20 }, [50, 120, -200], { tags: ['mesh-cloud'] })];
    const found = findMeshClouds(world(clouds, { hdri: 'sky-partly-cloudy' }));
    expect(found).toHaveLength(1);
    expect(found[0]?.ids).toEqual(['cloud-1']);
    expect(findMeshClouds(world(clouds))).toEqual([]);
    expect(findMeshClouds(world(clouds, { hdri: 'sky-partly-cloudy', hdriBackground: false }))).toEqual([]);
  });
});

describe('the land ending', () => {
  const land = (id: string, size: number, extra: Record<string, unknown> = {}): Record<string, unknown> => proc(id, 'terrain', { size, height: 6, variant: 0, ...extra }, [0, 0, 0], { tags: ['terrain'] });

  it('finds a small terrain with nothing beyond it and no built-in ground', () => {
    const found = findLandEnds(world([land('land', 260)], { ground: null }));
    expect(found.map((a) => a.code)).toEqual(['land_ends']);
    expect(found[0]?.fix).toMatch(/cutX0/);
  });

  it('is satisfied by an outer land, a sea or the built-in ground', () => {
    expect(findLandEnds(world([land('land', 260), land('outer', 1000, { variant: 5, cutX0: -129, cutZ0: -129, cutX1: 129, cutZ1: 129 })], { ground: null }))).toEqual([]);
    expect(findLandEnds(world([land('land', 260), { id: 'sea', shape: { kind: 'primitive', primitive: 'box', size: [3000, 0.4, 3000] }, tags: ['water'] }], { ground: null }))).toEqual([]);
    expect(findLandEnds(world([land('land', 260)]))).toEqual([]);
  });
});

describe('plain planes', () => {
  it('finds a large flat sheet with a plain colour and no surface', () => {
    const sheet = (id: string, material: Record<string, unknown>, tags: string[] = []): Record<string, unknown> => ({ id, shape: { kind: 'primitive', primitive: 'box', size: [120, 0.2, 80] }, material, tags });
    const w = world([
      sheet('white-sheet', { color: '#ffffff' }),
      sheet('meadow', { color: '#6a9a45', preset: 'grass' }),
      sheet('lake', { color: '#2a6f86' }, ['water']),
      { id: 'crate-box', shape: { kind: 'primitive', primitive: 'box', size: [2, 2, 2] }, material: { color: '#ffffff' } },
    ]);
    expect(findPlainPlanes(w).flatMap((a) => a.ids)).toEqual(['white-sheet']);
  });
});

describe('buildings in the rock', () => {
  it('finds a house set into a cliff, and leaves one on its top or tagged sunk alone', () => {
    const w = world([
      proc('cliff', 'cliff-face', CLIFF, [0, 0, 0]),
      proc('in-cliff', 'furn-dwelling', { type: 'stone-cottage' }, [0, 10, -3]),
      proc('dug-in', 'furn-dwelling', { type: 'stone-cottage' }, [8, 10, -3], { tags: ['sunk'] }),
      proc('on-top', 'furn-dwelling', { type: 'stone-cottage' }, [-6, 29.5, -3]),
    ]);
    const ids = findBuildingsInRock(w).flatMap((a) => a.ids);
    expect(ids).toContain('in-cliff');
    expect(ids).not.toContain('dug-in');
    expect(ids).not.toContain('on-top');
  });
});

describe('plants in a waterfall', () => {
  it('finds a row of shrubs hung across the falling water, whatever its tags, and leaves the pool edge alone', () => {
    const fall = proc('falls', 'waterfall-sheet', { height: 30, width: 12, variant: 1 }, [0, 0, 0]);
    const row = (id: string, y: number, tags: string[] = []): Record<string, unknown> => ({
      id,
      shape: { kind: 'scatter', of: { kind: 'procedural', generator: 'shrub', params: { size: 1.5 } }, count: 20, area: [10, 1] },
      transform: { position: [0, y, 0.5] },
      tags,
    });
    const w = world([fall, row('mid-air', 15, ['floating']), row('pool-edge', 0)]);
    const ids = findPlantsInFalls(w).flatMap((a) => a.ids);
    expect(ids).toEqual(['mid-air']);
  });
});

describe('review findings', () => {
  it('adds the artifacts to a review snapshot and replaces the last round of them', () => {
    const w = world([proc('sky-crate', 'crate', {}, [0, 30, 0])]);
    const findings = artifactFindings(w);
    expect(findings.map((f) => f.code)).toEqual(['sky_piece']);
    expect(findings[0]?.severity).toBe('warning');
    const old = { code: 'sky_piece', severity: 'warning', message: 'old', entities: ['gone'], fix: '' } as never;
    const snap = { buildings: [], findings: [old], score: scoreFindings([old]), keys: new Set<string>(), views: [] } as unknown as ReviewSnapshot;
    const next = withArtifacts(snap, w);
    expect(next.findings.map((f) => f.message)).not.toContain('old');
    expect(next.findings.some((f) => f.entities.includes('sky-crate'))).toBe(true);
  });
});
