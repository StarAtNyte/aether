/**
 * Project a world point to viewport fractions with the camera matrices.
 * Returns false (and leaves `out` alone) when the point is behind the camera
 * or outside the view by more than a small margin.
 */
export function projectToViewport(m, x, y, z, out) {
    const v = m.view;
    const p = m.projection;
    const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
    const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
    const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
    const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
    const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
    const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
    if (!(cw > 0.05))
        return false;
    const nx = cx / cw;
    const ny = cy / cw;
    if (Math.abs(nx) > 1.15 || Math.abs(ny) > 1.15)
        return false;
    out.x = nx * 0.5 + 0.5;
    out.y = 0.5 - ny * 0.5;
    return true;
}
const scratch = { x: 0, y: 0 };
/** Longest bubble text kept in a frame. */
const MAX_BUBBLE_TEXT = 140;
/**
 * Sample the NPC system. Returns null when there is nothing to show (no
 * conversation, no prompt, no bubbles).
 */
export function buildNpcFrame(npcs, matrices) {
    const d = npcs.dialogue;
    const prompt = npcs.prompt;
    const count = npcs.bubbleCount;
    if (!d && !prompt && count === 0)
        return null;
    const bubbles = [];
    if (matrices) {
        for (let i = 0; i < count; i++) {
            const b = npcs.bubbleAt(i);
            if (!b || !projectToViewport(matrices, b.x, b.y, b.z, scratch))
                continue;
            bubbles.push({ id: b.npc, name: b.name, text: b.text.slice(0, MAX_BUBBLE_TEXT), x: scratch.x, y: scratch.y });
        }
    }
    return {
        dialogue: d ? { npc: d.npc, speaker: d.speaker, text: d.text, choices: d.choices.slice(0, 6), mode: d.mode, version: d.version, chat: d.chat, free: d.free } : null,
        prompt: prompt ? { npc: prompt.npc, name: prompt.name } : null,
        bubbles,
    };
}
/** Cheap structural signature of a frame (bubble positions rounded to 0.5% of the viewport). */
export function frameSignature(f) {
    if (!f)
        return '';
    const d = f.dialogue;
    let s = d ? `d${d.npc}:${d.version}` : '';
    if (f.prompt)
        s += `|p${f.prompt.npc}`;
    for (const b of f.bubbles)
        s += `|b${b.id}:${b.text.length}:${Math.round(b.x * 200)}:${Math.round(b.y * 200)}`;
    return s;
}
