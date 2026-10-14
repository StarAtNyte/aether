/**
 * Minimal WebM (Matroska) muxer for encoded WebCodecs output: one video
 * track (VP8, VP9 or AV1) and an optional Opus audio track. Everything is
 * buffered and written at the end, so the file is complete and seekable:
 * EBML header, Segment of known size with a SeekHead, Info (with the
 * duration), Tracks, one Cluster per video keyframe (SimpleBlocks with
 * 16-bit relative timestamps; clusters split before they would overflow)
 * and Cues pointing at every cluster.
 *
 * Reference: https://www.matroska.org/technical/elements.html and the WebM
 * container guidelines.
 */
import { ByteWriter } from './bytes';

/** Video codec ids WebM accepts. */
export type WebmVideoCodec = 'V_VP8' | 'V_VP9' | 'V_AV1';

/** Video track description. */
export interface WebmVideoTrack {
  codec: WebmVideoCodec;
  width: number;
  height: number;
  /** Frames per second (written as the default frame duration). */
  frameRate?: number;
  /** Codec private data (AV1: av1C). */
  codecPrivate?: Uint8Array;
}

/** Opus audio track description. */
export interface WebmAudioTrack {
  sampleRate: number;
  channels: number;
  /** Samples the decoder drops at the start (OpusHead pre-skip). */
  preSkip?: number;
}

/** One encoded frame. */
export interface MuxChunk {
  /** Presentation time in microseconds. */
  timestampUs: number;
  /** Duration in microseconds (optional; derived from the next frame). */
  durationUs?: number;
  key: boolean;
  data: Uint8Array;
}

/** Most bytes a muxed file may hold. */
export const MAX_MUX_BYTES = 512 * 1024 * 1024;

// Element ids.
const EBML = 0x1a45dfa3;
const EBML_VERSION = 0x4286;
const EBML_READ_VERSION = 0x42f7;
const EBML_MAX_ID_LENGTH = 0x42f2;
const EBML_MAX_SIZE_LENGTH = 0x42f3;
const DOC_TYPE = 0x4282;
const DOC_TYPE_VERSION = 0x4287;
const DOC_TYPE_READ_VERSION = 0x4285;
const SEGMENT = 0x18538067;
const SEEK_HEAD = 0x114d9b74;
const SEEK = 0x4dbb;
const SEEK_ID = 0x53ab;
const SEEK_POSITION = 0x53ac;
const INFO = 0x1549a966;
const TIMESTAMP_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const MUXING_APP = 0x4d80;
const WRITING_APP = 0x5741;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_NUMBER = 0xd7;
const TRACK_UID = 0x73c5;
const TRACK_TYPE = 0x83;
const FLAG_LACING = 0x9c;
const CODEC_ID = 0x86;
const CODEC_PRIVATE = 0x63a2;
const CODEC_DELAY = 0x56aa;
const SEEK_PRE_ROLL = 0x56bb;
const DEFAULT_DURATION = 0x23e383;
const VIDEO = 0xe0;
const PIXEL_WIDTH = 0xb0;
const PIXEL_HEIGHT = 0xba;
const AUDIO = 0xe1;
const SAMPLING_FREQUENCY = 0xb5;
const CHANNELS = 0x9f;
const CLUSTER = 0x1f43b675;
const CLUSTER_TIMESTAMP = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const CUES = 0x1c53bb6b;
const CUE_POINT = 0xbb;
const CUE_TIME = 0xb3;
const CUE_TRACK_POSITIONS = 0xb7;
const CUE_TRACK = 0xf7;
const CUE_CLUSTER_POSITION = 0xf1;

function idBytes(id: number): Uint8Array {
  if (id >= 0x1000000) return Uint8Array.of(id >>> 24, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff);
  if (id >= 0x10000) return Uint8Array.of(id >>> 16, (id >>> 8) & 0xff, id & 0xff);
  if (id >= 0x100) return Uint8Array.of(id >>> 8, id & 0xff);
  return Uint8Array.of(id);
}

/** EBML variable-size integer for an element size (`width` forces a length, 1–8). */
export function vintSize(n: number, width?: number): Uint8Array {
  let len = width ?? 1;
  if (width === undefined) while (len < 8 && n >= 2 ** (7 * len) - 1) len++;
  const out = new Uint8Array(len);
  let v = n;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] = (out[0] as number) | (0x80 >> (len - 1));
  return out;
}

function uintBytes(v: number): Uint8Array {
  let n = Math.max(0, Math.floor(v));
  const bytes: number[] = [];
  do {
    bytes.unshift(n % 256);
    n = Math.floor(n / 256);
  } while (n > 0);
  return Uint8Array.from(bytes);
}

