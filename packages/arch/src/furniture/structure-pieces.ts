/**
 * Pieces for the architecture elements that stand on their own in a world: a spiral stair, a dormer and a turret roof.
 * They wrap the `arch-*` builders (the same geometry the structural generators make) with scalar params and aliases, so
 * `find_model` names them and `place_items` / `shape_land` stand them up like any other crafted piece.
 *
 * Frames differ from the structural elements: a furniture piece is centred on its footprint, so the dormer (whose own
 * origin is the foot of its front wall on the roof surface) is shifted back by half its depth here.
 */
import type { MaterialSpec } from '@aether/core';
import { buildDormer, dormerShape } from '../dormer';
import { DormerParams, SpiralStairParams, TurretRoofParams } from '../params';
import { buildSpiralStair } from '../spiral';
import { buildTurretRoof } from '../turret';
import type { ArchOutput } from '../types';
import { choice, color, flag, int, mat, num, type FurnitureDef } from './kit';

/** An output moved by (dx, dy, dz): positions and collider offsets. */
function shifted(out: ArchOutput, dx: number, dy: number, dz: number): ArchOutput {
  return {
    parts: out.parts.map((p) => {
      const positions = new Float32Array(p.positions);
      for (let k = 0; k < positions.length; k += 3) {
        positions[k] = (positions[k] as number) + dx;
        positions[k + 1] = (positions[k + 1] as number) + dy;
        positions[k + 2] = (positions[k + 2] as number) + dz;
      }
      return { ...p, positions };
    }),
    colliders: out.colliders.map((c) => {
      if (c.kind === 'trimesh') {
        const positions = new Float32Array(c.positions);
        for (let k = 0; k < positions.length; k += 3) {
          positions[k] = (positions[k] as number) + dx;
          positions[k + 1] = (positions[k + 1] as number) + dy;
          positions[k + 2] = (positions[k + 2] as number) + dz;
        }
        return { ...c, positions };
      }
      return { ...c, offset: [c.offset[0] + dx, c.offset[1] + dy, c.offset[2] + dz] as [number, number, number] };
    }),
  };
}

const tint = (finish: string, c: string): MaterialSpec => mat(finish, c);

