/**
 * Publish controller: the state and actions behind the Publish hub — one
 * place to turn the open world into a game (zip, the user's own hosting,
 * LAN), a video along a cinematic camera path, a high-resolution still, a
 * glTF model, a floor plan or a share link — with presets, progress,
 * cancel, a publish history and version snapshots. Owns its own small
 * store, so the hub never re-renders the editor.
 *
 * Long jobs run one at a time and can be cancelled; their outputs become
 * object URLs (revoked on the next job and on dispose) and entries in the
 * publish history (`publish/library.ts`).
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { History, Vec3, WorldDoc } from '@aether/core';
import { floorPlan2d, listBuildings, listLevels, planToWorld } from '@aether/arch';
import type { Provider } from '@aether/agent';
import type { ColliderProvider } from '@aether/physics';
import type { Proof } from '@aether/verifier';
import type { Proof as BotProof } from '@aether/playtest/proof';
import type { StudioState } from '../state/store';
import type { Simulation } from './Simulation';
import { createLogger, errorMessage } from '../lib/log';
import {
  CompiledPath,
  DEFAULT_FOV,
  newPose,
  normalizePath,
  presetPath,
  removeKey,
  rescalePath,
  retimeKey,
  stillPath,
  upsertKey,
  type CameraPath,
  type Easing,
  type PresetId,
  type PresetScene,
} from '../publish/cameraPath';
// The director, share-link codec and QR encoder load on first use.
import type { DirectorScene, Subject } from '../publish/director';
import { SHARE_KEY } from '../publish/share-key';
import { defaultControls, defaultDescription, defaultTitle } from '../publish/manifest';
import { defaultTitles, type TitleSpec } from '../publish/video/titles';
import type { Mood } from '../publish/video/music';
import type { VideoFormat } from '../publish/video/export';
import { publishLibrary, type PublishedItem, type PublishKind, type SnapshotInfo } from '../publish/library';
import type { DeployEvent, HostId, HostTarget, LanState, PublishTransport } from '../publish/hosting';

const log = createLogger('publish');

/** Hub sections. */
export type PublishTarget = 'game' | 'video' | 'render' | 'model' | 'plan' | 'share' | 'history';

/** Video output presets. */
export const VIDEO_PRESETS = {
  '720p': { label: '720p HD', width: 1280, height: 720 },
  '1080p': { label: '1080p Full HD', width: 1920, height: 1080 },
  square: { label: 'Square 1080', width: 1080, height: 1080 },
  vertical: { label: 'Vertical 9:16', width: 1080, height: 1920 },
} as const;
export type VideoPresetId = keyof typeof VIDEO_PRESETS;

/** Still output presets. */
export const STILL_PRESETS = {
  hd: { label: 'Full HD', width: 1920, height: 1080 },
  qhd: { label: 'QHD 2560 × 1440', width: 2560, height: 1440 },
  uhd: { label: '4K UHD 3840 × 2160', width: 3840, height: 2160 },
  square: { label: 'Square 2048', width: 2048, height: 2048 },
  portrait: { label: 'Portrait 1080 × 1350', width: 1080, height: 1350 },
  story: { label: 'Story 1080 × 1920', width: 1080, height: 1920 },
} as const;
export type StillPresetId = keyof typeof STILL_PRESETS;
/** Largest still side the hub offers. */
export const MAX_STILL_SIDE = 4096;

/** A running or finished job. */
export interface PublishJob {
  kind: PublishTarget;
  label: string;
  /** 0–1, or null when indeterminate. */
  progress: number | null;
  running: boolean;
  error: string | null;
}

/** A finished output ready to download / open. */
export interface PublishResult {
  kind: PublishKind;
  /** Object URL of the file (null for link-only results). */
  url: string | null;
  fileName: string | null;
  mime: string | null;
  size: number;
  detail: string;
  /** A public / LAN / local URL where it can be opened. */
  link?: string;
}

/** Everything the hub shows. */
export interface PublishState {
  open: boolean;
  target: PublishTarget;
  job: PublishJob | null;
  result: PublishResult | null;
  /** Live preview canvas of a video export. */
  previewCanvas: HTMLCanvasElement | null;
  path: CameraPath;
  selected: number | null;
  playhead: number;
  previewing: boolean;
  showPath: boolean;
  directing: boolean;
  directNote: string | null;
  meta: { title: string; description: string; author: string; controls: string };
  music: Mood | null;
  video: { preset: VideoPresetId; fps: 24 | 30 | 60; format: VideoFormat; quality: 1 | 2 | 4; titles: TitleSpec; music: Mood | null; volume: number };
  still: { preset: StillPresetId | 'custom'; width: number; height: number; format: 'png' | 'jpeg' | 'webp'; photoreal: boolean; /** Final render: depth of field, a long refinement and 2× supersampling on top of photoreal. */ final: boolean; /** Path-traced render (global illumination, soft area lights, real glass; converges over many samples). */ pathTraced: boolean; /** Samples per pixel of a path-traced render. */ samples: number; source: 'view' | 'shot' };
  model: { binary: boolean };
  plan: { building: string | null; level: number; format: 'svg' | 'pdf'; scale: 50 | 100 };
  share: { value: string | null; chars: number; fits: boolean; qr: string | null; qrSize: number; note: string | null };
  /** A cooked copy of the world on the public dataset (publish/cook-publish.ts): the share link names it while the world is unchanged. */
  cooked: { status: 'idle' | 'working' | 'done' | 'failed'; progress: number; label: string | null; ref: string | null; startMode: 'play' | 'walkthrough' | 'orbit' };
  /** Where share links point: `<origin><path>/play` of a hosted copy of the studio (or this one). */
  playerBase: string;
  /** This page runs on this computer or the local network: its links do not work elsewhere. */
  playerLocal: boolean;
  game: { includeSave: boolean };
  /** Replay seal (docs/PROOFS.md): published games and share links carry a proof of a deterministic replay. */
  seal: SealState;
  hosting: {
    /** Publishing to hosting / LAN is available (local app, or a paired bridge); null while checking. */
    local: boolean | null;
    /** How it is reached. */
    via: 'local' | 'bridge' | null;
    targets: HostTarget[] | null;
    checking: boolean;
    buildId: string | null;
    buildUrl: string | null;
    deploying: HostId | null;
    log: DeployEvent[];
    lan: LanState | null;
  };
  history: PublishedItem[];
  versions: SnapshotInfo[];
}

/** What the controller needs from the studio. */
/** State of the replay seal shown in the publish hub. */
export interface SealState {
  /** Seal published games and share links (default on). */
  on: boolean;
  /** Sign with this browser's key (default on). */
  sign: boolean;
  status: 'idle' | 'sealing' | 'sealed' | 'failed';
  /** What happened, in plain words (null while idle). */
  note: string | null;
  /** Short content hash of the last seal. */
  hash: string | null;
  /** Short id of the signing key, when signed. */
  keyId: string | null;
}

export interface PublishHost {
  readonly store: StoreApi<StudioState>;
  readonly history: History;
  readonly simulation: Simulation | null;
  readonly projectId: string | null;
  onSimulation(fn: (sim: Simulation | null) => void): () => void;
  replaceWorld(world: WorldDoc, message: string): void;
  /** A language model for the camera director (null: offline parser only). */
  directorProvider(): Provider | null;
  /** The user's imports the world references (for game builds). */
  bundledImports(): Promise<Array<{ meta: { id: string; mime: string } & Record<string, unknown>; data: Uint8Array }>>;
  /** The paired local bridge (hosted studios), or null. */
  bridgeEndpoint(): { url: string; token: string } | null;
  /** The playtest bot's proof for the world on screen (a real passed run on exactly this world), or null. Optional: hosts without a playtest omit it. */
  playtestProof?(): Promise<BotProof | null>;
}

