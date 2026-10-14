/**
 * Forge controller (studio side of `@aether/agent` `forgeGenerator`): turns
 * a reference image and / or a description into an editable parametric
 * generator through the connected model, rendering every iteration with a
 * small private WebGL2 renderer (four orthographic views on one contact
 * sheet) and showing each iteration live. Accepted results are saved to the
 * user's library ("creations") and placed in the world.
 *
 * Needs a connected model (Codex / Claude Code / an API key); the vision
 * critique needs a model that can see images. Offline it says so instead.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createWorld, uniqueId, type GeneratorDef, type History, type Patch } from '@aether/core';
import { buildCoderPrompt, forgeGenerator, type ForgeIteration, type Provider, type UsageTotals } from '@aether/agent';
import type { SandboxRunner } from '@aether/procgen';
import type { StudioState } from '../state/store';
import type { Simulation } from './Simulation';
import type { AssetController } from './assets';
import type { AiConnection, ResolvedConnection } from '../ai/connection';
import { agentCatalogs } from './AgentBridge';
import { createLogger } from '../lib/log';

const log = createLogger('forge');

/** Pixel size of one view (the contact sheet is 2 × 2 views). */
const VIEW_PX = 256;
/** Iterations / model calls of one forge run (bounded cost). */
export const FORGE_RUN = { iterations: 4, calls: 10 } as const;
/** Largest reference image accepted (bytes of the data URL payload). */
export const MAX_REFERENCE_BYTES = 6 * 1024 * 1024;

/** One iteration as shown in the UI. */
export interface ForgeIterationView {
  index: number;
  sheet: string | null;
  score: number | null;
  summary: string;
  missing: string[];
  error?: string;
}

/** Forge UI state. */
export interface ForgeState {
  open: boolean;
  status: 'idle' | 'running' | 'done' | 'failed';
  stage: string;
  iterations: ForgeIterationView[];
  /** Best generator of the last run. */
  result: GeneratorDef | null;
  resultScore: number | null;
  passed: boolean;
  message: string | null;
  /** The creation being refined ("same chair but taller"), when any. */
  base: GeneratorDef | null;
}

/** What the controller needs from the studio. */
export interface ForgeHost {
  readonly store: StoreApi<StudioState>;
  readonly history: History;
  readonly simulation: Simulation | null;
  readonly ai: AiConnection;
  readonly assets: AssetController;
  commitUser(patches: Patch[] | unknown[], message: string): string | null;
  validateGenerator(def: GeneratorDef): Promise<{ ok: boolean; error?: string }>;
  readonly generatorSandbox: SandboxRunner | null;
}

/** Slug for a forged generator id from a description. */
export function forgeId(description: string, taken: (id: string) => boolean): string {
  const base = `custom-${description.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 3).join('-') || 'object'}`.slice(0, 48);
  let id = base;
  for (let i = 2; taken(id) && i < 1000; i++) id = `${base}-${i}`;
  return id;
}

/** The forge controller. */
export class ForgeController {
  readonly state: StoreApi<ForgeState>;
  private abort: AbortController | null = null;
  private preview: { renderer: import('@aether/render').WorldRenderer; canvas: HTMLCanvasElement } | null = null;

  constructor(private readonly host: ForgeHost) {
    this.state = createStore<ForgeState>()(() => ({ open: false, status: 'idle', stage: '', iterations: [], result: null, resultScore: null, passed: false, message: null, base: null }));
  }

  /** Whether forging can run now, and why not. */
  availability(): { ok: boolean; vision: boolean; reason: string | null; resolved: ResolvedConnection } {
    const resolved = this.host.ai.resolve(this.host.store.getState().aiPrefs);
    if (resolved.kind === 'offline') return { ok: false, vision: false, reason: 'Creating new objects needs a connected model (Codex, Claude Code or an API key in Settings → AI). The built-in planner cannot write new 3D code.', resolved };
    if (!resolved.ready) return { ok: false, vision: false, reason: `${resolved.label} is not ready: ${resolved.reason ?? 'unavailable'}.`, resolved };
    return { ok: true, vision: resolved.vision, reason: resolved.vision ? null : `${resolved.label} cannot see images: the result is validated but not compared with renders.`, resolved };
  }

  /** Open the dialog (optionally to refine a saved creation). */
  open(base: GeneratorDef | null = null): void {
    if (this.state.getState().status === 'running') {
      this.state.setState({ open: true });
      return;
    }
    this.state.setState({ open: true, status: 'idle', stage: '', iterations: [], result: null, resultScore: null, passed: false, message: null, base });
  }

  /** Close the dialog (a running forge keeps running until cancelled). */
  close(): void {
    this.state.setState({ open: false });
    if (this.state.getState().status !== 'running') this.disposePreview();
  }

  /** Stop a running forge. */
  cancel(): void {
    this.abort?.abort();
  }

  private async previewRenderer(): Promise<import('@aether/render').WorldRenderer> {
    if (this.preview) return this.preview.renderer;
    const canvas = document.createElement('canvas');
    canvas.width = VIEW_PX;
    canvas.height = VIEW_PX;
    // Off-screen but laid out, so the renderer gets a real size.
    canvas.style.cssText = `position:fixed;left:-10000px;top:0;width:${VIEW_PX}px;height:${VIEW_PX}px;pointer-events:none`;
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const { WorldRenderer } = await import('@aether/render');
    const renderer = await WorldRenderer.create(canvas, {
      backend: 'webgl2',
      lowMemory: true,
      antialias: true,
      fields: false,
      virtualGeometry: false,
      ...(this.host.generatorSandbox ? { sandbox: this.host.generatorSandbox } : {}),
    });
    this.preview = { renderer, canvas };
    return renderer;
  }

