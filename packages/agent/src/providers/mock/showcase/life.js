/**
 * Ambient life for the bundled outdoor worlds: the same measured placement the level tool `place_level_items`
 * (role "life") uses, driven by a terrain sampler instead of physics rays. Each group names species, count, area;
 * the planner places every animal where it fits and the report says how many made it.
 */
import { planLife } from '@aether/core';
/**
 * Place the groups into the builder. Returns how many animals each group got, by group id; groups that place nothing
 * are reported so a world's own test can fail loudly.
 */
export function addLife(b, ground, groups) {
    const out = {};
    for (const g of groups) {
        const floor = ground.floor?.(g.x, g.z);
        const plan = planLife({ id: b.id(g.id), species: g.species, count: g.count, x: g.x, z: g.z, radius: g.radius, yaw: 0, collide: false, ...(g.perch ? { perch: true } : {}), ...(floor !== undefined ? { floor } : {}) }, {
            surface: (x, z) => {
                const y = ground.height(x, z);
                if (y === null)
                    return null;
                const dx = ((ground.height(x + 1.2, z) ?? y) - (ground.height(x - 1.2, z) ?? y)) / 2.4;
                const dz = ((ground.height(x, z + 1.2) ?? y) - (ground.height(x, z - 1.2) ?? y)) / 2.4;
                return { y, slopeDeg: (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI, id: null };
            },
            clear: () => true,
            water: ground.water ?? [],
        });
        for (const m of plan.placed)
            b.add(m.entity);
        out[g.id] = plan.placed.length;
    }
    return out;
}
