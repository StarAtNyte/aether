/**
 * Collects the per-entity world bounds that camera framing, fog scaling and
 * shadow fitting care about, from a {@link SceneSync}. Ground, sky, backdrop
 * scenery, terrain generators (mountains, islands, heightfields — even when a
 * world forgets to tag them) and huge entities are left out; decorative
 * layers (scatter patches, wide flat planes such as roads or lakes) get a
 * small weight so they do not drag the camera away from the set-pieces. A
 * world made only of scenery ("a mountain range") frames that scenery.
 */
import { Box3 } from 'three';
/** Entities with any of these tags never drive framing (unless explicitly focused). */
export const FRAMING_EXCLUDED_TAGS = new Set(['backdrop', 'background', 'terrain', 'ground', 'sky', 'skybox']);
/** Tag that marks the entity a world wants the camera on. */
export const FOCUS_TAG = 'focus';
/** Built-in generators that make landscape scenery rather than set-pieces. */
export const SCENERY_GENERATORS = new Set(['mountain', 'terrain', 'island']);
/** Horizontal extent (m) above which an unfocused entity counts as terrain and is ignored. */
export const HUGE_EXTENT = 120;
/** Wide (≥ this many metres) but low entities count as decorative ground cover. */
const FLAT_EXTENT = 25;
const FLAT_HEIGHT = 1.2;
const _box = new Box3();
/**
 * Framing items for every visible, non-template document entity. `focus`
 * marks additional entities as focused (e.g. the ones an edit just changed).
 */
export function collectFramingItems(sync, focus = new Set()) {
    const items = [];
    const scenery = [];
    sync.root.updateMatrixWorld(true);
    // A parametric building frames as one whole (its hundreds of walls and pieces would
    // otherwise pull the camera into the furniture).
    const buildings = new Set();
    sync.forEachNode((node) => {
        if (node.entity.arch?.role === 'building' && node.object.visible && !node.entity.template)
            buildings.add(node.object);
    });
    const inBuilding = (o) => {
        for (let p = o.parent; p; p = p.parent)
            if (buildings.has(p))
                return true;
        return false;
    };
    for (const b of buildings) {
        _box.setFromObject(b);
        if (!_box.isEmpty())
            items.push({ min: _box.min.toArray(), max: _box.max.toArray(), focus: true });
    }
    sync.forEachNode((node) => {
        if (node.transient || node.entity.template || !node.object.visible)
            return;
        if (buildings.size > 0 && (buildings.has(node.object) || inBuilding(node.object)))
            return;
        const focused = focus.has(node.id) || node.entity.tags.includes(FOCUS_TAG);
        const shape = node.entity.shape;
        const isScenery = !focused && (node.entity.tags.some((t) => FRAMING_EXCLUDED_TAGS.has(t)) || (shape.kind === 'procedural' && SCENERY_GENERATORS.has(shape.generator)));
        _box.setFromObject(node.content);
        if (_box.isEmpty())
            return;
        const sx = _box.max.x - _box.min.x;
        const sy = _box.max.y - _box.min.y;
        const sz = _box.max.z - _box.min.z;
        const wide = Math.max(sx, sz);
        const item = { min: _box.min.toArray(), max: _box.max.toArray() };
        if (isScenery || (!focused && wide > HUGE_EXTENT)) {
            scenery.push(item);
            return;
        }
        if (focused)
            item.focus = true;
        else if (node.instances > 0) {
            item.weight = 0.4;
            item.extent = 0.25;
        }
        else if (wide > FLAT_EXTENT && sy < FLAT_HEIGHT) {
            item.weight = 1;
            item.extent = 0.3;
        }
        items.push(item);
    });
    return items.length > 0 ? items : scenery;
}
