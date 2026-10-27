/**
 * IFC4 export of the buildings in a World IR document.
 *
 * Reads the compiled entities back (the same way the 2D floor plan does, so
 * manual edits show up): storeys, mitred walls with IfcOpeningElement voids
 * filled by IfcDoor / IfcWindow, floor slabs, ceilings, room spaces, roofs,
 * stairs, railings, columns and furniture boxes. Walls, slabs and spaces are
 * swept solids (so BIM tools can edit them); stairs, roofs and railings are
 * tessellated from the same geometry the renderer shows.
 *
 * The STEP writer and the entity builders under this folder are adapted from
 * Pascal Editor (MIT, see their headers and docs/THIRD_PARTY.md); the mapping
 * from World IR is Aether's own.
 *
 * Axes: the plan frame is x east, z south, y up. IFC is x east, y north, z up,
 * so a point (x, y, z) becomes (x, -z, y), a proper rotation that keeps the
 * winding of triangles and the sign of yaw (positive yaw turns +X toward -Z,
 * which is counter-clockwise seen from above in IFC).
 */
import type { Entity, EntityId, WorldDoc } from '@aether/core';
import { furnitureOfEntity } from '../furniture/assets';
import { listBuildings, listLevels } from '../plan2d';
import { SlabParams, StairParams, WallParams } from '../params';
import { buildStructure, isStructureId } from '../structure';
import { DERIVED, enumValue, int, type StepRef, type StepValue } from './step';
import { bool, identifier, IfcModel, label, type IfcColor, type PlanFrame, type TriangleSet, type Vec2, type Vec3 } from './ifc-model';

export interface IfcExportOptions {
  /** Export only this building (default: every building in the world). */
  building?: EntityId;
  projectName?: string;
  author?: string;
  organization?: string;
  /** Fixed timestamp (tests, reproducible files). Default: now. */
  timestamp?: Date;
}

export interface IfcExportResult {
  ifc: string;
  /** Count of exported IFC elements by IFC class. */
  elements: Record<string, number>;
  /** Entities that were left out, with the reason. */
  skipped: Array<{ id: EntityId; reason: string }>;
}

const DEG = Math.PI / 180;
const round = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Entity pose (parent frame) as an IFC plan frame. */
function frameOf(e: Entity): PlanFrame {
  const p = e.transform.position;
  return { origin: [p[0], -p[2], p[1]], angle: (e.transform.rotation[1] ?? 0) * DEG };
}

