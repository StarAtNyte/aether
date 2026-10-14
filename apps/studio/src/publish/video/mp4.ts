/**
 * Minimal MP4 (ISO-BMFF) muxer for WebCodecs output: one H.264 video track
 * (AVCC samples, `avcC` from the encoder's decoder config) and an optional
 * Opus audio track (`Opus` sample entry with `dOps`, playable in Chromium,
 * Firefox and Safari). Non-fragmented with the `moov` box before `mdat`
 * ("fast start"), so the file streams and seeks everywhere. Each track's
 * samples are one contiguous chunk.
 *
 * Reference: ISO/IEC 14496-12 and 14496-15; Opus in ISOBMFF
 * (https://opus-codec.org/docs/opus_in_isobmff.html).
 */
import { ByteWriter } from './bytes';
import { MAX_MUX_BYTES, type MuxChunk } from './webm';

/** H.264 track description. */
export interface Mp4VideoTrack {
  width: number;
  height: number;
  /** `avcC` record (VideoDecoderConfig.description). */
  avcC: Uint8Array;
  frameRate?: number;
}

/** Opus track description. */
export interface Mp4AudioTrack {
  sampleRate: number;
  channels: number;
  preSkip?: number;
}

const VIDEO_TIMESCALE = 90_000;
const MOVIE_TIMESCALE = 1000;
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

function box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const w = new ByteWriter();
  const size = 8 + payloads.reduce((s, p) => s + p.byteLength, 0);
  w.u32(size).ascii(type);
  for (const p of payloads) w.bytes(p);
  return w.finish();
}

function fullBox(type: string, version: number, flags: number, ...payloads: Uint8Array[]): Uint8Array {
  return box(type, new ByteWriter().u8(version).u24(flags).finish(), ...payloads);
}

function matrix(w: ByteWriter): ByteWriter {
  for (const v of MATRIX) w.u32(v);
  return w;
}

interface TrackSamples {
  sizes: number[];
  /** Duration of each sample in the track timescale. */
  durations: number[];
  /** 1-based numbers of sync samples (video only). */
  sync: number[];
  data: Uint8Array[];
  timescale: number;
  /** Total length in the track timescale. */
  length: number;
}

function samples(chunks: readonly MuxChunk[], timescale: number, fallbackUs: number): TrackSamples {
  const sorted = [...chunks].sort((a, b) => a.timestampUs - b.timestampUs);
  const ticks = (us: number): number => Math.round((us * timescale) / 1e6);
  const out: TrackSamples = { sizes: [], durations: [], sync: [], data: [], timescale, length: 0 };
  sorted.forEach((c, i) => {
    const next = sorted[i + 1];
    const dur = next ? ticks(next.timestampUs) - ticks(c.timestampUs) : ticks(c.timestampUs + (c.durationUs ?? fallbackUs)) - ticks(c.timestampUs);
    out.sizes.push(c.data.byteLength);
    out.durations.push(Math.max(1, dur));
    if (c.key) out.sync.push(i + 1);
    out.data.push(c.data);
  });
  out.length = out.durations.reduce((s, d) => s + d, 0);
  return out;
}

function stts(durations: readonly number[]): Uint8Array {
  const runs: Array<[number, number]> = [];
  for (const d of durations) {
    const last = runs[runs.length - 1];
    if (last && last[1] === d) last[0]++;
    else runs.push([1, d]);
  }
  const w = new ByteWriter().u32(runs.length);
  for (const [n, d] of runs) w.u32(n).u32(d);
  return fullBox('stts', 0, 0, w.finish());
}

function stbl(entry: Uint8Array, s: TrackSamples, chunkOffset: number, withSync: boolean): Uint8Array {
  const stsz = new ByteWriter().u32(0).u32(s.sizes.length);
  for (const n of s.sizes) stsz.u32(n);
  const parts = [
    fullBox('stsd', 0, 0, new ByteWriter().u32(1).finish(), entry),
    stts(s.durations),
    fullBox('stsc', 0, 0, new ByteWriter().u32(1).u32(1).u32(s.sizes.length).u32(1).finish()),
    fullBox('stsz', 0, 0, stsz.finish()),
    fullBox('stco', 0, 0, new ByteWriter().u32(1).u32(chunkOffset).finish()),
  ];
  if (withSync && s.sync.length < s.sizes.length) {
    const w = new ByteWriter().u32(s.sync.length);
    for (const n of s.sync) w.u32(n);
    parts.splice(2, 0, fullBox('stss', 0, 0, w.finish()));
  }
  return box('stbl', ...parts);
}

function tkhd(id: number, durationMs: number, audio: boolean, width: number, height: number): Uint8Array {
  const w = new ByteWriter().u32(0).u32(0).u32(id).u32(0).u32(durationMs).u32(0).u32(0).u16(0).u16(audio ? 1 : 0).u16(audio ? 0x0100 : 0).u16(0);
  matrix(w);
  w.u32(audio ? 0 : width * 65536).u32(audio ? 0 : height * 65536);
  return fullBox('tkhd', 0, 3, w.finish());
}

function mdhd(timescale: number, duration: number): Uint8Array {
  return fullBox('mdhd', 0, 0, new ByteWriter().u32(0).u32(0).u32(timescale).u32(duration).u16(0x55c4).u16(0).finish());
}

function hdlr(type: string, name: string): Uint8Array {
  return fullBox('hdlr', 0, 0, new ByteWriter().u32(0).ascii(type).u32(0).u32(0).u32(0).ascii(name).u8(0).finish());
}

function dinf(): Uint8Array {
  return box('dinf', fullBox('dref', 0, 0, new ByteWriter().u32(1).finish(), fullBox('url ', 0, 1)));
}