function initialState(world: WorldDoc): PublishState {
  return {
    open: false,
    target: 'game',
    job: null,
    result: null,
    previewCanvas: null,
    path: { v: 1, name: 'Shot', duration: 8, keys: [{ t: 0, pos: [12, 9, 16], target: [0, 1, 0], fov: DEFAULT_FOV, ease: 'linear' }], easeInOut: true },
    selected: null,
    playhead: 0,
    previewing: false,
    showPath: true,
    directing: false,
    directNote: null,
    meta: { title: defaultTitle(world), description: defaultDescription(world), author: '', controls: defaultControls(world) },
    music: null,
    video: { preset: '1080p', fps: 30, format: 'auto', quality: 1, titles: defaultTitles(defaultTitle(world)), music: 'cinematic', volume: 0.7 },
    still: { preset: 'hd', width: 1920, height: 1080, format: 'png', photoreal: false, final: false, pathTraced: false, samples: 256, source: 'view' },
    model: { binary: true },
    plan: { building: null, level: 0, format: 'svg', scale: 50 },
    share: { value: null, chars: 0, fits: true, qr: null, qrSize: 0, note: null },
    cooked: { status: 'idle', progress: 0, label: null, ref: null, startMode: 'play' },
    playerBase: initialPlayerBase(),
    playerLocal: isLocalUrl(initialPlayerBase()),
    game: { includeSave: false },
    seal: { on: true, sign: true, status: 'idle', note: null, hash: null, keyId: null },
    hosting: { local: null, via: null, targets: null, checking: false, buildId: null, buildUrl: null, deploying: null, log: [], lan: null },
    history: [],
    versions: [],
  };
}

/** Download a blob under `name` (temporary object URL). */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'world'
  );
}

function sizeLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException ? e.name === 'AbortError' : e instanceof Error && /cancelled|aborted/i.test(e.message);
}

/** The controller (see module docs). */
export class PublishController {
  readonly state: StoreApi<PublishState>;
  private abort: AbortController | null = null;
  private cookAbort: AbortController | null = null;
  private objectUrl: string | null = null;
  private raf = 0;
  private previewStart = 0;
  private previewFrom = 0;
  private savedCamera: { pos: Vec3; target: Vec3; fov: number } | null = null;
  private readonly cleanups: Array<() => void> = [];
  private pathTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** How hosting / LAN requests reach the local app (null: unavailable). */
  private transport: PublishTransport | null = null;
  /** The user typed a title (until then titles follow the world's name). */
  private titleEdited = false;
  private videoTitleEdited = false;
  private readonly pose = newPose();
  private compiled: CompiledPath | null = null;

  constructor(private readonly host: PublishHost) {
    this.state = createStore<PublishState>()(() => initialState(host.history.current));
    this.cleanups.push(
      this.state.subscribe((s, prev) => {
        if (s.path !== prev.path || s.open !== prev.open || s.target !== prev.target || s.showPath !== prev.showPath || s.selected !== prev.selected) this.drawPath();
        if (s.path !== prev.path) {
          this.compiled = null;
          this.schedulePathSave();
        }
      }),
      host.history.subscribe(() => {
        // A share link describes one version of the world: an edit makes it stale.
        const st = this.state.getState();
        if (st.share.value) this.state.setState({ share: { ...st.share, value: null, qr: null, note: null } });
        if (st.cooked.status !== 'idle') {
          this.cookAbort?.abort();
          this.state.setState({ cooked: { ...st.cooked, status: 'idle', progress: 0, label: null, ref: null } });
        }
      }),
      host.onSimulation((sim) => {
        if (sim) this.drawPath();
      }),
    );
    void this.loadSaved();
  }

  private get sim(): Simulation | null {
    return this.host.simulation;
  }

  private toast(text: string, kind: 'info' | 'success' | 'error' = 'info', seconds?: number): void {
    this.host.store.getState().toast(text, kind, seconds);
  }

  private set(patch: Partial<PublishState>): void {
    this.state.setState(patch);
  }

  /** Restore the project's camera path and refresh history / versions. */
  private async loadSaved(): Promise<void> {
    const lib = await publishLibrary();
    const id = this.host.projectId;
    if (id) {
      const p = await lib.path(id);
      if (p && !this.disposed) this.set({ path: p });
    }
    this.cleanups.push(lib.subscribe(() => void this.refreshHistory()));
    await this.refreshHistory();
  }

  private schedulePathSave(): void {
    const id = this.host.projectId;
    if (!id) return;
    if (this.pathTimer) clearTimeout(this.pathTimer);
    this.pathTimer = setTimeout(() => {
      void publishLibrary().then((lib) => lib.savePath(id, this.state.getState().path));
    }, 800);
  }

  // ---------------------------------------------------------------------------
  // Hub
  // ---------------------------------------------------------------------------

  /** Open the hub (optionally on a target). */
  open(target?: PublishTarget): void {
    const world = this.host.history.current;
    const st = this.state.getState();
    const buildings = listBuildings(world);
    const plan = st.plan.building && buildings.some((b) => b.id === st.plan.building) ? st.plan : { ...st.plan, building: buildings[0]?.id ?? null, level: 0 };
    const meta = this.titleEdited && st.meta.title ? st.meta : { ...st.meta, title: defaultTitle(world), description: st.meta.description || defaultDescription(world), controls: st.meta.controls || defaultControls(world) };
    const video = this.videoTitleEdited ? st.video : { ...st.video, titles: { ...st.video.titles, title: defaultTitle(world) } };
    this.set({ open: true, plan, meta, video, ...(target ? { target } : {}) });
    // A first visit gets a shot that starts at the current view.
    if (st.path.keys.length === 1 && st.path.keys[0]?.pos.join() === '12,9,16') this.resetPath();
    if (target === 'share' || (!target && st.target === 'share')) void this.makeShareLink();
    void this.refreshHistory();
    void this.checkHosting();
  }

  /** Close the hub (stops a preview; a running job continues). */
  close(): void {
    this.stopPreview();
    this.set({ open: false });
  }

  /** Switch section. */
  setTarget(target: PublishTarget): void {
    if (target !== 'video') this.stopPreview();
    this.set({ target, result: this.state.getState().job?.running ? this.state.getState().result : null });
    if (target === 'share') void this.makeShareLink();
    if (target === 'history') void this.refreshHistory();
  }

  /** Title-screen text (shared by game builds and share links). */
  setMeta(patch: Partial<PublishState['meta']>): void {
    if (patch.title !== undefined) this.titleEdited = true;
    this.set({ meta: { ...this.state.getState().meta, ...patch }, share: { ...this.state.getState().share, value: null, qr: null } });
  }

  setMusic(mood: Mood | null): void {
    this.set({ music: mood, share: { ...this.state.getState().share, value: null, qr: null } });
  }

  setVideo(patch: Partial<PublishState['video']>): void {
    this.set({ video: { ...this.state.getState().video, ...patch } });
  }

  setTitles(patch: Partial<TitleSpec>): void {
    if (patch.title !== undefined) this.videoTitleEdited = true;
    const v = this.state.getState().video;
    this.set({ video: { ...v, titles: { ...v.titles, ...patch } } });
  }

  setStill(patch: Partial<PublishState['still']>): void {
    const s = { ...this.state.getState().still, ...patch };
    if (patch.preset && patch.preset !== 'custom') {
      const p = STILL_PRESETS[patch.preset];
      s.width = p.width;
      s.height = p.height;
    }
    s.width = Math.max(64, Math.min(MAX_STILL_SIDE, Math.round(s.width) || 1920));
    s.height = Math.max(64, Math.min(MAX_STILL_SIDE, Math.round(s.height) || 1080));
    this.set({ still: s });
  }

