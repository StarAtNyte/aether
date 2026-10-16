/**
 * Viewport tools that take over left-button drags: box selection, sculpt,
 * vertex paint and scatter paint. Each stroke previews live in the renderer
 * (no document change, coalesced to one preview per animation frame) and
 * commits ONE undoable edit when the pointer is released.
 */
import { decodeMeshCached, encodeMeshUpdate, getEntity, hasOwn, srgbToLinear, uniqueId, worldTransform } from '@aether/core';
import { SculptSession } from '@aether/procgen';
import { label } from './host';
import { dabCandidates, erasePoints, MAX_PAINTED_POINTS, PointGrid, SCATTER_ITEMS, scatterEntity, spacingFor } from '../../editor/model/scatterPaint';
/** Marquee (box) selection: drag a rectangle; Shift / Ctrl adds to the selection. */
export class BoxSelectTool {
    host;
    start = null;
    last = null;
    constructor(host) {
        this.host = host;
    }
    down(p) {
        this.start = p;
        this.last = p;
        return true;
    }
    move(p) {
        if (!this.start)
            return;
        this.last = p;
        this.host.simulation?.showMarquee({ x0: this.start.x, y0: this.start.y, x1: p.x, y1: p.y });
    }
    up(p) {
        const s = this.start;
        this.start = null;
        this.host.simulation?.showMarquee(null);
        const sim = this.host.simulation;
        if (!s || !sim)
            return;
        const st = this.host.store.getState();
        const additive = s.shift || s.ctrl || p.shift || p.ctrl;
        if (Math.hypot(p.x - s.x, p.y - s.y) < 4) {
            // A click with the box tool behaves like a normal click.
            const world = this.host.history.current;
            const id = sim.renderer.pick(p.ndcX, p.ndcY, (x) => world.entities[x]?.locked === true);
            if (!id) {
                if (!additive)
                    st.select([]);
            }
            else
                st.select(additive ? (st.selection.includes(id) ? st.selection.filter((x) => x !== id) : [...st.selection, id]) : [id]);
            return;
        }
        const world = this.host.history.current;
        const ids = sim.renderer.entitiesInRect(s.ndcX, s.ndcY, p.ndcX, p.ndcY, (id) => {
            const e = world.entities[id];
            return !e || e.locked === true || e.template || isBackdrop(world, id);
        });
        st.select(additive ? [...new Set([...st.selection, ...ids])] : ids);
    }
    cancel() {
        this.start = null;
        this.host.simulation?.showMarquee(null);
    }
}
/** Huge scenery (terrain, ground planes) is not box-selected: it would swallow every marquee. */
function isBackdrop(world, id) {
    const e = world.entities[id];
    if (!e)
        return true;
    if (e.tags.includes('terrain') || e.tags.includes('backdrop') || e.tags.includes('ground'))
        return true;
    return e.shape.kind === 'procedural' && (e.shape.generator === 'terrain' || e.shape.generator === 'island' || e.shape.generator === 'mountain');
}
/** Average absolute scale of an entity in the world (brush radius → local units). */
function worldScale(world, id) {
    try {
        const s = worldTransform(world, id).scale;
        return (Math.abs(s[0]) + Math.abs(s[1]) + Math.abs(s[2])) / 3 || 1;
    }
    catch {
        return 1;
    }
}
/** Hex colour (#rrggbb) → linear rgb. */
export function hexToLinear(hex) {
    const v = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#ffffff';
    return [srgbToLinear(parseInt(v.slice(1, 3), 16) / 255), srgbToLinear(parseInt(v.slice(3, 5), 16) / 255), srgbToLinear(parseInt(v.slice(5, 7), 16) / 255)];
}
/**
 * Sculpt / vertex-paint stroke on an editable mesh. Procedural objects are
 * converted to a mesh first (one extra undo step, announced).
 */