function element(id: number, payload: Uint8Array, sizeWidth?: number): Uint8Array {
  const w = new ByteWriter();
  w.bytes(idBytes(id)).bytes(vintSize(payload.byteLength, sizeWidth)).bytes(payload);
  return w.finish();
}

function uintEl(id: number, v: number): Uint8Array {
  return element(id, uintBytes(v));
}

function floatEl(id: number, v: number): Uint8Array {
  return element(id, new ByteWriter().f64(v).finish());
}

function stringEl(id: number, s: string): Uint8Array {
  return element(id, new TextEncoder().encode(s));
}

function master(id: number, children: readonly Uint8Array[], sizeWidth?: number): Uint8Array {
  const w = new ByteWriter();
  for (const c of children) w.bytes(c);
  return element(id, w.finish(), sizeWidth);
}

/** The OpusHead identification header (RFC 7845 §5.1), used as CodecPrivate. */
export function opusHead(channels: number, sampleRate: number, preSkip: number): Uint8Array {
  const b = new Uint8Array(19);
  b.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]); // "OpusHead"
  const dv = new DataView(b.buffer);
  b[8] = 1;
  b[9] = channels;
  dv.setUint16(10, preSkip, true);
  dv.setUint32(12, sampleRate, true);
  dv.setInt16(16, 0, true);
  b[18] = 0;
  return b;
}

interface Block {
  track: 1 | 2;
  timestampUs: number;
  key: boolean;
  data: Uint8Array;
}

/** Buffers encoded chunks and writes a complete WebM file. */
export class WebmMuxer {
  private readonly video: MuxChunk[] = [];
  private readonly audio: MuxChunk[] = [];
  private bytes = 0;

  constructor(
    private readonly videoTrack: WebmVideoTrack,
    private readonly audioTrack: WebmAudioTrack | null = null,
  ) {}

  private add(list: MuxChunk[], chunk: MuxChunk): void {
    if (!Number.isFinite(chunk.timestampUs) || chunk.timestampUs < 0) throw new Error('invalid chunk timestamp');
    this.bytes += chunk.data.byteLength;
    if (this.bytes > MAX_MUX_BYTES) throw new Error('the video is too large');
    list.push(chunk);
  }

  /** Add an encoded video frame (the first must be a keyframe). */
  addVideo(chunk: MuxChunk): void {
    if (this.video.length === 0 && !chunk.key) throw new Error('the first video frame must be a keyframe');
    this.add(this.video, chunk);
  }

  /** Add an encoded Opus packet. */
  addAudio(chunk: MuxChunk): void {
    if (!this.audioTrack) throw new Error('no audio track');
    this.add(this.audio, chunk);
  }

  /** Frames added so far. */
  get frames(): number {
    return this.video.length;
  }

  /** Write the file. `durationUs` overrides the computed length. */
  finalize(durationUs?: number): Uint8Array {
    if (this.video.length === 0) throw new Error('no video frames');
    const video = [...this.video].sort((a, b) => a.timestampUs - b.timestampUs);
    const audio = [...this.audio].sort((a, b) => a.timestampUs - b.timestampUs);
    const lastV = video[video.length - 1] as MuxChunk;
    const frameUs = this.videoTrack.frameRate ? 1e6 / this.videoTrack.frameRate : video.length > 1 ? (lastV.timestampUs - (video[0] as MuxChunk).timestampUs) / (video.length - 1) : 33_333;
    const lastA = audio[audio.length - 1];
    const end = Math.max(lastV.timestampUs + (lastV.durationUs ?? frameUs), lastA ? lastA.timestampUs + (lastA.durationUs ?? 20_000) : 0);
    const durationMs = (durationUs ?? end) / 1000;

    // Cluster starts: every video keyframe, and before a block would be > 30 s from its cluster.
    const starts: number[] = [];
    for (const c of video) {
      const ms = Math.floor(c.timestampUs / 1000);
      const last = starts[starts.length - 1];
      if (last === undefined || (c.key && ms > last) || ms - last > 30_000) starts.push(ms);
    }
    const blocks: Block[] = [...video.map((c) => ({ track: 1 as const, timestampUs: c.timestampUs, key: c.key, data: c.data })), ...audio.map((c) => ({ track: 2 as const, timestampUs: c.timestampUs, key: true, data: c.data }))].sort(
      (a, b) => a.timestampUs - b.timestampUs || a.track - b.track,
    );
    const perCluster: Block[][] = starts.map(() => []);
    for (const b of blocks) {
      const ms = Math.floor(b.timestampUs / 1000);
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((starts[mid] as number) <= ms) lo = mid;
        else hi = mid - 1;
      }
      (perCluster[lo] as Block[]).push(b);
    }
    const clusters: Uint8Array[] = perCluster.map((list, i) => {
      const base = starts[i] as number;
      const kids: Uint8Array[] = [uintEl(CLUSTER_TIMESTAMP, base)];
      for (const b of list) {
        const rel = Math.max(-32768, Math.min(32767, Math.floor(b.timestampUs / 1000) - base));
        const w = new ByteWriter();
        w.u8(0x80 | b.track).i16(rel).u8(b.key ? 0x80 : 0x00).bytes(b.data);
        kids.push(element(SIMPLE_BLOCK, w.finish()));
      }
      return master(CLUSTER, kids);
    });