  setModel(patch: Partial<PublishState['model']>): void {
    this.set({ model: { ...this.state.getState().model, ...patch } });
  }

  setPlan(patch: Partial<PublishState['plan']>): void {
    this.set({ plan: { ...this.state.getState().plan, ...patch } });
  }

  setGame(patch: Partial<PublishState['game']>): void {
    this.set({ game: { ...this.state.getState().game, ...patch } });
  }

  setSeal(patch: Partial<Pick<SealState, 'on' | 'sign'>>): void {
    this.sealCache = null;
    const st = this.state.getState();
    this.set({ seal: { ...st.seal, ...patch, status: 'idle', note: null, hash: null, keyId: null }, share: { ...st.share, value: null, qr: null, note: null } });
  }

  /** The last seal attempt, keyed by the exact world and signing choice (a seal is reused until either changes). */
  private sealCache: { world: WorldDoc; sign: boolean; bot: string | null; proof: Promise<Proof | null> } | null = null;

  /**
   * Replay the current world and seal the outcome (null when sealing is off,
   * failed, or some check fails: a failing world is never sealed as playable).
   * Cached per world version. Never throws.
   */
  async sealCurrent(signal?: AbortSignal): Promise<Proof | null> {
    const st = this.state.getState().seal;
    if (!st.on) return null;
    let playtest: BotProof | null = null;
    try {
      playtest = (await this.host.playtestProof?.()) ?? null;
    } catch {
      playtest = null;
    }
    const world = this.host.history.current;
    const botKey = playtest?.worldHash ?? null;
    if (this.sealCache && this.sealCache.world === world && this.sealCache.sign === st.sign && this.sealCache.bot === botKey) return this.sealCache.proof;
    const run = (async (): Promise<Proof | null> => {
      this.set({ seal: { ...this.state.getState().seal, status: 'sealing', note: 'Replaying the physics to seal the world…' } });
      const sim = this.sim;
      let colliders: ColliderProvider | undefined;
      if (sim) {
        try {
          await sim.whenSynced();
          if (sim.syncedWorld === world) colliders = sim.colliders;
        } catch {
          colliders = undefined;
        }
      }
      // The bot's winning run (when there is one for exactly this world) is sealed with the replay: one proof, one story.
      const { sealWorld } = await import('../publish/seal');
      const out = await sealWorld(world, { colliders, sign: st.sign, playtest, ...(signal ? { signal } : {}) });
      if (this.host.history.current !== world) return null;
      if (!out.ok) {
        this.set({ seal: { ...this.state.getState().seal, status: 'failed', note: `Not sealed: ${out.error}`, hash: null, keyId: null } });
        return null;
      }
      const { keyId } = await import('@aether/verifier');
      const proof = out.proof;
      if (!proof.claim.passed) {
        const failed = proof.claim.tests.filter((t) => !t.passed).length;
        this.set({ seal: { ...this.state.getState().seal, status: 'failed', note: `Not sealed: ${failed > 0 ? `${failed} check${failed === 1 ? '' : 's'} fail` : 'the physics report errors'}. Fix them and publish again.`, hash: null, keyId: null } });
        return null;
      }
      this.set({
        seal: {
          ...this.state.getState().seal,
          status: 'sealed',
          note: `Sealed playable: ${proof.claim.tests.length === 0 ? 'settles cleanly' : `${proof.claim.tests.length} check${proof.claim.tests.length === 1 ? '' : 's'} passed`} over ${proof.claim.simulatedSeconds.toFixed(1)} s${proof.playtest ? `, and a bot played it to the win in ${Math.round(proof.playtest.seconds)} s` : ''}${out.signed ? ', signed with this browser\'s key' : ''}. A deterministic replay check, not a formal proof.`,
          hash: proof.hash.slice(7, 19),
          keyId: proof.signature ? keyId(proof.signature.publicKey) : null,
        },
      });
      return proof;
    })();
    this.sealCache = { world, sign: st.sign, bot: botKey, proof: run };
    return run;
  }

  // ---------------------------------------------------------------------------
  // Camera path (the video shot)
  // ---------------------------------------------------------------------------

  private presetScene(): PresetScene | null {
    const sim = this.sim;
    if (!sim) return null;
    const r = sim.renderer;
    const cam = r.cameraPose();
    const f = r.contentSphere;
    return { center: f ? [f.center[0], f.center[1], f.center[2]] : cam.target, radius: f ? f.radius : 10, camera: cam, floorY: Math.max(0.3, r.cameraFloorY) };
  }

  /** Replace the path with one key at the current view. */
  resetPath(): void {
    const sim = this.sim;
    if (!sim) return;
    this.set({ path: stillPath(sim.renderer.cameraPose(), this.state.getState().path.duration), selected: 0, playhead: 0 });
  }

  /** Apply a preset shot. */
  applyPreset(id: PresetId): void {
    const scene = this.presetScene();
    if (!scene) return;
    this.stopPreview();
    this.set({ path: presetPath(id, scene), selected: null, playhead: 0, directNote: null });
    this.startPreview();
  }

  /** Add (or replace) a keyframe from the current view at the playhead. */
  addKeyFromView(): void {
    const sim = this.sim;
    if (!sim) return;
    this.stopPreview();
    const st = this.state.getState();
    const cam = sim.renderer.cameraPose();
    let t = st.playhead;
    // At the end of the timeline, a new key extends the shot by 3 s.
    if (st.path.keys.some((k) => Math.abs(k.t - t) < 1e-3) && t >= st.path.duration - 1e-3 && st.path.keys.length > 1) t = Math.min(300, st.path.duration + 3);
    const ease = st.path.keys.find((k) => Math.abs(k.t - t) < 1e-3)?.ease ?? 'linear';
    const path = upsertKey(st.path, { t, pos: cam.pos, target: cam.target, fov: cam.fov, ease });
    this.set({ path, selected: path.keys.findIndex((k) => Math.abs(k.t - t) < 1e-3), playhead: t });
  }

  /** Move key `i` to the current view. */
  updateKeyFromView(i: number): void {
    const sim = this.sim;
    const st = this.state.getState();
    const k = st.path.keys[i];
    if (!sim || !k) return;
    const cam = sim.renderer.cameraPose();
    this.set({ path: upsertKey(st.path, { ...k, pos: cam.pos, target: cam.target, fov: cam.fov }) });
  }

  deleteKey(i: number): void {
    const st = this.state.getState();
    this.set({ path: removeKey(st.path, i), selected: null });
  }

  selectKey(i: number | null): void {
    const st = this.state.getState();
    const k = i === null ? null : st.path.keys[i];
    this.set({ selected: k ? i : null, ...(k ? { playhead: k.t } : {}) });
    if (k) this.sim?.renderer.lookAt(k.pos, k.target, k.fov);
  }

  setKeyEase(i: number, ease: Easing): void {
    const st = this.state.getState();
    const k = st.path.keys[i];
    if (!k) return;
    this.set({ path: { ...st.path, keys: st.path.keys.map((x, j) => (j === i ? { ...x, ease } : x)) } });
  }

  setKeyFov(i: number, fov: number): void {
    const st = this.state.getState();
    if (!st.path.keys[i] || !Number.isFinite(fov)) return;
    const f = Math.min(100, Math.max(12, fov));
    this.set({ path: { ...st.path, keys: st.path.keys.map((x, j) => (j === i ? { ...x, fov: f } : x)) } });
    const k = this.state.getState().path.keys[i];
    if (k) this.sim?.renderer.lookAt(k.pos, k.target, k.fov);
  }

