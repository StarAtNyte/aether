/**
 * The logic host of a playtest: physics only (no renderer, audio or UI),
 * with the bot's capsule standing in for "the player". It records what the
 * game does (messages, destroyed entities, the win / lose) for the report.
 */
import { worldTransform } from '@aether/core';
import { entityColliderBounds, entityWorldBounds } from '@aether/physics/bounds';
/** Id the logic runtime knows the player by (same as the studio's). */
export const PLAYER_ID = 'player';
/** Capsule of the studio's built-in player. */
export const PLAYER_CAPSULE = Object.freeze({ radius: 0.35, height: 1.7 });
const MAX_MESSAGES = 50;
const MAX_TRACKED_POSES = 5000;
/** LogicHost over a headless physics world and the bot's character. */
export class PlaytestHost {
    pw;
    world;
    character;
    seen = { outcome: null, endText: '', messages: [], destroyed: new Set(), hidden: new Set(), playerTeleports: 0 };
    poses = new Map();
    scratch = new Map();
    playerPose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
    /** Called with the entity id when the game removes an entity (a pickup collected). */
    onDestroy = null;
    /** Called when the game shows a message. */
    onMessage = null;
    /** Called when the game ends. */
    onGameOver = null;
    /** Called when a pickup toggles visibility (respawning collectibles). */
    onVisible = null;
    yawDeg = 0;
    constructor(pw, world, character) {
        this.pw = pw;
        this.world = world;
        this.character = character;
    }
    getTransform(id) {
        if (id === PLAYER_ID) {
            const p = this.character.position;
            const slot = this.playerPose;
            slot.position[0] = p[0];
            slot.position[1] = p[1];
            slot.position[2] = p[2];
            const h = (this.yawDeg * Math.PI) / 360;
            slot.quaternion[1] = Math.sin(h);
            slot.quaternion[3] = Math.cos(h);
            return slot;
        }
        if (this.seen.destroyed.has(id))
            return undefined;
        let slot = this.scratch.get(id);
        if (!slot) {
            slot = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
            if (this.scratch.size < MAX_TRACKED_POSES)
                this.scratch.set(id, slot);
        }
        if (this.pw.readPose(id, slot.position, slot.quaternion))
            return slot;
        const p = this.poses.get(id);
        if (p)
            return p;
        if (!Object.prototype.hasOwnProperty.call(this.world.entities, id))
            return undefined;
        try {
            const t = worldTransform(this.world, id);
            slot.position[0] = t.position[0];
            slot.position[1] = t.position[1];
            slot.position[2] = t.position[2];
            slot.quaternion[0] = t.quaternion[0];
            slot.quaternion[1] = t.quaternion[1];
            slot.quaternion[2] = t.quaternion[2];
            slot.quaternion[3] = t.quaternion[3];
            return slot;
        }
        catch {
            return undefined;
        }
    }
    setKinematic(id, position, quaternion) {
        if (this.pw.has(id))
            this.pw.setKinematicTarget(id, position, quaternion);
        if (this.poses.has(id) || this.poses.size < MAX_TRACKED_POSES)
            this.poses.set(id, { position: [...position], quaternion: [...quaternion] });
    }
    applyImpulse(id, v) {
        this.pw.applyImpulse(id, v);
    }
    setVelocity(id, v) {
        this.pw.setVelocity(id, v);
    }
    getVelocity(id) {
        if (id === PLAYER_ID)
            return [0, this.character.verticalSpeed, 0];
        return this.pw.getVelocity(id);
    }
    setAngularVelocity(id, v) {
        this.pw.setAngularVelocity(id, v);
    }
    driveJoint(id, target) {
        this.pw.driveJoint(id, target);
    }
    teleport(id, p) {
        if (id === PLAYER_ID) {
            this.character.teleport(p);
            this.seen.playerTeleports++;
            return;
        }
        this.pw.teleport(id, p);
        const pose = this.poses.get(id);
        if (pose)
            pose.position = [...p];
    }
    explode(center, force, radius) {
        this.pw.explode(center, force, radius);
    }
    setGravity(v) {
        this.pw.setGravity(v);
    }
    spawn(entity) {
        this.seen.destroyed.delete(entity.id);
        this.pw.addEntity(entity, { trusted: true });
    }
    destroy(id) {
        this.seen.destroyed.add(id);
        this.poses.delete(id);
        this.scratch.delete(id);
        this.pw.removeEntity(id);
        this.onDestroy?.(id);
    }
    setProperty(id, path, value) {
        if (path === 'visible' && typeof value === 'boolean') {
            if (value)
                this.seen.hidden.delete(id);
            else
                this.seen.hidden.add(id);
            this.onVisible?.(id, value);
        }
    }
    message(text, _duration) {
        if (this.seen.messages.length < MAX_MESSAGES)
            this.seen.messages.push(text.slice(0, 200));
        this.onMessage?.(text);
    }
    sound(_name) {
        // Silent.
    }
    gameOver(result, text) {
        if (this.seen.outcome !== null)
            return;
        this.seen.outcome = result;
        this.seen.endText = text.slice(0, 200);
        this.onGameOver?.(result, text);
    }
    reset() {
        // A reset inside a playtest would loop; the run ends instead of restarting.
    }
    playerId() {
        return PLAYER_ID;
    }
    getBounds(id) {
        return entityWorldBounds(this.world, id) ?? undefined;
    }
    getColliderBounds(id) {
        return entityColliderBounds(this.world, id);
    }
    groundHeight(x, z, fromY, exclude) {
        const hit = this.pw.raycast([x, fromY, z], [0, -1, 0], fromY + 8, exclude);
        return hit ? hit.point[1] : undefined;
    }
}