export const SPIRAL_STAIR: FurnitureDef = {
  id: 'furn-spiral-stair',
  kind: 'spiral-stair',
  aliases: ['spiral stair', 'spiral staircase', 'spiral stairs', 'helical stair', 'winding stair', 'winding staircase', 'circular stair', 'circular staircase', 'round stair', 'loft stair', 'turret stair', 'tower stair', 'stairs to the loft'],
  description:
    'Spiral staircase from the floor to a floor `rise` above: tread wedges fanned round a centre post (`core` solid) or a slim open core, `turns` turns of climb (about 1 turn for a 2.8 m rise; more than 1.3 turns leaves under 2 m of headroom), radius 1.3 m or more so a body climbs it, `hand` right (climbs clockwise seen from above) or left, a balustrade on the outer edge (`rail` outer, both with an open core, or none) and a guard round the opening on the floor above. Origin on the axis at the floor; the first tread points along +X. Cut a hole in the floor above for the stairwell: a disc of `radius` without the sector the landing fills (the arch-spiral-stair generator and `spiralFootprint` give the outline). The walking line and treads are exact, so the bot and the player climb it.',
  params: {
    radius: num(1.4, 0.55, 3, 'outer radius of the treads (m); under about 1.3 m a person of the player\'s width catches on the inner treads (spiralProblems says so)'),
    rise: num(2.8, 0.5, 30, 'floor-to-floor height (m)'),
    turns: num(1, 0.25, 4, 'turns from the first tread to the floor above'),
    hand: choice(['right', 'left'], 'right', 'right climbs clockwise seen from above'),
    core: choice(['solid', 'open'], 'solid', 'centre post or a slim open core'),
    rail: choice(['outer', 'both', 'none'], 'outer', 'balustrade (both needs an open core)'),
    balustrade: choice(['steel', 'timber', 'glass'], 'steel', 'look of the balustrade'),
    treads: choice(['oak', 'walnut', 'ash', 'concrete', 'marble'], 'oak', 'tread material'),
    steel: color('#2b2d31', 'post, riser and rail colour'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 0.9,
  size: (p) => [p.num('radius') * 2.1, p.num('rise') + 0.9, p.num('radius') * 2.1],
  build(p) {
    const rail = tint('black-metal', p.color('steel'));
    return buildSpiralStair(
      SpiralStairParams.parse({
        radius: p.num('radius'),
        rise: p.num('rise'),
        turns: p.num('turns'),
        hand: p.str('hand'),
        core: p.str('core'),
        rail: p.str('rail'),
        balustrade: p.str('balustrade'),
        finish: mat(p.str('treads')),
        structure: rail,
        railMaterial: rail,
      }),
    );
  },
};

export const DORMER: FurnitureDef = {
  id: 'furn-dormer',
  kind: 'dormer',
  aliases: ['dormer', 'dormer window', 'roof dormer', 'gable dormer', 'shed dormer', 'hip dormer', 'hipped dormer', 'attic window', 'roof window', 'loft window'],
  description:
    'Dormer window for a pitched roof: a front wall with a window, two cheeks and a gable, shed or hip roof, flashed where it meets the slope. `roofPitch` is the pitch of the roof it stands on: the cheeks and the dormer roof run back up the slope until they meet that plane, so set it to the roof\'s pitch. The front faces +Z, down the slope; place the piece on the roof surface (the foot of the front wall) and turn it to face the way the slope falls. The piece is centred on its footprint: its front wall is `depth` / 2 in front of the origin (the answer gives the depth).',
  params: {
    style: choice(['gable', 'shed', 'hip'], 'gable', 'dormer roof form'),
    width: num(1.4, 0.6, 4, 'width of the front wall (m)'),
    wallHeight: num(1.3, 0.6, 2.4, 'height of the front wall above the roof surface (m)'),
    roofPitch: num(35, 15, 65, 'pitch of the main roof it stands on (degrees)'),
    pitch: num(30, 5, 60, 'pitch of the dormer roof (degrees)'),
    bars: choice(['none', 'cross', 'grid'], 'cross', 'glazing bars'),
    wall: color('#ece8e1', 'wall colour'),
    trim: color('#ece9e3', 'trim and frame colour'),
    roof: choice(['roof-tile', 'slate', 'metal-roof', 'thatch'], 'roof-tile', 'dormer roof covering'),
  },
  // Stands on a roof, not on a floor: the foot of its front wall is on the slope, so flashing runs below the origin.
  mount: 'surface',
  againstWall: false,
  frontClearance: 0,
  size: (p) => {
    const d = DormerParams.parse({ style: p.str('style'), width: p.num('width'), wallHeight: p.num('wallHeight'), roofPitch: p.num('roofPitch'), pitch: p.num('pitch') });
    const s = dormerShape(d);
    return [d.width + 0.4, s.top, s.depth + 0.2];
  },
  build(p) {
    const d = DormerParams.parse({
      style: p.str('style'),
      width: p.num('width'),
      wallHeight: p.num('wallHeight'),
      roofPitch: p.num('roofPitch'),
      pitch: p.num('pitch'),
      bars: p.str('bars'),
      finish: tint('plaster', p.color('wall')),
      trim: tint('paint', p.color('trim')),
      frame: tint('paint', p.color('trim')),
      roof: mat(p.str('roof')),
    });
    return shifted(buildDormer(d), 0, 0, dormerShape(d).depth / 2);
  },
};

export const TURRET_ROOF: FurnitureDef = {
  id: 'furn-turret-roof',
  kind: 'turret-roof',
  aliases: ['turret roof', 'conical roof', 'cone roof', 'witch hat roof', 'witches hat roof', 'tower roof', 'round tower roof', 'spire', 'turret', 'tower cap', 'castle turret', 'onion dome', 'dome roof'],
  description:
    'Round (or polygonal) turret roof: a cone, a flared bell (witch\'s hat), a dome or an ogee cap with an overhanging eave, a fascia, a finial and, with `wallHeight`, the turret wall below it with narrow window slits. Origin on the axis at the eave line (the top of the wall) so the wall stands below y = 0: place it with y at the wall top; set `wallHeight` to 0 to cap an existing round tower of the same `radius`. `sides` 0 is round, 3 to 16 a pyramid.',
  params: {
    radius: num(1.6, 0.4, 8, 'radius of the wall the roof caps (m)'),
    height: num(2.6, 0.3, 14, 'height of the cap above the eaves (m)'),
    profile: choice(['cone', 'bell', 'dome', 'ogee'], 'cone', 'shape of the cap'),
    sides: int(0, 0, 16, '0 round, 3 to 16 a pyramid of that many sides'),
    wallHeight: num(0, 0, 12, 'turret wall below the eaves (m, 0 for the roof alone)'),
    slits: int(0, 0, 8, 'window slits round the wall'),
    roof: choice(['roof-tile', 'slate', 'metal-roof', 'thatch'], 'slate', 'roof covering'),
    wall: color('#e4dccd', 'wall colour'),
    finial: flag(true, 'a finial on the tip'),
  },
  // Caps a turret: the eave line is the origin and the fascia hangs below it.
  mount: 'surface',
  againstWall: false,
  frontClearance: 0,
  size: (p) => [(p.num('radius') + 0.3) * 2, p.num('height') + p.num('wallHeight'), (p.num('radius') + 0.3) * 2],
  build(p) {
    return buildTurretRoof(
      TurretRoofParams.parse({
        radius: p.num('radius'),
        height: p.num('height'),
        profile: p.str('profile'),
        sides: p.int('sides'),
        wallHeight: p.num('wallHeight'),
        slits: p.int('slits'),
        finish: mat(p.str('roof')),
        wall: tint('plaster', p.color('wall')),
        finial: p.bool('finial') ? 0.35 : 0,
      }),
    );
  },
};

export const STRUCTURE_PIECES: readonly FurnitureDef[] = [SPIRAL_STAIR, DORMER, TURRET_ROOF];