  retime(i: number, t: number): void {
    const st = this.state.getState();
    const path = retimeKey(st.path, i, t);
    const moved = st.path.keys[i];
    const at = moved ? path.keys.findIndex((x) => x.pos === moved.pos) : -1;
    this.set({ path, selected: at >= 0 ? at : null });
  }

  setDuration(d: number): void {
    this.set({ path: rescalePath(this.state.getState().path, d) });
  }

  setEaseInOut(on: boolean): void {
    this.set({ path: { ...this.state.getState().path, easeInOut: on } });
  }

  setShowPath(on: boolean): void {
    this.set({ showPath: on });
  }

  /** Put the camera at time `t` of the shot (scrubbing). */
  scrub(t: number): void {
    const st = this.state.getState();
    const time = Math.min(st.path.duration, Math.max(0, Number.isFinite(t) ? t : 0));
    this.set({ playhead: time });
    if (st.previewing) {
      this.previewFrom = time;
      this.previewStart = performance.now();
      return;
    }
    this.place(time);
  }

  private place(t: number): void {
    const sim = this.sim;
    if (!sim) return;
    this.compiled ??= new CompiledPath(this.state.getState().path);
    this.compiled.sample(t, this.pose);
    sim.renderer.lookAt(this.pose.pos, this.pose.target, this.pose.fov);
    sim.touch();
  }