function avc1(v: Mp4VideoTrack): Uint8Array {
  const w = new ByteWriter();
  w.bytes(new Uint8Array(6)).u16(1);
  w.u16(0).u16(0).u32(0).u32(0).u32(0);
  w.u16(v.width).u16(v.height).u32(0x00480000).u32(0x00480000).u32(0).u16(1);
  const name = new Uint8Array(32);
  const label = 'Aether';
  name[0] = label.length;
  for (let i = 0; i < label.length; i++) name[i + 1] = label.charCodeAt(i);
  w.bytes(name).u16(0x0018).i16(-1);
  return box('avc1', w.finish(), box('avcC', v.avcC));
}

function opus(a: Mp4AudioTrack): Uint8Array {
  const w = new ByteWriter();
  w.bytes(new Uint8Array(6)).u16(1);
  w.u32(0).u32(0).u16(a.channels).u16(16).u16(0).u16(0).u32(Math.min(65535, a.sampleRate) * 65536);
  const dops = new ByteWriter().u8(0).u8(a.channels).u16(a.preSkip ?? 312).u32(a.sampleRate).i16(0).u8(0).finish();
  return box('Opus', w.finish(), box('dOps', dops));
}

/** Buffers encoded chunks and writes a complete MP4 file. */
export class Mp4Muxer {
  private readonly video: MuxChunk[] = [];
  private readonly audio: MuxChunk[] = [];
  private bytes = 0;

  constructor(
    private readonly videoTrack: Mp4VideoTrack,
    private readonly audioTrack: Mp4AudioTrack | null = null,
  ) {
    if (videoTrack.avcC.byteLength < 7) throw new Error('missing H.264 decoder configuration');
  }

  private add(list: MuxChunk[], chunk: MuxChunk): void {
    if (!Number.isFinite(chunk.timestampUs) || chunk.timestampUs < 0) throw new Error('invalid chunk timestamp');
    this.bytes += chunk.data.byteLength;
    if (this.bytes > MAX_MUX_BYTES) throw new Error('the video is too large');
    list.push(chunk);
  }

  /** Add an AVCC-framed H.264 access unit (the first must be a keyframe). */
  addVideo(chunk: MuxChunk): void {
    if (this.video.length === 0 && !chunk.key) throw new Error('the first video frame must be a keyframe');
    this.add(this.video, chunk);
  }

  /** Add an Opus packet. */
  addAudio(chunk: MuxChunk): void {
    if (!this.audioTrack) throw new Error('no audio track');
    this.add(this.audio, chunk);
  }

  /** Frames added so far. */
  get frames(): number {
    return this.video.length;
  }

  /** Write the file. */
  finalize(): Uint8Array {
    if (this.video.length === 0) throw new Error('no video frames');
    const frameUs = this.videoTrack.frameRate ? 1e6 / this.videoTrack.frameRate : 33_333;
    const vs = samples(this.video, VIDEO_TIMESCALE, frameUs);
    const at = this.audioTrack;
    const as = at && this.audio.length > 0 ? samples(this.audio, at.sampleRate, 20_000) : null;
    const vMs = Math.round((vs.length * MOVIE_TIMESCALE) / VIDEO_TIMESCALE);
    const aMs = as ? Math.round((as.length * MOVIE_TIMESCALE) / as.timescale) : 0;
    const movieMs = Math.max(vMs, aMs);
    const ftyp = box('ftyp', new ByteWriter().ascii('isom').u32(0x200).ascii('isom').ascii('iso2').ascii('avc1').ascii('mp41').finish());
    const vBytes = vs.sizes.reduce((s, n) => s + n, 0);

    const build = (vOffset: number, aOffset: number): Uint8Array => {
      const vTrak = box(
        'trak',
        tkhd(1, vMs, false, this.videoTrack.width, this.videoTrack.height),
        box('mdia', mdhd(VIDEO_TIMESCALE, vs.length), hdlr('vide', 'VideoHandler'), box('minf', fullBox('vmhd', 0, 1, new ByteWriter().u16(0).u16(0).u16(0).u16(0).finish()), dinf(), stbl(avc1(this.videoTrack), vs, vOffset, true))),
      );
      const traks = [vTrak];
      if (as && at) {
        traks.push(
          box(
            'trak',
            tkhd(2, aMs, true, 0, 0),
            box('mdia', mdhd(as.timescale, as.length), hdlr('soun', 'SoundHandler'), box('minf', fullBox('smhd', 0, 0, new ByteWriter().u16(0).u16(0).finish()), dinf(), stbl(opus(at), as, aOffset, false))),
          ),
        );
      }
      const mvhd = new ByteWriter().u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(movieMs).u32(0x00010000).u16(0x0100).u16(0).u32(0).u32(0);
      matrix(mvhd);
      for (let i = 0; i < 6; i++) mvhd.u32(0);
      mvhd.u32(traks.length + 1);
      return box('moov', fullBox('mvhd', 0, 0, mvhd.finish()), ...traks);
    };

    // Offsets depend on the moov size, which does not depend on the offset values (fixed-width stco).
    const moovSize = build(0, 0).byteLength;
    const mdatStart = ftyp.byteLength + moovSize + 8;
    const moov = build(mdatStart, mdatStart + vBytes);
    const mdatSize = 8 + vBytes + (as ? as.sizes.reduce((s, n) => s + n, 0) : 0);
    if (mdatStart + mdatSize > 0xffffffff) throw new Error('the video is too large');
    const w = new ByteWriter().bytes(ftyp).bytes(moov).u32(mdatSize).ascii('mdat');
    for (const d of vs.data) w.bytes(d);
    if (as) for (const d of as.data) w.bytes(d);
    return w.finish();
  }
}
