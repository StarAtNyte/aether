/**
 * The muxers are checked by parsing their output back with small readers
 * written here (EBML element walk; ISO-BMFF box walk) — structure, sizes,
 * durations, sample tables and payload placement.
 */
import { describe, expect, it } from 'vitest';
import { opusHead, vintSize, WebmMuxer } from '../src/publish/video/webm';
import { Mp4Muxer } from '../src/publish/video/mp4';
const MASTERS = new Set([0x1a45dfa3, 0x18538067, 0x114d9b74, 0x4dbb, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0xe1, 0x1f43b675, 0x1c53bb6b, 0xbb, 0xb7]);
function readVint(b, at, keepMarker) {
    const first = b[at];
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1))))
        len++;
    let value = keepMarker ? first : first & (0xff >> len);
    for (let i = 1; i < len; i++)
        value = value * 256 + b[at + i];
    return { value, len };
}
function parseEbml(b, start, end) {
    const out = [];
    let p = start;
    while (p < end) {
        const id = readVint(b, p, true);
        const size = readVint(b, p + id.len, false);
        const dataStart = p + id.len + size.len;
        const el = { id: id.value, start: p, dataStart, size: size.value };
        if (MASTERS.has(id.value))
            el.children = parseEbml(b, dataStart, dataStart + size.value);
        out.push(el);
        p = dataStart + size.value;
    }
    expect(p).toBe(end);
    return out;
}
function find(list, id) {
    return list?.find((e) => e.id === id);
}
function uint(b, e) {
    let v = 0;
    for (let i = 0; i < e.size; i++)
        v = v * 256 + b[e.dataStart + i];
    return v;
}
function chunks(n, fps, bytes = 100) {
    return Array.from({ length: n }, (_, i) => ({ timestampUs: Math.round((i * 1e6) / fps), key: i % fps === 0, data: new Uint8Array(bytes).fill(i & 0xff) }));
}
describe('WebM muxer', () => {
    it('writes a valid EBML tree with info, tracks, clusters per keyframe and cues', () => {
        const fps = 30;
        const m = new WebmMuxer({ codec: 'V_VP9', width: 320, height: 180, frameRate: fps }, { sampleRate: 48000, channels: 2 });
        for (const c of chunks(90, fps))
            m.addVideo(c);
        for (let i = 0; i < 150; i++)
            m.addAudio({ timestampUs: i * 20_000, durationUs: 20_000, key: true, data: new Uint8Array(40).fill(7) });
        const out = m.finalize();
        const top = parseEbml(out, 0, out.length);
        expect(top.map((e) => e.id)).toEqual([0x1a45dfa3, 0x18538067]);
        const header = top[0];
        const docType = find(header.children, 0x4282);
        expect(new TextDecoder().decode(out.subarray(docType.dataStart, docType.dataStart + docType.size))).toBe('webm');
        const seg = top[1];
        const info = find(seg.children, 0x1549a966);
        const dur = find(info.children, 0x4489);
        const durationMs = new DataView(out.buffer, out.byteOffset + dur.dataStart, 8).getFloat64(0);
        expect(durationMs).toBeCloseTo(3000, 0);
        const tracks = find(seg.children, 0x1654ae6b);
        expect(tracks.children?.filter((e) => e.id === 0xae)).toHaveLength(2);
        const video = find(find(tracks.children, 0xae)?.children, 0xe0);
        expect(uint(out, find(video.children, 0xb0))).toBe(320);
        const clusters = seg.children?.filter((e) => e.id === 0x1f43b675) ?? [];
        expect(clusters).toHaveLength(3);
        let blocks = 0;
        let videoBlocks = 0;
        for (const c of clusters) {
            for (const b of c.children?.filter((e) => e.id === 0xa3) ?? []) {
                blocks++;
                if ((out[b.dataStart] & 0x7f) === 1)
                    videoBlocks++;
            }
        }
        expect(videoBlocks).toBe(90);
        expect(blocks).toBe(240);
        // Cues point at the clusters (positions relative to the segment data).
        const cues = find(seg.children, 0x1c53bb6b);
        const positions = (cues.children ?? []).map((cp) => uint(out, find(find(cp.children, 0xb7)?.children, 0xf1)));
        expect(positions.map((p) => seg.dataStart + p)).toEqual(clusters.map((c) => c.start));
        // SeekHead entries point at Info / Tracks / Cues.
        const seekHead = find(seg.children, 0x114d9b74);
        const targets = (seekHead.children ?? []).map((s) => seg.dataStart + uint(out, find(s.children, 0x53ac)));
        expect(targets).toEqual([info.start, tracks.start, cues.start]);
    });
    it('rejects a stream that does not start with a keyframe or has bad timestamps', () => {
        const m = new WebmMuxer({ codec: 'V_VP8', width: 16, height: 16 });
        expect(() => m.addVideo({ timestampUs: 0, key: false, data: new Uint8Array(1) })).toThrow(/keyframe/);
        expect(() => m.addVideo({ timestampUs: -1, key: true, data: new Uint8Array(1) })).toThrow(/timestamp/);
        expect(() => m.finalize()).toThrow(/no video/);
        expect(() => m.addAudio({ timestampUs: 0, key: true, data: new Uint8Array(1) })).toThrow(/no audio/);
    });
    it('encodes EBML sizes and the Opus header', () => {
        expect([...vintSize(0)]).toEqual([0x80]);
        expect([...vintSize(126)]).toEqual([0xfe]);
        expect([...vintSize(127)]).toEqual([0x40, 0x7f]);
        expect([...vintSize(5, 8)]).toEqual([1, 0, 0, 0, 0, 0, 0, 5]);
        const head = opusHead(2, 48000, 312);
        expect(new TextDecoder().decode(head.subarray(0, 8))).toBe('OpusHead');
        expect(new DataView(head.buffer).getUint16(10, true)).toBe(312);
    });
});
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf']);
function parseBoxes(b, start, end) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const out = [];
    let p = start;
    while (p < end) {
        const size = dv.getUint32(p);
        const type = String.fromCharCode(...b.subarray(p + 4, p + 8));
        const box = { type, start: p, size };
        if (CONTAINERS.has(type))
            box.children = parseBoxes(b, p + 8, p + size);
        out.push(box);
        p += size;
    }
    expect(p).toBe(end);
    return out;
}
function path(boxes, ...types) {
    let cur;
    let list = boxes;
    for (const t of types) {
        cur = list?.find((x) => x.type === t);
        list = cur?.children;
    }
    return cur;
}
describe('MP4 muxer', () => {
    const avcC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);
    it('writes ftyp, a fast-start moov and mdat with correct tables and offsets', () => {
        const fps = 30;
        const m = new Mp4Muxer({ width: 640, height: 360, avcC, frameRate: fps }, { sampleRate: 48000, channels: 2 });
        const vchunks = chunks(60, fps, 50);
        for (const c of vchunks)
            m.addVideo(c);
        for (let i = 0; i < 100; i++)
            m.addAudio({ timestampUs: i * 20_000, durationUs: 20_000, key: true, data: new Uint8Array(30).fill(200) });
        const out = m.finalize();
        const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
        const top = parseBoxes(out, 0, out.length);
        expect(top.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
        const moov = top[1];
        // Movie duration: 2 s.
        const mvhd = path(moov.children, 'mvhd');
        expect(dv.getUint32(mvhd.start + 20)).toBe(1000);
        expect(dv.getUint32(mvhd.start + 24)).toBe(2000);
        const traks = moov.children?.filter((b) => b.type === 'trak') ?? [];
        expect(traks).toHaveLength(2);
        const vstbl = path(traks[0]?.children, 'mdia', 'minf', 'stbl');
        expect(vstbl.children?.map((b) => b.type)).toEqual(['stsd', 'stts', 'stss', 'stsc', 'stsz', 'stco']);
        const stsz = path(vstbl.children, 'stsz');
        expect(dv.getUint32(stsz.start + 16)).toBe(60);
        const stss = path(vstbl.children, 'stss');
        expect(dv.getUint32(stss.start + 12)).toBe(2);
        expect([dv.getUint32(stss.start + 16), dv.getUint32(stss.start + 20)]).toEqual([1, 31]);
        const stts = path(vstbl.children, 'stts');
        expect(dv.getUint32(stts.start + 12)).toBe(1);
        expect([dv.getUint32(stts.start + 16), dv.getUint32(stts.start + 20)]).toEqual([60, 3000]);
        // The video chunk offset points at the first frame inside mdat; audio follows the video bytes.
        const vOff = dv.getUint32(path(vstbl.children, 'stco').start + 16);
        const mdat = top[2];
        expect(vOff).toBe(mdat.start + 8);
        expect(out.subarray(vOff, vOff + 50)).toEqual(vchunks[0]?.data);
        expect(out[vOff + 50]).toBe(1);
        const astbl = path(traks[1]?.children, 'mdia', 'minf', 'stbl');
        const aOff = dv.getUint32(path(astbl.children, 'stco').start + 16);
        expect(aOff).toBe(vOff + 60 * 50);
        expect(out[aOff]).toBe(200);
        expect(mdat.start + mdat.size).toBe(out.length);
        // Sample entries.
        const stsd = path(vstbl.children, 'stsd');
        expect(String.fromCharCode(...out.subarray(stsd.start + 20, stsd.start + 24))).toBe('avc1');
        const astsd = path(astbl.children, 'stsd');
        expect(String.fromCharCode(...out.subarray(astsd.start + 20, astsd.start + 24))).toBe('Opus');
    });
    it('needs a decoder configuration and a leading keyframe', () => {
        expect(() => new Mp4Muxer({ width: 2, height: 2, avcC: new Uint8Array(2) })).toThrow(/decoder configuration/);
        const m = new Mp4Muxer({ width: 2, height: 2, avcC });
        expect(() => m.addVideo({ timestampUs: 0, key: false, data: new Uint8Array(1) })).toThrow(/keyframe/);
    });
});