export class MeshBrushTool {
    host;
    kind;
    ensureMesh;
    session = null;
    target = null;
    pending = null;
    raf = 0;
    lastPoint = null;
    scale = 1;
    dabs = 0;
    hoverFrame = 0;
    hoverPointer = null;
    constructor(host, kind, 
    /** Convert a non-mesh entity to an editable mesh; resolves true when the mesh is mounted. */
    ensureMesh) {
        this.host = host;
        this.kind = kind;
        this.ensureMesh = ensureMesh;
    }
    skip(id) {
        const e = this.host.history.current.entities[id];
        return !e || e.locked === true || e.template || e.shape.kind === 'scatter' || e.shape.kind === 'none' || e.shape.kind === 'model';
    }
    down(p) {
        const sim = this.host.simulation;
        if (!sim)
            return false;
        const world = this.host.history.current;
        const hit = sim.renderer.raycastEntity(p.ndcX, p.ndcY, { exclude: new Set(Object.keys(world.entities).filter((id) => this.skip(id))) });
        if (!hit)
            return false;
        this.target = hit.id;
        this.dabs = 0;
        this.lastPoint = null;
        const e = getEntity(world, hit.id);
        if (e?.shape.kind !== 'mesh') {
            const id = hit.id;
            void this.ensureMesh(id).then((ok) => {
                if (!ok || this.target !== id) {
                    this.target = null;
                    return;
                }
                this.begin(id);
                this.dab(p);
            });
            return true;
        }
        this.begin(hit.id);
        this.dab(p);
        return true;
    }
    begin(id) {
        const world = this.host.history.current;
        const e = getEntity(world, id);
        if (!e || e.shape.kind !== 'mesh' || !hasOwn(world.meshes, e.shape.mesh))
            return;
        this.session = new SculptSession(decodeMeshCached(world.meshes[e.shape.mesh]), { seed: world.seed });
        this.scale = worldScale(world, id);
    }
    move(p) {
        if (!this.target)
            return;
        this.pending = { p };
        this.schedule();
        this.hover(p);
    }
    schedule() {
        if (this.raf !== 0)
            return;
        this.raf = requestAnimationFrame(() => {
            this.raf = 0;
            const pending = this.pending;
            this.pending = null;
            if (pending)
                this.dab(pending.p);
        });
    }
    dab(p) {
        const sim = this.host.simulation;
        const session = this.session;
        const id = this.target;
        if (!sim || !session || !id)
            return;
        const hit = sim.renderer.raycastEntity(p.ndcX, p.ndcY, { only: id });
        if (!hit)
            return;
        const brush = this.host.store.getState().brush;
        const radius = brush.size / this.scale;
        // Interpolate dabs along fast strokes so the stroke stays continuous.
        const from = this.lastPoint;
        const to = hit.localPoint;
        const steps = from ? Math.min(16, Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) / (radius * 0.3)))) : 1;
        const dab = { center: to, normal: hit.localNormal, radius, strength: brush.strength, falloff: brush.falloff, pressure: p.pressure };
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const c = from ? [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t] : to;
            const d = { ...dab, center: c };
            if (this.kind === 'sculpt')
                session.sculpt(p.alt && brush.sculpt === 'raise' ? 'lower' : brush.sculpt, d);
            else
                session.paint(hexToLinear(brush.color), d, brush.erase || p.alt);
            this.dabs++;
        }
        this.lastPoint = to;
        if (session.takeDirty())
            sim.renderer.previewMesh(id, this.kind === 'sculpt' ? session.data.positions : null, this.kind === 'paint' ? session.data.colors : null);
    }
    up() {
        if (this.raf !== 0)
            cancelAnimationFrame(this.raf);
        this.raf = 0;
        if (this.pending)
            this.dab(this.pending.p);
        this.pending = null;
        this.commit();
    }
    commit() {
        const session = this.session;
        const id = this.target;
        this.session = null;
        this.target = null;
        this.lastPoint = null;
        if (!session || !id || !session.changed)
            return;
        const world = this.host.history.current;
        const e = getEntity(world, id);
        if (!e || e.shape.kind !== 'mesh' || !hasOwn(world.meshes, e.shape.mesh))
            return;
        const asset = world.meshes[e.shape.mesh];
        let next = encodeMeshUpdate(asset, decodeMeshCached(asset), session.data);
        if (this.kind === 'paint') {
            // Painted colours must show on every material slot.
            next = { ...next, materials: next.materials.map((m) => (m.vertexColors === false ? { ...m, vertexColors: true } : m)) };
        }
        const brush = this.host.store.getState().brush;
        const what = this.kind === 'sculpt' ? `Sculpt (${brush.sculpt})` : brush.erase ? 'Erase paint on' : 'Paint';
        const err = this.host.commitUser([{ op: 'setMesh', mesh: next }], `${what} ${label(this.host, id)}`);
        // A rejected stroke (e.g. limits) must not leave the preview on screen.
        if (err)
            this.host.simulation?.renderer.rebuildEntity(id);
    }
    hover(p) {
        this.hoverPointer = p;
        if (this.hoverFrame !== 0)
            return;
        this.hoverFrame = requestAnimationFrame(() => {
            this.hoverFrame = 0;
            this.drawRing(this.hoverPointer);
        });
    }
    drawRing(p) {
        const sim = this.host.simulation;
        if (!sim)
            return;
        if (!p) {
            sim.renderer.showBrush(null);
            return;
        }
        const world = this.host.history.current;
        const hit = this.target
            ? sim.renderer.raycastEntity(p.ndcX, p.ndcY, { only: this.target })
            : sim.renderer.raycastEntity(p.ndcX, p.ndcY, { exclude: new Set(Object.keys(world.entities).filter((id) => this.skip(id))) });
        const brush = this.host.store.getState().brush;
        sim.renderer.showBrush(hit ? { point: hit.point, normal: hit.normal, radius: brush.size, erase: brush.erase || p.alt } : null);
    }
    cancel() {
        if (this.raf !== 0)
            cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.pending = null;
        const had = this.session?.changed === true;
        const id = this.target;
        this.session = null;
        this.target = null;
        if (had && id)
            this.host.simulation?.renderer.rebuildEntity(id);
    }
    /** Release animation frames and hide the ring. */
    dispose() {
        this.cancel();
        if (this.hoverFrame !== 0)
            cancelAnimationFrame(this.hoverFrame);
        this.hoverFrame = 0;
        this.host.simulation?.renderer.showBrush(null);
    }
}
/**
 * Scatter paint: places instances of a generator on whatever surface is
 * under the brush (density + spacing), or erases them with Alt / erase mode.
 * Paints into the selected painted scatter of the same generator, else
 * creates a new one. Live preview through a runtime override; one commit.
 */