  private disposePreview(): void {
    if (!this.preview) return;
    try {
      this.preview.renderer.dispose();
    } catch (e) {
      log.warn('preview dispose failed', e);
    }
    this.preview.canvas.remove();
    this.preview = null;
  }

  /** Four views of a generator on a 2 × 2 contact sheet (JPEG data URL). */
  async renderSheet(def: GeneratorDef): Promise<string> {
    const r = await this.previewRenderer();
    await r.setWorld(
      createWorld({
        environment: { sky: 'studio', ground: null, fog: null, weather: 'clear', bloom: 0 },
        generators: { [def.id]: def },
        entities: { subject: { id: 'subject', shape: { kind: 'procedural', generator: def.id, params: {} } } },
      }),
    );
    const views = await r.renderViews(['front', 'side', 'top', 'iso'], VIEW_PX);
    const sheet = document.createElement('canvas');
    sheet.width = VIEW_PX * 2;
    sheet.height = VIEW_PX * 2;
    const ctx = sheet.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.fillStyle = '#e9ebef';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    for (let i = 0; i < Math.min(4, views.length); i++) {
      const img = new Image();
      img.src = views[i] as string;
      await img.decode();
      ctx.drawImage(img, (i % 2) * VIEW_PX, Math.floor(i / 2) * VIEW_PX, VIEW_PX, VIEW_PX);
    }
    return sheet.toDataURL('image/jpeg', 0.82);
  }

  /** Run the forge. `reference` is an image data URL (optional). */
  async run(description: string, reference: string | null): Promise<void> {
    const avail = this.availability();
    if (!avail.ok) {
      this.state.setState({ status: 'failed', message: avail.reason });
      return;
    }
    if (reference && (!/^data:image\/(png|jpeg|webp);base64,/.test(reference) || reference.length * 0.75 > MAX_REFERENCE_BYTES)) {
      this.state.setState({ status: 'failed', message: 'Use a PNG, JPEG or WebP image under 6 MB.' });
      return;
    }
    const provider: Provider | null = this.host.ai.createProvider(this.host.store.getState().aiPrefs, avail.resolved);
    if (!provider) {
      this.state.setState({ status: 'failed', message: 'The model connection could not be created.' });
      return;
    }
    const base = this.state.getState().base;
    const world = this.host.history.current;
    const id = base?.id ?? forgeId(description || 'object', (x) => Object.hasOwn(world.generators, x));
    const abort = new AbortController();
    this.abort = abort;
    const usage: UsageTotals = { calls: 0, inputTokens: 0, outputTokens: 0 };
    this.state.setState({ status: 'running', stage: 'Starting…', iterations: [], result: null, resultScore: null, passed: false, message: avail.reason });
    const toView = (it: ForgeIteration): ForgeIterationView => ({ index: it.index, sheet: it.sheet, score: it.score, summary: it.critique?.summary ?? '', missing: it.critique?.missing ?? [], ...(it.error ? { error: it.error } : {}) });
    try {
      const result = await forgeGenerator(
        {
          provider,
          coderSystem: buildCoderPrompt(agentCatalogs()),
          validate: (def) => this.host.validateGenerator(def),
          render: (def) => this.renderSheet(def),
          usage,
          signal: abort.signal,
          vision: avail.vision,
          maxIterations: FORGE_RUN.iterations,
          maxCalls: FORGE_RUN.calls,
          onIteration: (it) => this.state.setState((s) => ({ iterations: [...s.iterations, toView(it)] })),
          onStage: (stage) => this.state.setState({ stage }),
        },
        { id, description, ...(reference ? { reference } : {}), ...(base ? { base } : {}) },
      );
      const why: Record<typeof result.reason, string> = {
        passed: 'Matches the reference (quality gate passed).',
        iterations: 'Best version after the iteration budget — some differences remain (listed below).',
        calls: 'Stopped at the model-call budget; this is the best version so far.',
        'no-vision': 'Built and checked, but this model cannot compare renders with the reference.',
        failed: `No valid generator: ${result.error ?? 'the model did not deliver one'}.`,
        aborted: 'Cancelled.',
      };
      this.state.setState({ status: result.ok ? 'done' : 'failed', stage: '', result: result.def, resultScore: result.best?.score ?? null, passed: result.passed, message: why[result.reason] });
    } catch (e) {
      const aborted = abort.signal.aborted;
      this.state.setState({ status: 'failed', stage: '', message: aborted ? 'Cancelled.' : `The forge stopped: ${e instanceof Error ? e.message.slice(0, 200) : 'error'}` });
    } finally {
      this.abort = null;
      if (!this.state.getState().open) this.disposePreview();
    }
  }

  /**
   * Save the result to the user's library and place it in the world (one
   * undoable edit: the generator definition plus an entity using it).
   */
  async accept(): Promise<string | null> {
    const s = this.state.getState();
    const def = s.result;
    if (!def) return null;
    const best = [...s.iterations].reverse().find((i) => i.sheet !== null && i.score === s.resultScore) ?? s.iterations.at(-1);
    await this.host.assets.saveCreation({ def, thumb: best?.sheet ?? null, score: s.resultScore, createdAt: Date.now() });
    const id = await this.host.assets.placeCreation(def);
    this.close();
    return id;
  }
}