function hexColor(c: string | undefined): [number, number, number] | null {
  if (!c) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) return null;
  const n = parseInt(m[1] as string, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function params(e: Entity): Record<string, unknown> | null {
  return e.shape.kind === 'procedural' ? (e.shape.params as Record<string, unknown>) : null;
}

const flip = (p: readonly [number, number]): Vec2 => [p[0], -p[1]];

/** Build the IFC4 STEP text for the buildings of `world`. */
export function exportWorldToIfc(world: WorldDoc, opts: IfcExportOptions = {}): IfcExportResult {
  const model = new IfcModel();
  const step = model.step;
  const counts: Record<string, number> = {};
  const skipped: IfcExportResult['skipped'] = [];
  const timestamp = opts.timestamp ?? new Date();
  const projectName = opts.projectName ?? 'Aether project';
  const author = opts.author ?? '';
  const organization = opts.organization ?? '';

  const person = step.add('IFCPERSON', null, author || 'Unknown', null, null, null, null, null, null);
  const org = step.add('IFCORGANIZATION', null, organization || 'Unknown', null, null, null);
  const personOrg = step.add('IFCPERSONANDORGANIZATION', person, org, null);
  const application = step.add('IFCAPPLICATION', org, '1.0', 'Aether', 'Aether');
  model.ownerHistory = step.add('IFCOWNERHISTORY', personOrg, application, null, enumValue('NOCHANGE'), null, null, null, int(Math.floor(timestamp.getTime() / 1000)));
  const ownerHistory = model.ownerHistory;
  const units = step.add('IFCUNITASSIGNMENT', [
    step.add('IFCSIUNIT', DERIVED, enumValue('LENGTHUNIT'), null, enumValue('METRE')),
    step.add('IFCSIUNIT', DERIVED, enumValue('AREAUNIT'), null, enumValue('SQUARE_METRE')),
    step.add('IFCSIUNIT', DERIVED, enumValue('VOLUMEUNIT'), null, enumValue('CUBIC_METRE')),
    step.add('IFCSIUNIT', DERIVED, enumValue('PLANEANGLEUNIT'), null, enumValue('RADIAN')),
  ]);
  const modelContext = step.add('IFCGEOMETRICREPRESENTATIONCONTEXT', null, 'Model', int(3), 1e-5, model.axis2Placement3D({ origin: [0, 0, 0], angle: 0 }), model.direction([0, 1]));
  const sub = (id: string, view: string): StepRef => step.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', id, 'Model', DERIVED, DERIVED, DERIVED, DERIVED, modelContext, null, enumValue(view), null);
  model.bodyContext = sub('Body', 'MODEL_VIEW');
  model.axisContext = sub('Axis', 'GRAPH_VIEW');
  const project = step.add('IFCPROJECT', model.guid('project'), ownerHistory, projectName, null, null, null, null, [modelContext], units);

  const sitePlacement = model.localPlacement(null, { origin: [0, 0, 0], angle: 0 });
  const site = step.add('IFCSITE', model.guid('site'), ownerHistory, 'Site', null, null, sitePlacement, null, null, enumValue('ELEMENT'), null, null, null, null, null);
  model.rel('IFCRELAGGREGATES', 'project-site', project, [site]);

  const bump = (cls: string): void => {
    counts[cls] = (counts[cls] ?? 0) + 1;
  };
  const named = (e: Entity, fallback: string): string => e.arch?.name ?? e.name ?? fallback;

  /** Product entity with the common leading attributes. */
  const product = (cls: string, e: Entity, name: string, placement: StepRef, shape: StepRef | null, tail: StepValue[]): StepRef => {
    bump(cls);
    const ref = step.add(cls, model.guid(`${e.id}:${cls}`), ownerHistory, name, null, null, placement, shape, null, ...tail);
    model.propertySet(e.id, 'Aether', [['EntityId', identifier(e.id)], ['Role', label(e.arch?.role ?? '')], ['Kind', label(e.arch?.kind ?? '')]], [ref]);
    return ref;
  };

  const meshSets = (e: Entity): TriangleSet[] => {
    const p = params(e);
    if (!p || e.shape.kind !== 'procedural' || !isStructureId(e.shape.generator)) return [];
    let out;
    try {
      out = buildStructure(e.shape.generator, e.shape.params);
    } catch {
      return [];
    }
    return out.parts.map((part) => {
      const src = part.positions;
      const pos = new Float32Array(src.length);
      for (let i = 0; i + 2 < src.length; i += 3) {
        pos[i] = src[i] as number;
        pos[i + 1] = -(src[i + 2] as number);
        pos[i + 2] = src[i + 1] as number;
      }
      const rgb = hexColor(part.material.color);
      const color: IfcColor | undefined = rgb ? { rgb, opacity: part.material.opacity ?? 1 } : undefined;
      return { positions: pos, indices: part.indices, ...(color ? { color } : {}) };
    });
  };

  const tessellated = (e: Entity): StepRef | null => {
    const items = meshSets(e).map((s) => model.triangulatedFaceSet(s)).filter((r): r is StepRef => r !== null);
    return items.length ? model.shape([model.bodyRepresentation('Tessellation', items)]) : null;
  };

  const sweptPolygon = (outer: Vec2[], holes: Vec2[][], bottom: number, depth: number, color?: IfcColor): StepRef | null => {
    const ring = outer;
    if (ring.length < 3 || depth <= 0) return null;
    const prof = model.polygonProfile(ring, holes);
    return model.shape([model.bodyRepresentation('SweptSolid', [model.extrusion(prof, bottom, depth, color)])]);
  };

  const sweptBox = (w: number, d: number, h: number, bottom = 0, color?: IfcColor): StepRef =>
    model.shape([model.bodyRepresentation('SweptSolid', [model.extrusion(model.rectangleProfile(w, d), bottom, h, color)])]);

  const buildings = listBuildings(world).filter((b) => !opts.building || b.id === opts.building);
  const buildingRefs: StepRef[] = [];
  const wallRefs = new Map<EntityId, { ref: StepRef; frame: PlanFrame; placement: StepRef; openings: Array<{ ref: StepRef; centre: Vec2; width: number; used: boolean; kind: string }> }>();

  for (const b of buildings) {
    const be = world.entities[b.id] as Entity;
    const bPlacement = model.localPlacement(sitePlacement, frameOf(be));
    const bRef = step.add('IFCBUILDING', model.guid(`${b.id}:building`), ownerHistory, b.name, null, null, bPlacement, null, null, enumValue('ELEMENT'), null, null, null);
    bump('IFCBUILDING');
    buildingRefs.push(bRef);
    const storeys: StepRef[] = [];
    const buildingContained: StepRef[] = [];

    // Elements attached straight to the building (terrace, pool, downpipes).
    const direct = Object.values(world.entities).filter((e) => e.parent === b.id && e.arch?.role !== 'level');

    const levels = listLevels(world, b.id);
    const emitChildren = (children: Entity[], placement: StepRef, contained: StepRef[], levelHeight: number): void => {
      const walls = children.filter((e) => e.arch?.role === 'wall');
      const rest = children.filter((e) => e.arch?.role !== 'wall');
      for (const e of walls) {
        const wp = WallParams.safeParse(params(e) ?? {});
        if (!wp.success) {
          skipped.push({ id: e.id, reason: 'wall params invalid' });
          continue;
        }
        const w = wp.data;
        const frame = frameOf(e);
        const t = w.thickness / 2;
        // Plan frame side A is -Z (IFC +Y), side B is +Z (IFC -Y).
        const outline: Vec2[] = [[-w.startB, -t], [w.length + w.endB, -t], [w.length + w.endA, t], [-w.startA, t]];
        const wallPlacement = model.localPlacement(placement, frame);
        const wallRef = product('IFCWALL', e, named(e, 'Wall'), wallPlacement, sweptPolygon(outline, [], 0, w.height), [enumValue(e.arch?.kind === 'exterior' ? 'STANDARD' : 'PARTITIONING')]);
        contained.push(wallRef);
        model.propertySet(e.id, 'Pset_WallCommon', [['IsExternal', bool(e.arch?.kind === 'exterior')]], [wallRef]);
        const openings: Array<{ ref: StepRef; centre: Vec2; width: number; used: boolean; kind: string }> = [];
        w.openings.forEach((o, k) => {
          const oFrame: PlanFrame = { origin: [o.offset, 0, o.sill], angle: 0 };
          const oPlacement = model.localPlacement(wallPlacement, oFrame);
          const profile = model.rectangleProfile(o.width, w.thickness + 0.04);
          bump('IFCOPENINGELEMENT');
          const oRef = step.add('IFCOPENINGELEMENT', model.guid(`${e.id}:opening:${k}`), ownerHistory, `${o.kind} opening`, null, null, oPlacement, model.shape([model.bodyRepresentation('SweptSolid', [model.extrusion(profile, 0, o.height)])]), null, enumValue('OPENING'));
          model.rel('IFCRELVOIDSELEMENT', `${e.id}:voids:${k}`, wallRef, oRef);
          // World-ish plan position of the opening centre for matching door/window entities.
          const c = [frame.origin[0] + Math.cos(frame.angle) * o.offset, frame.origin[1] + Math.sin(frame.angle) * o.offset] as Vec2;
          openings.push({ ref: oRef, centre: c, width: o.width, used: false, kind: o.kind });
        });
        wallRefs.set(e.id, { ref: wallRef, frame, placement: wallPlacement, openings });
      }
      for (const e of rest) {
        const role = e.arch?.role;
        const gen = e.shape.kind === 'procedural' ? e.shape.generator : '';
        const p = params(e);
        const placement2 = model.localPlacement(placement, frameOf(e));
        if (role === 'room' && gen === 'arch-slab') {
          const sp = SlabParams.safeParse(p ?? {});
          if (!sp.success) {
            skipped.push({ id: e.id, reason: 'slab params invalid' });
            continue;
          }
          const outer = sp.data.polygon.map(flip);
          const holes = sp.data.holes.map((h) => h.map(flip));
          const ground = (e.transform.position[1] ?? 0) === 0 && (world.entities[e.parent ?? '']?.arch?.level ?? 0) === 0;
          contained.push(product('IFCSLAB', e, named(e, 'Floor'), placement2, sweptPolygon(outer, holes, -sp.data.thickness, sp.data.thickness), [enumValue(ground ? 'BASESLAB' : 'FLOOR')]));
          // The room itself as an IfcSpace (aggregated to the storey, not contained).
          const spaceShape = sweptPolygon(outer, holes, 0, Math.max(0.1, levelHeight - 0.25));
          const space = product('IFCSPACE', e, named(e, 'Room'), placement2, spaceShape, [enumValue('ELEMENT'), enumValue('INTERNAL'), null]);
          spaces.push(space);
        } else if (role === 'ceiling' && gen === 'arch-ceiling') {
          const poly = (p?.['polygon'] as Array<[number, number]> | undefined) ?? [];
          const holes = ((p?.['holes'] as Array<Array<[number, number]>> | undefined) ?? []).map((h) => h.map(flip));
          contained.push(product('IFCCOVERING', e, named(e, 'Ceiling'), placement2, sweptPolygon(poly.map(flip), holes, -0.02, 0.02), [enumValue('CEILING')]));
        } else if (role === 'door') {
          const width = typeof p?.['width'] === 'number' ? p['width'] : 0.9;
          const height = typeof p?.['height'] === 'number' ? p['height'] : 2.1;
          const thick = typeof p?.['thickness'] === 'number' ? p['thickness'] : 0.045;
          const door = product('IFCDOOR', e, named(e, 'Door'), placement2, sweptBox(width, thick, height), [null, height, width, null, null]);
          contained.push(door);
          fillOpening(e, door);
        } else if (role === 'window') {
          const width = typeof p?.['width'] === 'number' ? p['width'] : 1.2;
          const height = typeof p?.['height'] === 'number' ? p['height'] : 1.2;
          const wt = typeof p?.['wallThickness'] === 'number' ? p['wallThickness'] : 0.15;
          const win = product('IFCWINDOW', e, named(e, 'Window'), placement2, sweptBox(width, Math.min(0.08, wt), height, 0, { rgb: [0.62, 0.8, 0.9], opacity: 0.4 }), [null, height, width, null, null]);
          contained.push(win);
          fillOpening(e, win);
        } else if (role === 'stair' && gen === 'arch-stair') {
          if (!StairParams.safeParse(p ?? {}).success) {
            skipped.push({ id: e.id, reason: 'stair params invalid' });
            continue;
          }
          contained.push(product('IFCSTAIR', e, named(e, 'Stair'), placement2, tessellated(e), [enumValue('NOTDEFINED')]));
        } else if (role === 'roof' && gen === 'arch-roof') {
          contained.push(product('IFCROOF', e, named(e, 'Roof'), placement2, tessellated(e), [enumValue('NOTDEFINED')]));
        } else if (role === 'roof' && gen === 'arch-slab') {
          const sp = SlabParams.safeParse(p ?? {});
          if (!sp.success) continue;
          contained.push(product('IFCSLAB', e, named(e, 'Roof slab'), placement2, sweptPolygon(sp.data.polygon.map(flip), sp.data.holes.map((h) => h.map(flip)), -sp.data.thickness, sp.data.thickness), [enumValue('ROOF')]));
        } else if (gen === 'arch-railing' || (role === 'railing')) {
          contained.push(product('IFCRAILING', e, named(e, 'Railing'), placement2, tessellated(e), [enumValue('NOTDEFINED')]));
        } else if (gen === 'arch-column') {
          contained.push(product('IFCCOLUMN', e, named(e, 'Column'), placement2, tessellated(e), [enumValue('NOTDEFINED')]));
        } else if (role === 'furniture' || role === 'fixture') {
          const f = furnitureOfEntity(e);
          if (!f) {
            skipped.push({ id: e.id, reason: 'unknown furniture kind' });
            continue;
          }
          const [sx, sy, sz] = f.size;
          contained.push(product('IFCFURNISHINGELEMENT', e, named(e, f.def.kind), placement2, sweptBox(sx, sz, sy, 0), []));
        }
      }
    };

    const spaces: StepRef[] = [];
    const fillOpening = (e: Entity, fill: StepRef): void => {
      const w = wallRefs.get(e.arch?.wall ?? '');
      if (!w) return;
      const at = e.transform.position;
      const pos: Vec2 = [at[0], -at[2]];
      let best: (typeof w.openings)[number] | null = null;
      let bestD = 0.35;
      for (const o of w.openings) {
        if (o.used || o.kind === 'opening') continue;
        const d = Math.hypot(o.centre[0] - pos[0], o.centre[1] - pos[1]);
        if (d < bestD) {
          best = o;
          bestD = d;
        }
      }
      if (!best) return;
      best.used = true;
      model.rel('IFCRELFILLSELEMENT', `${e.id}:fills`, best.ref, fill);
    };

    // Doors and windows reference walls, so walls of every level go first.
    for (const lvl of levels) {
      const le = world.entities[lvl.id] as Entity;
      const lPlacement = model.localPlacement(bPlacement, { origin: [0, 0, le.transform.position[1]], angle: 0 });
      const sRef = step.add('IFCBUILDINGSTOREY', model.guid(`${lvl.id}:storey`), ownerHistory, lvl.name, null, null, lPlacement, null, null, enumValue('ELEMENT'), round(le.transform.position[1]));
      bump('IFCBUILDINGSTOREY');
      storeys.push(sRef);
      const kids = Object.values(world.entities).filter((e) => e.parent === lvl.id);
      const contained: StepRef[] = [];
      spaces.length = 0;
      emitChildren(kids, lPlacement, contained, lvl.height);
      if (contained.length) model.rel('IFCRELCONTAINEDINSPATIALSTRUCTURE', `contains:${lvl.id}`, contained, sRef);
      if (spaces.length) model.rel('IFCRELAGGREGATES', `spaces:${lvl.id}`, sRef, [...spaces]);
    }
    if (direct.length) {
      spaces.length = 0;
      emitChildren(direct, bPlacement, buildingContained, 3);
      if (buildingContained.length) model.rel('IFCRELCONTAINEDINSPATIALSTRUCTURE', `contains:${b.id}`, buildingContained, bRef);
    }
    if (storeys.length) model.rel('IFCRELAGGREGATES', `storeys:${b.id}`, bRef, storeys);
  }
  if (buildingRefs.length) model.rel('IFCRELAGGREGATES', 'site-buildings', site, buildingRefs);

  const ifc = step.serialize({
    description: 'ViewDefinition [DesignTransferView_V1.0]',
    fileName: `${projectName}.ifc`,
    timestamp: timestamp.toISOString().replace(/\.\d{3}Z$/, ''),
    author,
    organization,
    preprocessor: 'Aether IFC writer',
    originatingSystem: 'Aether',
    schema: 'IFC4',
  });
  return { ifc, elements: counts, skipped };
}