    const info = master(INFO, [uintEl(TIMESTAMP_SCALE, 1_000_000), floatEl(DURATION, durationMs), stringEl(MUXING_APP, 'Aether'), stringEl(WRITING_APP, 'Aether')]);
    const vt = this.videoTrack;
    const videoEntry = master(TRACK_ENTRY, [
      uintEl(TRACK_NUMBER, 1),
      uintEl(TRACK_UID, 1),
      uintEl(TRACK_TYPE, 1),
      uintEl(FLAG_LACING, 0),
      stringEl(CODEC_ID, vt.codec),
      ...(vt.codecPrivate && vt.codecPrivate.byteLength > 0 ? [element(CODEC_PRIVATE, vt.codecPrivate)] : []),
      ...(vt.frameRate ? [uintEl(DEFAULT_DURATION, Math.round(1e9 / vt.frameRate))] : []),
      master(VIDEO, [uintEl(PIXEL_WIDTH, vt.width), uintEl(PIXEL_HEIGHT, vt.height)]),
    ]);
    const entries = [videoEntry];
    const at = this.audioTrack;
    if (at) {
      const preSkip = at.preSkip ?? 312;
      entries.push(
        master(TRACK_ENTRY, [
          uintEl(TRACK_NUMBER, 2),
          uintEl(TRACK_UID, 2),
          uintEl(TRACK_TYPE, 2),
          uintEl(FLAG_LACING, 0),
          stringEl(CODEC_ID, 'A_OPUS'),
          element(CODEC_PRIVATE, opusHead(at.channels, at.sampleRate, preSkip)),
          uintEl(CODEC_DELAY, Math.round((preSkip / 48000) * 1e9)),
          uintEl(SEEK_PRE_ROLL, 80_000_000),
          master(AUDIO, [floatEl(SAMPLING_FREQUENCY, at.sampleRate), uintEl(CHANNELS, at.channels)]),
        ]),
      );
    }
    const tracks = master(TRACKS, entries);

    // Layout inside the segment: SeekHead (fixed size), Info, Tracks, Clusters, Cues.
    const seekEntry = (id: number, pos: number): Uint8Array => master(SEEK, [element(SEEK_ID, idBytes(id)), element(SEEK_POSITION, new ByteWriter().u64(pos).finish())]);
    const seekHeadSize = master(SEEK_HEAD, [seekEntry(INFO, 0), seekEntry(TRACKS, 0), seekEntry(CUES, 0)]).byteLength;
    const infoPos = seekHeadSize;
    const tracksPos = infoPos + info.byteLength;
    let pos = tracksPos + tracks.byteLength;
    const clusterPos: number[] = [];
    for (const c of clusters) {
      clusterPos.push(pos);
      pos += c.byteLength;
    }
    const cuesPos = pos;
    const cues = master(
      CUES,
      starts.map((t, i) => master(CUE_POINT, [uintEl(CUE_TIME, t), master(CUE_TRACK_POSITIONS, [uintEl(CUE_TRACK, 1), element(CUE_CLUSTER_POSITION, new ByteWriter().u64(clusterPos[i] as number).finish())])])),
    );
    const seekHead = master(SEEK_HEAD, [seekEntry(INFO, infoPos), seekEntry(TRACKS, tracksPos), seekEntry(CUES, cuesPos)]);
    if (seekHead.byteLength !== seekHeadSize) throw new Error('internal: seek head size changed');

    const header = master(EBML, [
      uintEl(EBML_VERSION, 1),
      uintEl(EBML_READ_VERSION, 1),
      uintEl(EBML_MAX_ID_LENGTH, 4),
      uintEl(EBML_MAX_SIZE_LENGTH, 8),
      stringEl(DOC_TYPE, 'webm'),
      uintEl(DOC_TYPE_VERSION, 4),
      uintEl(DOC_TYPE_READ_VERSION, 2),
    ]);
    const body = new ByteWriter().bytes(seekHead).bytes(info).bytes(tracks);
    for (const c of clusters) body.bytes(c);
    body.bytes(cues);
    const segment = body.finish();
    return new ByteWriter().bytes(header).bytes(idBytes(SEGMENT)).bytes(vintSize(segment.byteLength, 8)).bytes(segment).finish();
  }
}
