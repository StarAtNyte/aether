/**
 * A tiny growable big-endian byte writer shared by the WebM (EBML) and MP4
 * (ISO-BMFF) muxers. Chunks are appended by reference and joined once, so
 * muxing a long video copies each encoded frame exactly once.
 */
export class ByteWriter {
    parts = [];
    size = 0;
    /** Bytes written so far. */
    get length() {
        return this.size;
    }
    bytes(data) {
        if (data.byteLength > 0) {
            this.parts.push(data);
            this.size += data.byteLength;
        }
        return this;
    }
    u8(v) {
        return this.bytes(Uint8Array.of(v & 0xff));
    }
    u16(v) {
        return this.bytes(Uint8Array.of((v >>> 8) & 0xff, v & 0xff));
    }
    i16(v) {
        return this.u16(v < 0 ? v + 0x10000 : v);
    }
    u24(v) {
        return this.bytes(Uint8Array.of((v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff));
    }
    u32(v) {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setUint32(0, v >>> 0);
        return this.bytes(b);
    }
    /** Unsigned 64-bit integer (values up to 2^53). */
    u64(v) {
        const b = new Uint8Array(8);
        const dv = new DataView(b.buffer);
        dv.setUint32(0, Math.floor(v / 0x100000000));
        dv.setUint32(4, v >>> 0);
        return this.bytes(b);
    }
    f64(v) {
        const b = new Uint8Array(8);
        new DataView(b.buffer).setFloat64(0, v);
        return this.bytes(b);
    }
    /** ASCII text (four-character codes, codec ids). */
    ascii(text) {
        const b = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++)
            b[i] = text.charCodeAt(i) & 0x7f;
        return this.bytes(b);
    }
    /** Everything written, joined. */
    finish() {
        if (this.parts.length === 1)
            return this.parts[0];
        const out = new Uint8Array(this.size);
        let at = 0;
        for (const p of this.parts) {
            out.set(p, at);
            at += p.byteLength;
        }
        return out;
    }
}
/** Join byte arrays. */
export function concatBytes(parts) {
    const w = new ByteWriter();
    for (const p of parts)
        w.bytes(p);
    return w.finish();
}