  /** Play the shot in the viewport (from the playhead, or the start at the end). */
  startPreview(): void {
    const sim = this.sim;
    const st = this.state.getState();
    if (!sim || st.previewing || st.path.keys.length < 2) return;
    if (sim.mode === 'play') return;
    this.savedCamera ??= sim.renderer.cameraPose();
    this.previewFrom = st.playhead >= st.path.duration - 0.05 ? 0 : st.playhead;
    this.previewStart = performance.now();
    this.set({ previewing: true });
    const tick = (): void => {
      if (this.disposed || !this.state.getState().previewing) return;
      const s = this.state.getState();
      const t = this.previewFrom + (performance.now() - this.previewStart) / 1000;
      if (t >= s.path.duration) {
        this.place(s.path.duration);
        this.set({ previewing: false, playhead: s.path.duration });
        this.raf = 0;
        return;
      }
      this.place(t);
      // The playhead moves at a few Hz in the UI (no React render per frame).
      if (Math.abs(t - s.playhead) > 0.1) this.set({ playhead: t });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Stop the preview where it is. */
  stopPreview(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.state.getState().previewing) this.set({ previewing: false });
  }

  /** Toggle the preview. */
  togglePreview(): void {
    if (this.state.getState().previewing) this.stopPreview();
    else this.startPreview();
  }

  /** Put the editor camera back where it was before previews (and the normal field of view). */
  restoreCamera(): void {
    this.stopPreview();
    const c = this.savedCamera;
    this.savedCamera = null;
    if (c) this.sim?.renderer.lookAt(c.pos, c.target, c.fov);
  }

  /** Draw (or hide) the path over the viewport. */
  private drawPath(): void {
    const sim = this.sim;
    if (!sim) return;
    const st = this.state.getState();
    if (!st.open || st.target !== 'video' || !st.showPath || st.path.keys.length < 2) {
      sim.renderer.showCameraPath(null, null);
      return;
    }
    const c = new CompiledPath(st.path);
    const n = Math.min(400, Math.max(32, Math.round(st.path.duration * 24)));
    const pts = new Float32Array((n + 1) * 3);
    const p = newPose();
    for (let i = 0; i <= n; i++) {
      c.sample((i / n) * st.path.duration, p);
      pts[i * 3] = p.pos[0];
      pts[i * 3 + 1] = p.pos[1];
      pts[i * 3 + 2] = p.pos[2];
    }
    const keys = new Float32Array(st.path.keys.length * 6);
    st.path.keys.forEach((k, i) => keys.set([...k.pos, ...k.target], i * 6));
    const f = sim.renderer.contentSphere;
    sim.renderer.showCameraPath(pts, keys, Math.max(0.15, (f?.radius ?? 10) * 0.02));
  }

  /** What the director can talk about: rooms, buildings (and their roofs), named objects, the scene. */
  directorScene(): DirectorScene | null {
    const sim = this.sim;
    const scene = this.presetScene();
    if (!sim || !scene) return null;
    const world = this.host.history.current;
    const subjects: Subject[] = [];
    for (const b of listBuildings(world).slice(0, 8)) {
      const bounds = sim.entityBounds(b.id);
      const be = world.entities[b.id];
      if (bounds) subjects.push({ name: b.name, aliases: ['building', 'house', 'roof', 'home', 'villa'], kind: 'building', min: bounds.min, max: bounds.max });
      if (!be) continue;
      const origin: [number, number] = [be.transform.position[0], be.transform.position[2]];
      const yaw = be.transform.rotation[1];
      for (const lvl of listLevels(world, b.id).slice(0, 8)) {
        const plan = floorPlan2d(world, b.id, lvl.index);
        const lvlEntity = world.entities[lvl.id];
        const floorY = be.transform.position[1] + (lvlEntity?.transform.position[1] ?? 0);
        for (const room of plan?.rooms.slice(0, 40) ?? []) {
          const pts = room.polygon.map((q) => planToWorld(origin, yaw, q));
          if (pts.length === 0) continue;
          const xs = pts.map((q) => q[0]);
          const zs = pts.map((q) => q[1]);
          subjects.push({ name: room.name, aliases: [room.kind.replace(/-/g, ' '), `${lvl.name} ${room.name}`], kind: 'room', min: [Math.min(...xs), floorY, Math.min(...zs)], max: [Math.max(...xs), floorY + lvl.height, Math.max(...zs)] });
        }
      }
    }
    for (const e of Object.values(world.entities)) {
      if (subjects.length >= 80) break;
      if (e.arch || e.template || !e.name || e.parent) continue;
      const bounds = sim.entityBounds(e.id);
      if (bounds) subjects.push({ name: e.name, aliases: [e.id.replace(/-/g, ' '), ...e.tags], kind: 'object', min: bounds.min, max: bounds.max });
    }
    return { center: scene.center, radius: scene.radius, floorY: scene.floorY, subjects, camera: scene.camera };
  }

  /**
   * Direct a shot from plain language. A connected model writes a shot plan
   * (validated; it never places the camera itself), else the offline parser
   * does; either way the resolver turns it into keyframes.
   */
  async direct(text: string): Promise<void> {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 600);
    if (!clean) return;
    const scene = this.directorScene();
    if (!scene) return;
    this.stopPreview();
    this.set({ directing: true, directNote: null });
    try {
      const { directOffline, directorPrompt, parseModelPlan, resolvePlan } = await import('../publish/director');
      let path: CameraPath | null = null;
      let via = 'offline director';
      const provider = this.host.directorProvider();
      if (provider) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 30_000);
          const res = await provider.complete({ role: 'planner', system: directorPrompt(scene.subjects), messages: [{ role: 'user', content: clean }], maxTokens: 900 }, ctrl.signal).finally(() => clearTimeout(timer));
          const textOut = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
          const plan = parseModelPlan(textOut);
          if (plan) {
            path = resolvePlan(plan, scene, clean.slice(0, 60));
            via = res.model ? `AI director (${res.model})` : 'AI director';
          }
        } catch (e) {
          log.warn('AI director failed, using the offline one', e);
        }
      }
      path ??= directOffline(clean, scene);
      if (!path) {
        this.set({ directNote: 'No camera move found. Try “slow orbit around the tower” or “dolly through the kitchen then rise above the roof”.' });
        return;
      }
      this.set({ path: normalizePath(path), selected: null, playhead: 0, directNote: `${path.keys.length} keyframes · ${path.duration.toFixed(1)} s · ${via}` });
      this.startPreview();
    } finally {
      this.set({ directing: false });
    }
  }

  // ---------------------------------------------------------------------------
  // Jobs
  // ---------------------------------------------------------------------------

  private begin(kind: PublishTarget, label: string): AbortSignal | null {
    if (this.state.getState().job?.running) {
      this.toast('Another export is running. Wait for it or cancel it.', 'info', 4);
      return null;
    }
    this.stopPreview();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.abort = new AbortController();
    this.set({ job: { kind, label, progress: null, running: true, error: null }, result: null, previewCanvas: null });
    return this.abort.signal;
  }

  private progress(label: string, progress: number | null): void {
    const j = this.state.getState().job;
    if (j?.running) this.set({ job: { ...j, label, progress: progress === null ? null : Math.max(0, Math.min(1, progress)) } });
  }

  private finish(result: PublishResult | null, error: string | null = null): void {
    const j = this.state.getState().job;
    this.abort = null;
    this.set({ job: j ? { ...j, running: false, error, progress: error ? j.progress : 1 } : null, result, previewCanvas: null });
  }

  /** Cancel the running job (and a running deploy). */
  cancel(): void {
    this.abort?.abort();
  }

  private async record(kind: PublishKind, blob: Blob | null, info: { fileName?: string; mime?: string; detail: string; url?: string; thumb?: string; title?: string }): Promise<void> {
    const lib = await publishLibrary();
    await lib.add({
      projectId: this.host.projectId,
      kind,
      title: info.title ?? this.host.history.current.name,
      detail: info.detail,
      ...(info.fileName ? { fileName: info.fileName } : {}),
      ...(info.mime ? { mime: info.mime } : {}),
      ...(info.url ? { url: info.url } : {}),
      ...(info.thumb ? { thumb: info.thumb } : {}),
      blob,
    });
  }

  private resultFor(kind: PublishKind, blob: Blob, fileName: string, detail: string, link?: string): PublishResult {
    this.objectUrl = URL.createObjectURL(blob);
    return { kind, url: this.objectUrl, fileName, mime: blob.type, size: blob.size, detail, ...(link ? { link } : {}) };
  }

  private async thumb(): Promise<string | undefined> {
    try {
      const t = await this.sim?.renderer.screenshot({ width: 320, height: 180, mime: 'image/jpeg' });
      return t && t.length < 75_000 ? t : undefined;
    } catch {
      return undefined;
    }
  }

  private ensureEditMode(): boolean {
    if (this.sim?.mode === 'play') {
      this.toast('Stop the game first: publishing works from the editor.', 'info', 4);
      return false;
    }
    if (!this.sim) {
      this.toast('The viewport is still starting.', 'info', 3);
      return false;
    }
    return true;
  }

  /** Export the shot as a video. */
  async exportVideo(): Promise<void> {
    if (!this.ensureEditMode()) return;
    const st = this.state.getState();
    if (st.path.keys.length < 2) {
      this.toast('Add at least two keyframes (or pick a preset) first.', 'info', 4);
      return;
    }
    const signal = this.begin('video', 'Preparing the video…');
    if (!signal) return;
    const sim = this.sim as Simulation;
    const preset = VIDEO_PRESETS[st.video.preset];
    try {
      const { exportVideo } = await import('../publish/video/export');
      const r = await exportVideo(sim.renderer, {
        width: preset.width,
        height: preset.height,
        fps: st.video.fps,
        path: st.path,
        format: st.video.format,
        quality: st.video.quality,
        titles: st.video.titles,
        music: st.video.music ? { mood: st.video.music, volume: st.video.volume } : null,
        seed: this.host.history.current.name,
        signal,
        onCanvas: (canvas) => this.set({ previewCanvas: canvas }),
        onProgress: (p) => this.progress(p.phase === 'rendering' ? `Rendering frame ${p.frame} of ${p.frames}` : p.phase === 'preparing' ? 'Preparing…' : p.phase === 'encoding' ? 'Finishing the encode…' : 'Writing the file…', p.frames > 0 ? (p.phase === 'rendering' ? (p.frame / p.frames) * 0.95 : p.phase === 'preparing' ? 0 : 0.97) : null),
      });
      const name = `${slugOf(this.host.history.current.name)}-${st.path.name ? slugOf(st.path.name) : 'shot'}.${r.ext}`;
      const detail = `${r.width}×${r.height} · ${r.fps} fps · ${r.seconds.toFixed(1)} s · ${r.ext.toUpperCase()}${r.audio ? ' + music' : ''} · ${sizeLabel(r.blob.size)}`;
      this.finish(this.resultFor('video', r.blob, name, detail));
      void this.record('video', r.blob, { fileName: name, mime: r.mime, detail, ...(await this.thumbOpt()) });
      this.toast(`Video ready: ${detail}`, 'success', 5);
    } catch (e) {
      this.finish(null, isAbort(e) ? 'Cancelled.' : `The video could not be made: ${errorMessage(e)}`);
    }
  }

  private async thumbOpt(): Promise<{ thumb?: string }> {
    const t = await this.thumb();
    return t ? { thumb: t } : {};
  }

  /** Render a still image. */
  async exportStill(): Promise<void> {
    if (!this.ensureEditMode()) return;
    const st = this.state.getState();
    const signal = this.begin('render', 'Rendering…');
    if (!signal) return;
    const sim = this.sim as Simulation;
    const r = sim.renderer;
    const prevQuality = r.renderQuality;
    try {
      const cam = r.cameraPose();
      const first = st.path.keys[0];
      const pose = st.still.source === 'shot' && first ? { pos: first.pos, target: first.target, fov: first.fov } : cam;
      const photoreal = st.still.photoreal && r.studioQualityAvailable;
      const final = photoreal && st.still.final;
      if (photoreal) r.setRenderQuality(final ? 'final' : 'studio');
      await r.preparePost();
      const traced = st.still.pathTraced;
      const plan = photoreal && !traced ? r.planStill(st.still.width, st.still.height, final ? 'final' : 'studio') : null;
      const img = traced
        ? await r.pathTraceStill({
            width: st.still.width,
            height: st.still.height,
            samples: st.still.samples,
            pose,
            ...(st.still.final ? { fStop: 5.6 } : {}),
            signal,
            onProgress: (done, total, phase) =>
              phase === 'sample'
                ? this.progress(`Path tracing: sample ${done} of ${total}`, done / total)
                : this.progress(phase === 'build' ? 'Preparing the scene…' : 'Compiling the path tracer (the first render of a session takes a moment)…', null),
          })
        : await r.renderStill({
            width: st.still.width,
            height: st.still.height,
            pose,
            frames: plan?.frames ?? 1,
            tileSize: plan?.tileSize ?? 2048,
            ...(plan && plan.supersample > 1 ? { supersample: plan.supersample } : {}),
            signal,
            onProgress: (done, total) => this.progress(`Rendering tile ${done} of ${total}`, done / total),
          });
      this.progress('Encoding…', null);
      const blob = await encodeImage(img.data, img.width, img.height, st.still.format);
      // A browser without the requested encoder returns PNG: name the file after what it holds.
      const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
      const name = `${slugOf(this.host.history.current.name)}-${img.width}x${img.height}.${ext}`;
      const detail = `${img.width}×${img.height} · ${ext.toUpperCase()}${traced ? ` · path traced, ${st.still.samples} samples` : final ? ' · final render' : photoreal ? ' · photoreal' : ''} · ${sizeLabel(blob.size)}`;
      this.finish(this.resultFor('render', blob, name, detail));
      void this.record('render', blob, { fileName: name, mime: blob.type, detail, ...(await this.thumbOpt()) });
      this.toast(`Render ready: ${detail}`, 'success', 4);
    } catch (e) {
      this.finish(null, isAbort(e) ? 'Cancelled.' : `The render failed: ${errorMessage(e)}`);
    } finally {
      if (r.renderQuality !== prevQuality) r.setRenderQuality(prevQuality);
    }
  }

  /** Export the scene as GLB / glTF. */
  async exportModel(): Promise<void> {
    if (!this.ensureEditMode()) return;
    const st = this.state.getState();
    const signal = this.begin('model', 'Exporting the 3D model…');
    if (!signal) return;
    try {
      const r = await (this.sim as Simulation).renderer.exportGltf({ binary: st.model.binary });
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
      const binary = typeof r.data !== 'string';
      const blob = new Blob([r.data as BlobPart], { type: binary ? 'model/gltf-binary' : 'model/gltf+json' });
      const name = `${slugOf(this.host.history.current.name)}.${binary ? 'glb' : 'gltf'}`;
      // Every export is parsed back with the glTF loader before it is offered.
      this.progress('Verifying the file…', 0.9);
      const { verifyGltf } = await import('@aether/render');
      const check = await verifyGltf(r.data);
      if (check.meshes === 0) throw new Error('the exported file contains no meshes');
      const detail = `${check.meshes} meshes · ${check.materials} materials · ${check.triangles.toLocaleString()} triangles${r.skipped > 0 ? ` (${r.skipped} over the budget left out)` : ''} · ${sizeLabel(blob.size)} · verified`;
      this.finish(this.resultFor('model', blob, name, detail));
      void this.record('model', blob, { fileName: name, mime: blob.type, detail, ...(await this.thumbOpt()) });
      this.toast(`Model ready: ${detail}`, 'success', 4);
    } catch (e) {
      this.finish(null, isAbort(e) ? 'Cancelled.' : `The export failed: ${errorMessage(e)}`);
    }
  }

  /** Export the floor plan as SVG / PDF. */
  async exportPlan(): Promise<void> {
    const st = this.state.getState();
    const world = this.host.history.current;
    const building = st.plan.building ?? listBuildings(world)[0]?.id ?? null;
    const plan = building ? floorPlan2d(world, building, st.plan.level) : null;
    if (!plan) {
      this.toast('This world has no building with a floor plan.', 'info', 4);
      return;
    }
    const signal = this.begin('plan', 'Drawing the floor plan…');
    if (!signal) return;
    try {
      const { planDrawing, planSvg } = await import('../publish/floorplan');
      const name = listBuildings(world).find((b) => b.id === building)?.name ?? world.name;
      const drawing = planDrawing(plan, { title: `${name} — ${plan.levelName}`, subtitle: `${plan.levelName} · 1:${st.plan.scale}` });
      let blob: Blob;
      if (st.plan.format === 'pdf') {
        const { planPdf } = await import('../publish/pdf');
        blob = new Blob([planPdf(drawing, st.plan.scale) as BlobPart], { type: 'application/pdf' });
      } else {
        blob = new Blob([planSvg(drawing, st.plan.scale)], { type: 'image/svg+xml' });
      }
      const fileName = `${slugOf(name)}-${slugOf(plan.levelName)}-plan.${st.plan.format}`;
      const detail = `${plan.levelName} · ${plan.rooms.length} rooms · 1:${st.plan.scale} · ${st.plan.format.toUpperCase()} · ${sizeLabel(blob.size)}`;
      this.finish(this.resultFor('plan', blob, fileName, detail));
      void this.record('plan', blob, { fileName, mime: blob.type, detail });
    } catch (e) {
      this.finish(null, `The floor plan failed: ${errorMessage(e)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Share link
  // ---------------------------------------------------------------------------

  /** Base URL of the player share links point to. */
  playerBase(): string {
    return this.state.getState().playerBase;
  }

  /**
   * Point share links at another player (a hosted copy of the studio).
   * Returns an error message, or null when accepted (and remembered).
   */
  setPlayerBase(input: string): string | null {
    const base = normalizePlayerBase(input);
    if (!base) return 'Enter an https:// address of a hosted copy of Aether (or http://localhost).';
    try {
      localStorage.setItem(PLAYER_BASE_KEY, base);
    } catch {
      /* remembered for this visit only */
    }
    this.set({ playerBase: base, playerLocal: isLocalUrl(base), share: { ...this.state.getState().share, value: null, qr: null, note: null } });
    return null;
  }

  /** Encode the share link (and its QR code when it fits one). */
  async makeShareLink(): Promise<void> {
    const st = this.state.getState();
    const world = this.host.history.current;
    try {
      const [{ cleanMeta, encodeShare, LONG_LINK_CHARS, shareUrl }, { encodeQr, qrPath }] = await Promise.all([import('../publish/share'), import('../publish/qr')]);
      const meta = cleanMeta({ title: st.meta.title || world.name, description: st.meta.description, author: st.meta.author, controls: st.meta.controls, ...(st.music ? { music: st.music } : {}) });
      const proof = await this.sealCurrent();
      if (this.host.history.current !== world) return;
      const enc = await encodeShare(world, meta, proof);
      const url = shareUrl(this.playerBase(), enc.value) + this.cookedSuffix();
      let qr: string | null = null;
      let qrSize = 0;
      if (enc.fits && url.length <= 2900) {
        const code = encodeQr(url, { ecc: 'L' });
        if (code) {
          qr = qrPath(code, 4);
          qrSize = code.size + 8;
        }
      }
      const imports = world.entities ? Object.values(world.entities).filter((e) => e.shape.kind === 'asset' && /^user-/.test((e.shape as { id?: string }).id ?? '')).length : 0;
      const notes: string[] = [];
      if (!enc.fits) notes.push('This world is too large for a link (over 1.5 MB). Download the game or publish it to your hosting instead.');
      else if (enc.chars > 1_000_000) notes.push('Firefox opens links up to about 1 MB and this one is larger: for Firefox players, download the game or publish it to your hosting.');
      else if (enc.chars > LONG_LINK_CHARS) notes.push('This is a long link: it works in browsers, but some chat apps cut long links. A downloaded or hosted game always works.');
      if (!qr && enc.fits) notes.push('Too long for a QR code: share the link itself.');
      if (proof && !enc.sealed) notes.push('The replay seal is too large for a link: publish the game to include it.');
      if (imports > 0) notes.push(`${imports} imported file${imports > 1 ? 's' : ''} cannot travel in a link and show as stand-ins. Publish the game to include them.`);
      this.set({ share: { value: enc.fits ? enc.value : null, chars: enc.chars, fits: enc.fits, qr, qrSize, note: notes.join(' ') || null } });
    } catch (e) {
      this.set({ share: { value: null, chars: 0, fits: false, qr: null, qrSize: 0, note: `The link could not be made: ${errorMessage(e)}` } });
    }
  }

  /** The share URL (null until made / too large). */
  shareLink(): string | null {
    const v = this.state.getState().share.value;
    return v ? `${this.playerBase()}#${SHARE_KEY}=${v}${this.cookedSuffix()}` : null;
  }

  /** `&c=<anon>.<world>&m=<start mode>` when a cooked copy of this version of the world is published. */
  private cookedSuffix(): string {
    const c = this.state.getState().cooked;
    return c.status === 'done' && c.ref ? `&c=${c.ref}&m=${c.startMode}` : '';
  }

  /**
   * Cook the world in this browser and publish it to the public dataset (publish/cook-publish.ts, loaded on first use);
   * the share link then opens it cooked. Progress and the outcome go to `state.cooked`; {@link cancelCooked} stops it.
   */
  async publishCooked(): Promise<void> {
    const sim = this.sim;
    if (!sim || this.state.getState().cooked.status === 'working') return;
    const world = this.host.history.current;
    const startMode = world.startMode ?? 'play';
    const ctrl = new AbortController();
    this.cookAbort = ctrl;
    const progress = (p: number, label: string): void => {
      if (!ctrl.signal.aborted) this.set({ cooked: { status: 'working', progress: p, label, ref: null, startMode } });
    };
    progress(0, 'Starting');
    try {
      if (!this.state.getState().share.value) await this.makeShareLink();
      const value = this.state.getState().share.value;
      if (!value) throw new Error('the world does not fit a link');
      const [{ cookAndPublish }, { decodeShare }] = await Promise.all([import('../publish/cook-publish'), import('../publish/share')]);
      // The world exactly as the player reads it from the link: its IR hash is what the cooked load checks.
      const decoded = await decodeShare(value);
      if (!decoded.ok) throw new Error(decoded.error);
      const r = await cookAndPublish({ world: decoded.payload.world, renderer: sim.renderer, startMode, signal: ctrl.signal, onProgress: progress });
      if (ctrl.signal.aborted || this.host.history.current !== world) return;
      this.set({ cooked: { status: 'done', progress: 1, label: `Published: ${r.entries} geometry entries, ${r.programs} shaders, ${sizeLabel(r.bytes)}`, ref: r.ref, startMode } });
      void this.makeShareLink();
    } catch (e) {
      if (ctrl.signal.aborted) return;
      this.set({ cooked: { status: 'failed', progress: 0, label: `Not published: ${errorMessage(e)}`, ref: null, startMode } });
    } finally {
      if (this.cookAbort === ctrl) this.cookAbort = null;
    }
  }

  /** Stop a cooked publish (files already sent stay unreferenced: the manifest goes last). */
  cancelCooked(): void {
    this.cookAbort?.abort();
    this.cookAbort = null;
    this.set({ cooked: { ...this.state.getState().cooked, status: 'idle', progress: 0, label: 'Cancelled.', ref: null } });
  }

  /** `<iframe>` snippet that embeds the player. */
  embedSnippet(): string | null {
    const link = this.shareLink();
    if (!link) return null;
    const title = (this.state.getState().meta.title || this.host.history.current.name).replace(/["<>&]/g, '');
    return `<iframe src="${link}" title="${title}" width="960" height="540" style="border:0;border-radius:12px" allow="fullscreen; gamepad; autoplay" allowfullscreen loading="lazy"></iframe>`;
  }

  /** Copy text and say so. */
  async copy(text: string | null, what: string): Promise<boolean> {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      this.toast(`${what} copied.`, 'success', 2);
      return true;
    } catch {
      this.toast(`Copy failed: select the ${what.toLowerCase()} and copy it by hand.`, 'error', 4);
      return false;
    }
  }

  /** Copy the share link (and remember it in the history). */
  async copyShareLink(): Promise<void> {
    if (!this.state.getState().share.value) await this.makeShareLink();
    const link = this.shareLink();
    if (await this.copy(link, 'Share link')) {
      const blob = link ? new Blob([link], { type: 'text/uri-list' }) : null;
      void this.record('link', blob, { fileName: `${slugOf(this.host.history.current.name)}.link.txt`, mime: 'text/uri-list', detail: `Share link · ${sizeLabel(link?.length ?? 0)}`, ...(await this.thumbOpt()) });
    }
  }

  // ---------------------------------------------------------------------------
  // Game
  // ---------------------------------------------------------------------------

  private async buildGameZip(signal: AbortSignal): Promise<{ zip: Uint8Array; fileName: string; files: number; bytes: number }> {
    const st = this.state.getState();
    const world = this.host.history.current;
    const sim = this.sim;
    let cover: Blob | null = null;
    try {
      const shot = await sim?.renderer.screenshot({ width: 1280, height: 720, mime: 'image/png' });
      if (shot) cover = await (await fetch(shot)).blob();
    } catch {
      cover = null;
    }
    let save: Uint8Array | null = null;
    if (st.game.includeSave && world.voxel && sim?.voxel) {
      try {
        save = await sim.voxel.exportSave(null);
      } catch (e) {
        log.warn('voxel save export failed', e);
      }
    }
    this.progress('Sealing the replay…', null);
    const proof = await this.sealCurrent(signal);
    const { buildGame } = await import('../publish/gameBuild');
    const imports = await this.host.bundledImports();
    const b = await buildGame({
      world,
      title: st.meta.title || world.name,
      description: st.meta.description,
      author: st.meta.author,
      controls: st.meta.controls || defaultControls(world),
      music: st.music,
      cover,
      save,
      imports,
      ...(proof ? { proof } : {}),
      signal,
      onProgress: (done, total, label) => this.progress(label, total > 0 ? (done / total) * 0.9 : null),
    });
    return { zip: b.zip, fileName: b.fileName, files: b.files.length, bytes: b.bytes };
  }

  /** Build the game and download it as a zip. */
  async downloadGame(): Promise<void> {
    if (!this.ensureEditMode()) return;
    const signal = this.begin('game', 'Building the game…');
    if (!signal) return;
    try {
      const b = await this.buildGameZip(signal);
      const blob = new Blob([b.zip as BlobPart], { type: 'application/zip' });
      const detail = `${b.files} files · ${sizeLabel(blob.size)} zipped (${sizeLabel(b.bytes)})`;
      this.finish(this.resultFor('game', blob, b.fileName, detail));
      downloadBlob(blob, b.fileName);
      void this.record('game', blob, { fileName: b.fileName, mime: 'application/zip', detail, title: this.state.getState().meta.title || this.host.history.current.name, ...(await this.thumbOpt()) });
      void this.snapshot('Published as a game');
    } catch (e) {
      this.finish(null, isAbort(e) ? 'Cancelled.' : `The game could not be built: ${errorMessage(e)}`);
    }
  }

  /** Check whether this studio runs in the local app (hosting + LAN), and read the hosting CLIs. */
  async checkHosting(fresh = false): Promise<void> {
    const h = this.state.getState().hosting;
    if (h.checking || (h.local !== null && !fresh)) return;
    this.set({ hosting: { ...h, checking: true } });
    try {
      const { localPublishing, hostTargets, lanStatus } = await import('../publish/hosting');
      let transport: PublishTransport | null = (await localPublishing()) ? { kind: 'local' } : null;
      let targets: HostTarget[] | null = null;
      if (transport) targets = await hostTargets(fresh, transport).catch(() => null);
      else {
        // A hosted studio paired with the local app's bridge publishes through it.
        const b = this.host.bridgeEndpoint();
        if (b) {
          const t: PublishTransport = { kind: 'bridge', url: b.url, token: b.token };
          targets = await hostTargets(fresh, t).catch(() => null);
          if (targets) transport = t;
        }
      }
      this.transport = transport;
      const lan = transport ? await lanStatus(transport).catch(() => null) : null;
      this.set({ hosting: { ...this.state.getState().hosting, local: transport !== null, via: transport?.kind ?? null, targets, lan, checking: false } });
    } catch {
      this.transport = null;
      this.set({ hosting: { ...this.state.getState().hosting, local: false, via: null, checking: false } });
    }
  }

  /** Build the game and add it to the local library (once per world version). */
  private async ensureLibraryBuild(signal: AbortSignal): Promise<{ id: string; url: string | null }> {
    const { uploadBuild } = await import('../publish/hosting');
    const t = this.requireTransport();
    const b = await this.buildGameZip(signal);
    this.progress('Adding the build to the local library…', 0.92);
    const up = await uploadBuild(b.zip, signal, t);
    this.set({ hosting: { ...this.state.getState().hosting, buildId: up.id, buildUrl: up.url } });
    return up;
  }

  private requireTransport(): PublishTransport {
    if (!this.transport) throw new Error('Publishing to your hosting needs the Aether app on your computer (npx aether start).');
    return this.transport;
  }

  /** Deploy the game to the user's own hosting through their CLI. */
  async deploy(target: HostId, opts: { name?: string; itch?: string }): Promise<void> {
    if (!this.ensureEditMode()) return;
    const signal = this.begin('game', 'Building the game…');
    if (!signal) return;
    const hosting = (): PublishState['hosting'] => this.state.getState().hosting;
    this.set({ hosting: { ...hosting(), deploying: target, log: [] } });
    try {
      const { startDeploy, followDeploy, cancelDeploy, isPublicHostUrl } = await import('../publish/hosting');
      const build = await this.ensureLibraryBuild(signal);
      this.progress('Starting the deploy…', 0.94);
      const t = this.requireTransport();
      const job = await startDeploy({ build: build.id, target, ...(opts.name ? { name: opts.name } : {}), ...(opts.itch ? { itch: opts.itch } : {}) }, t);
      const onAbort = (): void => void cancelDeploy(job.id, t);
      signal.addEventListener('abort', onAbort, { once: true });
      const done = await followDeploy(
        job.id,
        (e, j) => {
          this.set({ hosting: { ...hosting(), log: [...hosting().log.slice(-199), e] } });
          if (e.kind === 'step') this.progress(e.text, 0.94 + (j.steps > 0 ? (j.step / j.steps) * 0.06 : 0));
        },
        undefined,
        t,
      );
      signal.removeEventListener('abort', onAbort);
      if (done.state !== 'done' || !done.url || !isPublicHostUrl(done.url)) throw new Error(done.error ?? 'The deploy did not finish.');
      const detail = `${target === 'github' ? 'GitHub Pages' : target === 'itch' ? 'itch.io' : target === 'netlify' ? 'Netlify' : 'Vercel'} · ${done.url}`;
      this.finish({ kind: 'hosting', url: null, fileName: null, mime: null, size: 0, detail, link: done.url });
      void this.record('hosting', null, { detail, url: done.url, title: this.state.getState().meta.title || this.host.history.current.name, ...(await this.thumbOpt()) });
      void this.snapshot(`Published to ${detail.split(' · ')[0]}`);
      this.toast(`Published: ${done.url}`, 'success', 8);
    } catch (e) {
      this.finish(null, isAbort(e) ? 'Cancelled.' : errorMessage(e));
    } finally {
      this.set({ hosting: { ...hosting(), deploying: null } });
    }
  }

  /** Share the game on the local network (or stop). */
  async setLan(on: boolean): Promise<void> {
    const { setLan } = await import('../publish/hosting');
    if (!on) {
      try {
        const lan = await setLan(false, undefined, this.requireTransport());
        this.set({ hosting: { ...this.state.getState().hosting, lan } });
      } catch (e) {
        this.toast(errorMessage(e), 'error', 4);
      }
      return;
    }
    if (!this.ensureEditMode()) return;
    const signal = this.begin('game', 'Building the game…');
    if (!signal) return;
    try {
      const build = await this.ensureLibraryBuild(signal);
      const lan = await setLan(true, build.id, this.requireTransport());
      this.set({ hosting: { ...this.state.getState().hosting, lan } });
      const link = lan.urls[0];
      this.finish({ kind: 'lan', url: null, fileName: null, mime: null, size: 0, detail: link ? `On your network: ${link}` : 'Sharing on your network (no network address found).', ...(link ? { link } : {}) });
      if (link) void this.record('lan', null, { detail: 'Local network', url: link });
    } catch (e) {
      this.finish(null, isAbort(e) ? 'Cancelled.' : errorMessage(e));
    }
  }

  // ---------------------------------------------------------------------------
  // History and versions
  // ---------------------------------------------------------------------------

  async refreshHistory(): Promise<void> {
    const lib = await publishLibrary();
    const id = this.host.projectId;
    const [history, versions] = await Promise.all([lib.items(id ?? null), id ? lib.snapshots(id) : Promise.resolve([])]);
    if (!this.disposed) this.set({ history, versions });
  }

  /** Download a history item's file again. */
  async downloadItem(item: PublishedItem): Promise<void> {
    const blob = await (await publishLibrary()).file(item.id);
    if (!blob) {
      this.toast('That file is no longer stored. Publish again to get it.', 'info', 4);
      return;
    }
    downloadBlob(blob, item.fileName ?? `${slugOf(item.title)}.bin`);
  }

  async removeItem(id: string): Promise<void> {
    await (await publishLibrary()).remove(id);
  }

  /** Save a version of the current world. */
  async snapshot(label: string): Promise<boolean> {
    const id = this.host.projectId;
    if (!id) return false;
    const r = await (await publishLibrary()).snapshot(id, this.host.history.current, label);
    return r !== null;
  }

  /** Restore a version (one undoable change). */
  async restoreVersion(id: string): Promise<void> {
    const world = await (await publishLibrary()).snapshotWorld(id);
    if (!world) {
      this.toast('That version could not be read.', 'error', 4);
      return;
    }
    if (this.sim?.mode === 'play') await this.sim.stop();
    this.host.replaceWorld(world, 'Restore a saved version');
    this.toast('Version restored. Undo brings the previous state back.', 'success', 5);
  }

  async removeVersion(id: string): Promise<void> {
    await (await publishLibrary()).removeSnapshot(id);
  }

  dispose(): void {
    this.disposed = true;
    this.stopPreview();
    this.abort?.abort();
    if (this.pathTimer) clearTimeout(this.pathTimer);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    for (const c of this.cleanups.splice(0)) c();
  }
}

const PLAYER_BASE_KEY = 'aether.publish.player.v1';

/** True for loopback and private-network URLs (links that only work nearby). */
export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '[::1]' || /^127\./.test(h) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith('.local');
  } catch {
    return true;
  }
}

