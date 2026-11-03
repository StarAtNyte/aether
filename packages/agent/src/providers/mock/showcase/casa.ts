/**
 * Casa del Patio: a courtyard house in the hills above Sintra. Eight rooms
 * ring a stone patio with a lap pool, an olive tree and a timber pergola;
 * every room opens onto it through sliding glass. Limewashed walls,
 * terracotta tile, oak and wrought iron; a papered library, a panelled
 * living room, drawers and cabinets that open, mugs to pick up. Built by the
 * same `build_architecture` plan as any building, then staged on a dry hill
 * plot with an olive grove, cypresses, a gravel drive and the serra behind.
 *
 * Seven rooms around a stone patio; the plan below
 * is the same one the saved world uses.
 */
import { r2 } from '../builder';
import type { MockPlan } from '../planner';
import { estateGround, finish, flagshipBuilder, grove, landPoints } from './kit';

const CONTROLS = ['WASD — walk', 'Mouse — look', 'E — open · use · pick up · talk', 'Click — throw', '1–4 — time of day', 'P — photo mode'];

/** Plan origin in the world: the house is centred on the world origin. */
const ORIGIN: [number, number] = [-9.5, -7.5];

/** The building plan (plan coordinates in metres; x east, z south). */
export function casaPlan(): Record<string, unknown> {
  return {
    id: 'casa',
    name: 'Casa del Patio',
    style: 'mediterranean',
    origin: ORIGIN,
    residents: 3,
    plinth: 0.22,
    exteriorWall: { thickness: 0.42, finish: { finish: 'plaster', color: '#f2ede3' } },
    interiorWall: { thickness: 0.14 },
    levels: [
      {
        name: 'Ground floor',
        height: 3.3,
        autoWindows: false,
        rooms: [
          { id: 'living', type: 'living', name: 'Living room', rect: [0, 0, 9, 5], dado: { height: 1.05, material: { finish: 'panelling', color: '#e8e0d0' }, rail: true } },
          { id: 'kitchen', type: 'kitchen', name: 'Kitchen and dining', rect: [9, 0, 19, 5] },
          { id: 'study', type: 'office', name: 'Library', rect: [0, 5, 5, 11], finish: { finish: 'wallpaper-stripe', color: '#d9dfcf' }, dado: { height: 0.9, material: { finish: 'panelling', color: '#566a52' }, rail: true } },
          { id: 'bed1', type: 'bedroom', name: 'Guest bedroom', rect: [14, 5, 19, 11], walls: { east: { finish: 'wallpaper-floral', color: '#e2e6d3' } } },
          { id: 'hall', type: 'hall', name: 'Entrance hall', rect: [0, 11, 6, 15] },
          { id: 'master', type: 'bedroom', name: 'Main bedroom', rect: [6, 11, 14, 15], walls: { south: { finish: 'wallpaper-damask', color: '#e5ddc9' } } },
          { id: 'bath', type: 'bathroom', name: 'Bathroom', rect: [14, 11, 19, 15] },
        ],
        doors: [
          { between: ['hall', 'outside'], side: 'south', main: true, width: 1.3, style: 'panel' },
          { between: ['living', 'outside'], side: 'south', kind: 'sliding', width: 3.2, style: 'glass' },
          { between: ['kitchen', 'outside'], side: 'south', kind: 'sliding', width: 3.2, style: 'glass' },
          { between: ['study', 'outside'], side: 'east', kind: 'sliding', width: 2, style: 'glass' },
          { between: ['bed1', 'outside'], side: 'west', kind: 'sliding', width: 2, style: 'glass' },
          { between: ['master', 'outside'], side: 'north', kind: 'sliding', width: 3.2, style: 'glass' },
          { between: ['living', 'kitchen'], kind: 'opening', width: 2.6 },
          { between: ['living', 'study'], kind: 'opening', width: 1.4, at: 0.3 },
          { between: ['hall', 'study'], kind: 'opening', width: 1.7 },
          { between: ['hall', 'master'], width: 1 },
          { between: ['bed1', 'bath'], width: 0.85 },
          { between: ['master', 'bath'], width: 0.85 },
        ],
        windows: [
          { room: 'living', side: 'north', count: 2, width: 2.2, height: 2.3, sill: 0.6, style: 'casement' },
          { room: 'living', side: 'west', count: 1, width: 1.6, height: 2.2, sill: 0.7, style: 'casement' },
          { room: 'kitchen', side: 'north', count: 2, width: 1.6, height: 1.3, sill: 1.05, style: 'casement' },
          { room: 'kitchen', side: 'east', count: 1, width: 1.4, height: 2.2, sill: 0.7, style: 'casement' },
          { room: 'study', side: 'west', count: 1, width: 1.5, height: 2.1, sill: 0.8, style: 'casement' },
          { room: 'bed1', side: 'east', count: 1, width: 1.5, height: 2.1, sill: 0.8, style: 'casement' },
          { room: 'master', side: 'south', count: 2, width: 1.5, height: 2.1, sill: 0.8, style: 'casement' },
          { room: 'bath', side: 'south', count: 1, width: 0.8, height: 0.9, sill: 1.4, style: 'fixed' },
          { room: 'bath', side: 'east', count: 1, width: 0.8, height: 0.9, sill: 1.4, style: 'fixed' },
        ],
      },
    ],
    roof: { shape: 'flat', overhang: 0.35 },
    site: {
      // The patio: stone flags around a lap pool.
      terrace: [[5.2, 5.2], [13.8, 5.2], [13.8, 10.8], [5.2, 10.8]],
      terraceFinish: { finish: 'stone', color: '#d8cfbd' },
      pool: { at: [11.5, 8], width: 2.8, length: 4.4 },
      planting: true,
    },
  };
}

