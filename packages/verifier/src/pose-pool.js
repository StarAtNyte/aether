/** Upper bound of pooled records (one per entity id). */
export const MAX_POOLED_POSES = 4096;
/** Pool of per-entity pose records. */
export class PosePool {
    poses = new Map();
    /** The record of `id` (created once; overwritten by the caller). */
    slot(id) {
        const known = this.poses.get(id);
        if (known)
            return known;
        const fresh = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
        if (this.poses.size < MAX_POOLED_POSES)
            this.poses.set(id, fresh);
        return fresh;
    }
    /**
     * Fill the record of `id` from plain arrays (copies; never aliases the inputs).
     * @returns the filled record
     */
    fill(id, position, quaternion) {
        const p = this.slot(id);
        p.position[0] = position[0];
        p.position[1] = position[1];
        p.position[2] = position[2];
        p.quaternion[0] = quaternion[0];
        p.quaternion[1] = quaternion[1];
        p.quaternion[2] = quaternion[2];
        p.quaternion[3] = quaternion[3];
        return p;
    }
    /** Drop the record of a removed entity. */
    release(id) {
        this.poses.delete(id);
    }
    /** Number of pooled records. */
    get size() {
        return this.poses.size;
    }
    /** Forget everything (end of a play session). */
    clear() {
        this.poses.clear();
    }
}