export class ScatterBrushTool {
    host;
    target = null;
    isNew = false;
    points = [];
    grid = null;
    dabSeed = 1;
    origin = [0, 0, 0];
    /** The scatter shape being painted (points / count are replaced per dab). */
    shapeBase = {};
    changed = false;
    hoverFrame = 0;
    hoverPointer = null;
    raf = 0;
    pending = null;
    surface = null;
    constructor(host) {
        this.host = host;
    }
    scatterIds(world) {
        return new Set(Object.values(world.entities).filter((e) => e.shape.kind === 'scatter' || e.locked === true || e.template).map((e) => e.id));
    }
    down(p) {
        const sim = this.host.simulation;
        if (!sim)
            return false;
        const world = this.host.history.current;
        const hit = sim.renderer.raycastEntity(p.ndcX, p.ndcY, { exclude: this.scatterIds(world) });
        if (!hit)
            return false;
        const brush = this.host.store.getState().brush;
        const st = this.host.store.getState();
        // Continue the selected painted scatter of the same generator, if any.
        const sel = st.selection.length === 1 ? getEntity(world, st.selection[0]) : undefined;
        const reuse = sel && sel.shape.kind === 'scatter' && sel.shape.points && sel.shape.of.kind === 'procedural' && sel.shape.of.generator === brush.scatterItem && !sel.locked;
        this.changed = false;
        this.dabSeed = (world.seed * 7919 + Date.now()) >>> 0;
        if (reuse && sel.shape.kind === 'scatter') {
            this.target = sel.id;
            this.isNew = false;
            this.points = (sel.shape.points ?? []).map((q) => [q[0], q[1], q[2]]);
            try {
                this.origin = worldTransform(world, sel.id).position;
            }
            catch {
                this.origin = [0, 0, 0];
            }
            this.surface = sel.shape.onSurface ?? null;
            this.shapeBase = { ...sel.shape };
        }
        else {
            if (brush.erase || p.alt)
                return false;
            const item = SCATTER_ITEMS.find((i) => i.id === brush.scatterItem) ?? SCATTER_ITEMS[0];
            if (!item)
                return false;
            const id = uniqueId(world, `${item.id}-painted`);
            this.target = id;
            this.isNew = true;
            this.points = [];
            this.origin = [0, 0, 0];
            this.surface = hit.id;
            const entity = scatterEntity(id, item.id, item.label, hit.id);
            this.shapeBase = { ...entity.shape };
            sim.renderer.addTransient(entity);
        }
        this.grid = new PointGrid(Math.max(0.05, spacingFor(brush.density)));
        for (const q of this.points)
            this.grid.add(q[0], q[2]);
        this.dab(p);
        return true;
    }
    move(p) {
        if (!this.target)
            return;
        this.pending = p;
        if (this.raf === 0) {
            this.raf = requestAnimationFrame(() => {
                this.raf = 0;
                const q = this.pending;
                this.pending = null;
                if (q)
                    this.dab(q);
            });
        }
        this.hover(p);
    }
    dab(p) {
        const sim = this.host.simulation;
        const id = this.target;
        if (!sim || !id || !this.grid)
            return;
        const world = this.host.history.current;
        const hit = sim.renderer.raycastEntity(p.ndcX, p.ndcY, { exclude: this.scatterIds(world) });
        if (!hit)
            return;
        const brush = this.host.store.getState().brush;
        const lx = hit.point[0] - this.origin[0];
        const lz = hit.point[2] - this.origin[2];
        if (brush.erase || p.alt) {
            const r = erasePoints(this.points, lx, lz, brush.size);
            if (r.removed === 0)
                return;
            this.points = r.points;
            this.grid = new PointGrid(Math.max(0.05, spacingFor(brush.density)));
            for (const q of this.points)
                this.grid.add(q[0], q[2]);
        }
        else {
            const spacing = spacingFor(brush.density);
            const exclude = this.scatterIds(world);
            let added = 0;
            let tried = 0;
            for (const [x, z] of dabCandidates(hit.point[0], hit.point[2], brush.size, brush.density * Math.max(0.2, p.pressure), this.dabSeed++)) {
                if (this.points.length >= MAX_PAINTED_POINTS || tried >= MAX_RAYS_PER_DAB)
                    break;
                const cx = x - this.origin[0];
                const cz = z - this.origin[2];
                if (this.grid.near(cx, cz, spacing))
                    continue;
                tried++;
                // Only the surface under the brush centre is tested: one mesh, bounded cost per frame.
                const down = sim.renderer.raycastWorld([x, hit.point[1] + brush.size * 4 + 50, z], [0, -1, 0], 1e4, exclude, hit.id);
                if (!down)
                    continue;
                // Skip steep spots (cliff faces): instances look wrong there.
                if (down.normal[1] < 0.35)
                    continue;
                this.points.push([round3(cx), round3(down.point[1] - this.origin[1]), round3(cz)]);
                this.grid.add(cx, cz);
                added++;
            }
            if (added === 0)
                return;
        }
        this.changed = true;
        sim.renderer.setEntityProperty(id, 'shape', { ...this.shapeBase, points: this.points, count: Math.max(1, this.points.length) });
    }
    up() {
        if (this.raf !== 0)
            cancelAnimationFrame(this.raf);
        this.raf = 0;
        if (this.pending)
            this.dab(this.pending);
        this.pending = null;
        this.commit();
    }
    commit() {
        const sim = this.host.simulation;
        const id = this.target;
        const isNew = this.isNew;
        this.target = null;
        if (!sim || !id)
            return;
        if (isNew)
            sim.renderer.removeTransient(id);
        if (!this.changed)
            return;
        const brush = this.host.store.getState().brush;
        const item = SCATTER_ITEMS.find((i) => i.id === brush.scatterItem);
        const world = this.host.history.current;
        let patches;
        if (isNew) {
            if (this.points.length === 0)
                return;
            const entity = scatterEntity(id, brush.scatterItem, item?.label ?? 'Scatter', this.surface && hasOwn(world.entities, this.surface) ? this.surface : undefined);
            patches = [{ op: 'add', entity: { ...entity, shape: { ...entity.shape, points: this.points, count: this.points.length } } }];
        }
        else {
            patches = [{ op: 'update', id, set: { shape: { points: this.points, count: Math.max(1, this.points.length) } } }];
        }
        const msg = brush.erase ? `Erase ${item?.label.toLowerCase() ?? 'instances'}` : `Paint ${item?.label.toLowerCase() ?? 'instances'}`;
        const err = this.host.commitUser(patches, msg);
        if (err)
            sim.renderer.clearRuntimeOverrides();
        else if (isNew)
            this.host.store.getState().select([id]);
    }
    hover(p) {
        this.hoverPointer = p;
        if (this.hoverFrame !== 0)
            return;
        this.hoverFrame = requestAnimationFrame(() => {
            this.hoverFrame = 0;
            const sim = this.host.simulation;
            const q = this.hoverPointer;
            if (!sim)
                return;
            if (!q) {
                sim.renderer.showBrush(null);
                return;
            }
            const hit = sim.renderer.raycastEntity(q.ndcX, q.ndcY, { exclude: this.scatterIds(this.host.history.current) });
            const brush = this.host.store.getState().brush;
            sim.renderer.showBrush(hit ? { point: hit.point, normal: [0, 1, 0], radius: brush.size, erase: brush.erase || q.alt } : null);
        });
    }
    cancel() {
        if (this.raf !== 0)
            cancelAnimationFrame(this.raf);
        this.raf = 0;
        const sim = this.host.simulation;
        if (sim && this.target) {
            if (this.isNew)
                sim.renderer.removeTransient(this.target);
            else
                sim.renderer.clearRuntimeOverrides();
        }
        this.target = null;
    }
    /** Release animation frames and hide the ring. */
    dispose() {
        this.cancel();
        if (this.hoverFrame !== 0)
            cancelAnimationFrame(this.hoverFrame);
        this.hoverFrame = 0;
        this.host.simulation?.renderer.showBrush(null);
    }
}
/** Downward rays cast per dab (bounds the cost of a dab on dense meshes). */
const MAX_RAYS_PER_DAB = 48;
function round3(v) {
    return Math.round(v * 1000) / 1000;
}