/**
 * Normalize a player address: an https URL (http only for localhost) of a
 * studio deployment, with or without `/play`; null when not acceptable.
 */
export function normalizePlayerBase(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 300) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) return null;
  if (u.username || u.password) return null;
  const path = u.pathname.replace(/\/+$/, '').replace(/\/play(\.html)?$/, '');
  if (!/^(\/[A-Za-z0-9._~-]+)*$/.test(path)) return null;
  return `${u.origin}${path}/play`;
}

/** The player address: remembered choice, else a build-time default, else this origin. */
function initialPlayerBase(): string {
  try {
    const saved = localStorage.getItem(PLAYER_BASE_KEY);
    const ok = saved ? normalizePlayerBase(saved) : null;
    if (ok) return ok;
  } catch {
    /* storage blocked */
  }
  const env = (import.meta as { env?: Record<string, unknown> }).env?.['VITE_AETHER_PLAYER_URL'];
  const fromEnv = typeof env === 'string' ? normalizePlayerBase(env) : null;
  return fromEnv ?? (typeof location !== 'undefined' ? `${location.origin}/play` : 'http://localhost/play');
}

/** Encode RGBA pixels as PNG / JPEG / WebP through a canvas (released afterwards). */
export async function encodeImage(data: Uint8Array, width: number, height: number, format: 'png' | 'jpeg' | 'webp'): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    const img = ctx.createImageData(width, height);
    img.data.set(data.subarray(0, width * height * 4));
    ctx.putImageData(img, 0, 0);
    const mime = `image/${format}`;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, format === 'png' ? undefined : 0.92));
    if (!blob) throw new Error('the browser could not encode the image');
    // Browsers without a WebP encoder fall back to PNG: keep what was produced honest.
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