/** Casa del Patio: a courtyard house above Sintra at the golden end of the afternoon. */
export function casaPatio(): MockPlan {
  const b = flagshipBuilder(0x5171, { dusk: true });
  b.env({
    sky: 'sunset',
    timeOfDay: 17.3,
    sunIntensity: 3.4,
    ambientIntensity: 0.75,
    fog: { color: '#ecd6b4', density: 0.0009 },
    bloom: 0.4,
    exposure: 1.1,
    weather: 'clear',
    ground: null,
  });
  const [ox, oz] = ORIGIN;
  const at = (x: number, z: number): [number, number] => [r2(ox + x), r2(oz + z)];
  // The plot: a level terrace of the hill for the house, forecourt and drive (the drive runs on a level lane), meadow swells
  // around it and the serra closing the horizon.
  const land = estateGround(b, 0x5171, { size: 440, relief: 46, pad: [0, 0, 27], lane: [r2(ox + 3), 52, 8], color: '#9a9a58', roughness: 0.45, name: 'Hillside above Sintra' });
  b.keepClearRect(ox - 1, oz - 1, ox + 20, oz + 16);
  // Gravel forecourt and drive down to the lane, edged with dry-stone walls.
  const [dx, dz0] = at(3, 15.2);
  b.keepClearRect(dx - 6.5, dz0 - 1, dx + 6.5, dz0 + 36);
  b.prim('drive', 'box', [4.2, 0.08, 34], [dx, 0.04, r2(dz0 + 17)], { name: 'Gravel drive', material: { finish: 'gravel', color: '#b9ad94' }, physics: 'static', castShadow: false, tags: ['site'] });
  b.prim('forecourt', 'box', [11, 0.08, 6.5], [r2(dx + 0.5), 0.04, r2(dz0 + 3)], { name: 'Forecourt', material: { finish: 'stone', color: '#cdc2ad' }, physics: 'static', castShadow: false, tags: ['site'] });
  for (const side of [-1, 1] as const) {
    const [wx] = at(3 + side * 6.2, 0);
    b.prim('wall-garden', 'box', [0.55, 0.85, 30], [wx, 0.42, r2(dz0 + 17)], { name: 'Dry-stone wall', material: { finish: 'stone', color: '#b3a894' }, physics: 'static', tags: ['site', 'wall'] });
  }
  // Pergola over the patio table in the western half of the patio: oak posts, beams and slats.
  const [px0, pz0] = at(5.7, 6.0);
  const oak = { finish: 'oak' as const, color: '#a97d52' };
  for (const [x, z] of [[0, 0], [3.8, 0], [0, 4], [3.8, 4]] as const) b.prim('pergola-post', 'box', [0.16, 2.7, 0.16], [r2(px0 + x), 1.35 + 0.22, r2(pz0 + z)], { material: oak, physics: 'static', tags: ['pergola'] });
  for (const z of [0, 4]) b.prim('pergola-beam', 'box', [4.2, 0.18, 0.14], [r2(px0 + 1.9), 2.98, r2(pz0 + z)], { material: oak, physics: 'static', castShadow: true, tags: ['pergola'] });
  for (let k = 0; k < 10; k++) b.prim('pergola-slat', 'box', [0.07, 0.07, 4.3], [r2(px0 - 0.1 + k * 0.45), 3.1, r2(pz0 + 2)], { material: oak, physics: 'static', tags: ['pergola'] });
  b.gen('patio-table', 'furn-table', { width: 2.1, depth: 0.95, shape: 'rect', top: 'oak', base: 'trestle', legs: 'oak' }, [r2(px0 + 1.9), 0.22, r2(pz0 + 2)], { yaw: 90, physics: 'static', name: 'Patio table' });
  for (const [x, z, yaw] of [[1.15, -0.5, 270], [1.15, 0.5, 270], [2.65, -0.5, 90], [2.65, 0.5, 90]] as const) {
    b.gen('patio-chair', 'furn-chair', { wood: 'oak', seat: 'wood', style: 'slat' }, [r2(px0 + x), 0.22, r2(pz0 + 1.9 + z)], { yaw, physics: 'static', name: 'Chair' });
  }
  // A big olive in the corner of the patio.
  const [tx, tz] = at(6.1, 10.0);
  b.gen('patio-olive', 'tree-olive', { height: 4.8, variant: 1, color: '#7f8f66', trunkColor: '#7d6d5a', detail: 1.2 }, [tx, 0.22, tz], { physics: 'static', tags: ['tree'], name: 'Olive tree' });
  // The olive grove below the house and cypresses along the drive.
  for (let i = 0; i < 34; i++) {
    // Terraces of olives on both sides of the drive, near enough to walk among, thinning out up the hill.
    const p = i < 26 ? b.spot(-6, 26, 9, 32, 3.6) : b.spot(0, 30, 30, 70, 3.4);
    if (!p || (Math.abs(p[0] + 6.5) < 6.5 && p[1] > 4) || (Math.abs(p[0]) < 12 && p[1] < 14) || Math.hypot(p[0] + 22, p[1] + 26) < 18) continue; // nothing grows in front of the cover camera
    b.gen('olive', 'tree-olive', { height: r2(b.rand(4, 6)), variant: b.chance(0.5) ? 1 : 0, color: b.chance(0.5) ? '#76865a' : '#849270', trunkColor: '#7d6d5a', detail: 1 }, [p[0], land.h(p[0], p[1]), p[1]], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
  }
  for (const side of [-1, 1] as const) {
    for (let k = 0; k < 4; k++) {
      const [cx] = at(3 + side * 4.4, 0);
      b.gen('cypress', 'tree-cypress', { height: r2(b.rand(8.5, 11.5)), color: '#2f3f2c', variant: k % 2 }, [cx, land.h(cx, r2(dz0 + 4 + k * 6)), r2(dz0 + 4 + k * 6)], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
    }
  }
  for (let i = 0; i < 5; i++) {
    const p = b.spot(-30, -22, 4, 22, 4);
    if (!p || Math.hypot(p[0] + 22, p[1] + 26) < 14) continue; // not in front of the cover camera
    b.gen('pine', 'tree-umbrella-pine', { height: r2(b.rand(11, 14)), variant: 1, color: '#4f6c3a', detail: 1 }, [p[0], land.h(p[0], p[1]), p[1]], { yaw: r2(b.rand(0, 360)), physics: 'static', tags: ['tree'] });
  }
  // The serra: oak and umbrella-pine woods on the hills, scrub and boulders on the slopes between.
  const nearLane = (x: number, z: number): boolean => z > -4 && Math.abs(x - (ox + 3)) < 11;
  const woods = (x: number, z: number, minD: number): boolean => Math.hypot(x, z) > minD && !nearLane(x, z) && land.slope(x, z) < 30 && Math.hypot(x + 22, z + 26) > 20; // clear of the cover camera
  grove(b, 'woods-oak', 'Cork oak woods', 'tree-broadleaf', { height: 9.5, detail: 0.5, color: '#5a6f3d', variant: 1 }, landPoints(b, 330, 210, (x, z) => woods(x, z, 58), 6.5, land.h), [0.8, 1.35], land.id);
  grove(b, 'woods-pine', 'Stone pines', 'tree-umbrella-pine', { height: 15, detail: 0.5, color: '#3f5a36', variant: 1 }, landPoints(b, 150, 210, (x, z) => woods(x, z, 70), 7, land.h), [0.8, 1.3], land.id);
  grove(b, 'scrub', 'Scrub', 'shrub', { size: 1.4, detail: 0.6, color: '#6c7a46' }, landPoints(b, 420, 190, (x, z) => woods(x, z, 34), 2.6, land.h), [0.7, 1.5], land.id);
  const grass = { heightAt: land.h, onSurface: land.id, minSpacing: 0.5, scaleRange: [0.7, 1.6] as [number, number] };
  b.scatter('dry-grass', 'grass-tuft', { color: '#a9a266', size: 0.7 }, 3200, [150, 110], [0, 0, 52], grass);
  b.scatter('dry-grass-near', 'grass-tuft', { color: '#a9a266', size: 0.7 }, 1900, [64, 40], [-6, 0, 31], { ...grass, minSpacing: 0.35 });
  // The slope in front of the cover camera and the paths round the house: close, dense tussocks and flowers, so the lawn reads as meadow from above.
  b.scatter('dry-grass-cover', 'grass-tuft', { color: '#b0a868', size: 0.8 }, 2400, [44, 36], [-13, 0, -17], { ...grass, minSpacing: 0.3, scaleRange: [0.8, 1.8] });
  b.scatter('wildflowers-cover', 'flowers', { color: '#e8d9a0', size: 0.5 }, 160, [44, 36], [-13, 0, -17], { ...grass, minSpacing: 0.7 });
  b.scatter('dry-grass-back', 'grass-tuft', { color: '#a39c62', size: 0.7 }, 1500, [150, 70], [0, 0, -52], grass);
  b.scatter('dry-grass-side', 'grass-tuft', { color: '#a9a266', size: 0.7 }, 1100, [60, 60], [-50, 0, 0], grass);
  b.scatter('dry-grass-east', 'grass-tuft', { color: '#a9a266', size: 0.7 }, 1100, [60, 60], [50, 0, 0], grass);
  b.scatter('wildflowers', 'flowers', { color: '#e8d9a0', size: 0.5 }, 260, [120, 90], [0, 0, 50], { ...grass, minSpacing: 0.8 });
  b.scatter('agave', 'bush', { color: '#6f8b6a', size: 0.7 }, 40, [60, 40], [-10, 0, 40], { ...grass, minSpacing: 2.5, scaleRange: [0.7, 1.2] });
  b.scatter('rocks', 'rock', { size: 0.9 }, 36, [160, 120], [0, 0, 20], { ...grass, minSpacing: 3, scaleRange: [0.6, 1.8] });
  b.player({ mode: 'firstPerson', moveSpeed: 3.1 });
  return finish(b, {
    name: 'Casa del Patio',
    description: 'A courtyard house in the hills above Sintra: eight rooms around a stone patio and a lap pool.',
    intro: {
      title: 'Casa del Patio',
      tagline: 'A courtyard house in the hills above Sintra.',
      objective: 'Walk in, say hello to the family, open the drawers and the shutters of the day, carry a coffee out to the patio.',
      controls: CONTROLS,
      accent: '#d98a5f',
    },
    plan: 'Plan: mediterranean courtyard house (7 rooms ringing a stone patio with a lap pool, sliding glass to the patio, flat roof with parapet) compiled with build_architecture, papered library, panelled living room, pergola, olive grove, cypress drive and the serra behind.',
    message: 'Built Casa del Patio: a courtyard house in the hills above Sintra, seven rooms around a stone patio with a lap pool. Press Play to walk it: E opens doors, drawers and cabinets, turns on the tap and picks up the mugs (click throws). The Architecture bar has the cutaway, the exploded storeys and the section.',
    arch: { ops: [{ op: 'create_building', plan: casaPlan() }], message: 'Casa del Patio' },
  });
}
