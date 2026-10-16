import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHOTO_BUILDING_ID, buildChecklist, parseRoomDescription } from '@aether/arch/photo';
import { partKinds, readScene } from '@aether/arch';
import { WorldAgent } from '../src/agent';
import { createMockProvider } from '../src/providers/mock/index';
import { isRoomPhotoRequest } from '../src/photo/pipeline';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';
const FIXTURE = resolve(__dirname, '../../../tests/fixtures/photo/hotel.description.json');
const rawDescription = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const description = () => {
    const p = parseRoomDescription(rawDescription(), partKinds());
    if (!p.ok)
        throw new Error(p.error);
    return p.value;
};
/** A PNG data URL whose header says `w`×`h` (the body is not a real image: nothing here decodes it). */
function fakePhoto(w, h) {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return `data:image/png;base64,${b.toString('base64')}`;
}
const raster = (seed) => {
    const w = 60;
    const h = 40;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            const v = x > 20 + seed && x < 40 + seed ? 230 : y > 28 ? 60 : 130;
            data[o] = v;
            data[o + 1] = v * 0.9;
            data[o + 2] = v * 0.95;
            data[o + 3] = 255;
        }
    return { width: w, height: h, data };
};
/** A host that renders fake images: the photo-camera render drifts away from the photo by `drift[call]`. */
class PhotoHost extends MemoryHost {
    captures = [];
    drift = [0];
    calls = 0;
    async captureReview(views) {
        this.captures.push({ names: views.map((v) => v.name), aspect: views[0]?.aspect ?? 0 });
        if (views.some((v) => v.name === 'photo-camera'))
            this.calls++;
        const d = this.drift[Math.min(this.calls - 1, this.drift.length - 1)] ?? 0;
        return views.map((v) => ({ name: v.name, dataUrl: `data:image/png;base64,${Buffer.from(`render|${v.name}|${d}`).toString('base64')}` }));
    }
    async decodeImage(dataUrl) {
        if (dataUrl.startsWith('data:image/png;base64,iVBOR'))
            return raster(0);
        const text = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64').toString();
        const m = /^render\|[^|]+\|(\d+)$/.exec(text);
        return m ? raster(Number(m[1])) : null;
    }
}
function scripted(replies) {
    const requests = [];
    let i = 0;
    return {
        name: 'scripted',
        requests,
        async complete(req) {
            requests.push(JSON.parse(JSON.stringify(req)));
            const r = replies[Math.min(i, replies.length - 1)];
            const content = r ? r(req, i) : [{ type: 'text', text: 'done' }];
            i++;
            return { content, stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end', model: 'fake-vision' };
        },
    };
}
let n = 0;
const call = (name, input) => ({ type: 'tool_use', id: `t${++n}`, name, input });
const describeCall = (d = rawDescription()) => () => [call('describe_room', { description: d })];
const verdicts = (fail, note = 'differs') => () => [
    call('report_verdicts', { verdicts: buildChecklist(description()).map((c) => ({ id: c.id, pass: !fail.includes(c.id), ...(fail.includes(c.id) ? { note } : {}) })), summary: 'ok' }),
];
const finish = () => [call('finish', { message: 'done' })];
function agent(provider, photo = {}) {
    return new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 10, photo });
}
const photoEvents = (events) => events.filter((e) => e.type === 'photo');
describe('what counts as a request for the room in a picture', () => {
    it('needs a picture and a prompt about a room', () => {
        expect(isRoomPhotoRequest('make this bedroom in 3d', 1, false)).toBe(true);
        expect(isRoomPhotoRequest('recreate this room', 1, false)).toBe(true);
        expect(isRoomPhotoRequest('make this bedroom in 3d', 0, false)).toBe(false);
        expect(isRoomPhotoRequest('a castle on a hill', 1, false)).toBe(false);
        expect(isRoomPhotoRequest('x', 1, true)).toBe(true);
        expect(isRoomPhotoRequest('a dragon', 1, false)).toBe(false);
    });
});
describe('room from a photo, with a vision model', () => {
    it('reads the photo, builds the described room through the tools, compares, fixes, and ends with every item passing', async () => {
        const provider = scripted([
            describeCall(),
            verdicts(['item-picture-left', 'cornice'], 'the picture hangs too low'),
            () => [call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.24 }] })],
            verdicts([]),
            finish,
        ]);
        // After round 1 the model reports two failures and fixes one in a second turn; round 2 passes everything.
        const host = new PhotoHost();
        const events = await collect(agent(provider).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
        const photo = photoEvents(events);
        expect(photo.map((e) => e.phase)).toEqual(expect.arrayContaining(['analysing', 'described', 'building', 'built', 'comparing', 'round', 'done']));
        // The assumptions are listed with a one-tap adjust sentence each.
        const described = photo.find((e) => e.phase === 'described');
        expect(described?.assumptions?.length).toBeGreaterThanOrEqual(2);
        expect(described?.assumptions?.some((a) => a.adjust.length > 0)).toBe(true);
        // The room is the described room: shell at the described size, window west, bed on the north wall, curtains anchored.
        const scene = readScene(host.world, PHOTO_BUILDING_ID);
        expect(scene).not.toBeNull();
        const room = scene?.rooms[0];
        expect(room?.walls.find((w) => w.compass === 'west')?.openings.some((o) => o.kind === 'window')).toBe(true);
        expect(scene?.items.filter((i) => i.kind === 'curtain')).toHaveLength(2);
        expect(scene?.items.find((i) => i.kind === 'bed')?.against?.[0]?.compass).toBe('north');
        // The loop ended with a measured, honest score.
        const done = photo.find((e) => e.phase === 'done');
        expect(done?.score?.passed).toBe(done?.score?.total);
        expect(events.some((e) => e.type === 'verify')).toBe(true);
        // Renders were made from the photo's camera at the photo's aspect (1920 / 1280 = 1.5), plus a clean one to measure.
        expect(host.captures[0]?.names).toContain('photo-camera');
        expect(host.captures[0]?.aspect).toBeCloseTo(1.5, 2);
        expect(host.captures.some((c) => c.names.includes('photo-camera-clean'))).toBe(true);
        // Framing against the boxes the description gives is measured, fitted and reported to the model.
        expect(photo.some((e) => e.phase === 'round' && /framing \d+%/.test(e.text))).toBe(true);
        expect(JSON.stringify(provider.requests[1]?.messages)).toContain('Framing');
        // The first compare message carries the photo and the render; the second drops the first round's images.
        const first = provider.requests[1]?.messages.at(-1);
        expect(Array.isArray(first?.content) && first.content.filter((b) => b.type === 'image').length).toBeGreaterThanOrEqual(2);
        // The analysis call carried the specification and the photo; no tool but describe_room was offered.
        expect(provider.requests[0]?.tools?.map((t) => t.name)).toEqual(['describe_room']);
        const spec = JSON.stringify(provider.requests[0]?.messages);
        expect(spec).toContain('along');
        expect(spec).toContain('bed [floor');
    });
    it('refuses to edit before judging, and applies a fix in the same reply as the verdicts', async () => {
        const provider = scripted([
            describeCall(),
            () => [call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.0 }] })],
            () => [
                call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.3 }] }),
                call('report_verdicts', { verdicts: buildChecklist(description()).map((c) => ({ id: c.id, pass: c.id !== 'item-picture-left', note: 'low' })) }),
            ],
            verdicts([]),
        ]);
        const host = new PhotoHost();
        await collect(agent(provider).run('recreate this room', host, { images: [fakePhoto(1200, 1600)] }));
        const second = provider.requests[2]?.messages.at(-1);
        const text = JSON.stringify(second?.content);
        expect(text).toContain('Judge first');
        // The verdict came first in the next reply (sorted), so the edit in it was applied.
        const pic = readScene(host.world, PHOTO_BUILDING_ID)?.items.find((i) => i.id.endsWith('picture-left'));
        expect(pic?.wall?.t).toBeCloseTo(2.3, 1);
    });
    it('rolls the room back when a round makes it worse', async () => {
        const all = buildChecklist(description()).map((c) => c.id);
        const mostlyFail = all.filter((id) => id !== 'shell-size').slice(0, 14);
        const provider = scripted([
            describeCall(),
            verdicts(['item-picture-left']),
            () => [call('edit_items', { edits: [{ op: 'remove', ref: 'tv' }, { op: 'remove', ref: 'picture-right' }] })],
            // Round 2: much worse; the host rolls back before applying anything else.
            verdicts(mostlyFail),
            () => [call('edit_items', { edits: [{ op: 'remove', ref: 'bed' }] })],
            verdicts([]),
            finish,
        ]);
        const host = new PhotoHost();
        host.drift = [0, 0, 0, 0];
        const events = await collect(agent(provider, { maxRounds: 3 }).run('recreate this room', host, { images: [fakePhoto(1920, 1280)] }));
        const msgs = photoEvents(events).map((e) => e.text).join('\n');
        expect(msgs).toContain('back to round 1');
        const scene = readScene(host.world, PHOTO_BUILDING_ID);
        // The room is the round-1 room: tv and the right picture are back, and the bed was never removed.
        expect(scene?.items.some((i) => i.kind === 'tv-set')).toBe(true);
        expect(scene?.items.filter((i) => i.kind === 'art')).toHaveLength(2);
        expect(scene?.items.some((i) => i.kind === 'bed')).toBe(true);
    });
    it('stops at the round cap and reports the measured final state, judging the last edits before keeping them', async () => {
        const provider = scripted([
            describeCall(),
            verdicts(['floor']),
            () => [call('edit_items', { edits: [{ op: 'move', ref: 'picture-left', wall: 'north', t: 2.1 }] })],
            // The final check after the cap.
            verdicts([]),
        ]);
        const host = new PhotoHost();
        const events = await collect(agent(provider, { maxRounds: 1 }).run('recreate this room', host, { images: [fakePhoto(1920, 1280)] }));
        const msgs = photoEvents(events);
        expect(msgs.some((e) => e.text.startsWith('Final check'))).toBe(true);
        const done = msgs.find((e) => e.phase === 'done');
        expect(done?.score?.passed).toBe(done?.score?.total);
    });
    it('says why when the description is refused three times and builds nothing', async () => {
        const bad = { ...rawDescription(), footprint: { width: 300, depth: 4, ceiling: 2.7 } };
        const provider = scripted([describeCall(bad)]);
        const host = new PhotoHost();
        const events = await collect(agent(provider).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
        expect(events.some((e) => e.type === 'error' && /footprint/.test(e.text))).toBe(true);
        expect(Object.keys(host.world.entities)).toHaveLength(0);
        // The refusal was sent back to the model each time.
        expect(provider.requests).toHaveLength(3);
        expect(JSON.stringify(provider.requests[1]?.messages)).toContain('refused');
    });
    it('surfaces the real reason when the provider fails', async () => {
        const provider = {
            name: 'broken',
            async complete() {
                throw new Error('You have hit your usage limit. Try again at 9:59 PM.');
            },
        };
        const events = await collect(agent(provider).run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)] }));
        const err = events.find((e) => e.type === 'error');
        expect(err && 'text' in err ? err.text : '').toContain('usage limit');
    });
    it('keeps the room it built when the assistant becomes unavailable during the comparison', async () => {
        let calls = 0;
        const provider = {
            name: 'flaky',
            async complete() {
                calls++;
                if (calls === 1)
                    return { content: [call('describe_room', { description: rawDescription() })], stopReason: 'tool_use' };
                throw new Error('connection reset');
            },
        };
        const host = new PhotoHost();
        const events = await collect(agent(provider).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
        expect(readScene(host.world, PHOTO_BUILDING_ID)?.items.length).toBeGreaterThan(8);
        expect(events.some((e) => e.type === 'error' && /connection reset/.test(e.text))).toBe(true);
    });
    it('builds without comparing when the host cannot render, and says so', async () => {
        const provider = scripted([describeCall()]);
        const host = new MemoryHost();
        const events = await collect(agent(provider).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
        expect(photoEvents(events).some((e) => e.phase === 'unavailable')).toBe(true);
        expect(readScene(host.world, PHOTO_BUILDING_ID)?.items.length).toBeGreaterThan(8);
        expect(events.some((e) => e.type === 'message' && /not compared/.test(e.text))).toBe(true);
    });
});
describe('the room replaces the world', () => {
    it('clears what was there (one undo step) unless the user is refining, then builds the room', async () => {
        const start = { op: 'add', entity: { id: 'old-tree', name: 'Old tree', shape: { kind: 'primitive', primitive: 'cone', size: [1, 2, 1] }, transform: { position: [9, 1, 9] } } };
        const run = async (intent) => {
            const host = new PhotoHost();
            host.applyPatches([start], 'seed');
            await collect(agent(scripted([describeCall(), verdicts([]), finish])).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)], photo: 'recreate', intent }));
            return host;
        };
        const replaced = await run('auto');
        expect(replaced.world.entities['old-tree']).toBeUndefined();
        expect(replaced.commits.map((c) => c.message)).toContain('Clear the world for the room from the photo');
        expect(readScene(replaced.world, PHOTO_BUILDING_ID)?.items.length).toBeGreaterThan(8);
        const beside = await run('refine');
        expect(beside.world.entities['old-tree']).toBeDefined();
    });
});
describe('room from a photo, without a vision model', () => {
    it('does not build a random room: it extracts the palette, says why and offers text', async () => {
        const host = new PhotoHost();
        const events = await collect(agent(createMockProvider()).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
        const off = photoEvents(events).find((e) => e.phase === 'offline');
        expect(off).toBeTruthy();
        expect(off?.text).toMatch(/needs a connected assistant/);
        expect(off?.text).toMatch(/describe the room in words/);
        expect(off?.palette?.length).toBeGreaterThan(0);
        expect(Object.keys(host.world.entities)).toHaveLength(0);
    });
    it('does the same when the connected assistant cannot see images', async () => {
        const provider = scripted([describeCall()]);
        const host = new PhotoHost();
        const events = await collect(agent(provider, { vision: false }).run('make this bedroom in 3d', host, { images: [fakePhoto(1920, 1280)] }));
        expect(photoEvents(events).some((e) => e.phase === 'offline' && /cannot look at images/.test(e.text))).toBe(true);
        expect(provider.requests).toHaveLength(0);
        expect(Object.keys(host.world.entities)).toHaveLength(0);
    });
    it('treats the offline planner that took over mid-run as unavailable, not as an answer', async () => {
        const chain = { name: 'mock', async complete() { return createMockProvider().complete({ role: 'planner', system: '', messages: [{ role: 'user', content: 'x' }] }); } };
        const host = new PhotoHost();
        const events = await collect(agent(chain).run('recreate this room', host, { images: [fakePhoto(1920, 1280)], photo: 'recreate' }));
        expect(photoEvents(events).some((e) => e.phase === 'offline')).toBe(true);
        expect(Object.keys(host.world.entities)).toHaveLength(0);
    });
    it('an agent without photo options goes through the normal planner for a picture, unless asked to recreate it', async () => {
        const provider = scripted([() => [{ type: 'text', text: 'nothing to do' }]]);
        const plain = new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 2 });
        await collect(plain.run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)] }));
        expect(provider.requests[0]?.tools?.map((t) => t.name)).not.toEqual(['describe_room']);
        const off = await collect(agent(provider).run('make this bedroom in 3d', new PhotoHost(), { images: [fakePhoto(1920, 1280)], photo: 'off' }));
        expect(photoEvents(off)).toHaveLength(0);
    });
});
