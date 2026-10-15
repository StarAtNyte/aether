/**
 * The sections of the Publish hub (see PublishHub.tsx): one view per
 * target plus the history. Every action calls into `studio.publish`; the
 * views hold only form drafts. Nothing here renders untrusted HTML: titles,
 * links and log lines are text, the QR code is a path of numbers.
 */
import { memo, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { listBuildings, listLevels } from '@aether/arch';
import { useStudio, useWorld } from '../../app/context';
import { Icon, type IconName } from '../../components/Icon';
import { Toggle } from '../../components/fields';
import { Segmented } from '../../components/ui/Segmented';
import { formatRelative } from '../../lib/relativeTime';
import { PRESETS, PRESET_IDS } from '../../publish/cameraPath';
import { linkSizeLabel, MAX_FRAGMENT_CHARS } from '../../publish/share';
import { MOODS, MOOD_LABELS, playMusic, musicSeed, type Mood, type MusicPlayer } from '../../publish/video/music';
import { MAX_STILL_SIDE, STILL_PRESETS, VIDEO_PRESETS, type StillPresetId, type VideoPresetId } from '../../engine/publish';
import type { PublishedItem, PublishKind } from '../../publish/library';
import { encodeQr, qrPath } from '../../publish/qr';
import { siteSlug, type HostId, type HostTarget } from '../../publish/hosting';

const Section = ({ title, children, aside, hint }: { title: string; children: ReactNode; aside?: ReactNode; hint?: string }): ReactElement => (
  <section className="pub-sec">
    <header className="pub-sec__head">
      <h3 className="pub-sec__title">{title}</h3>
      {aside}
    </header>
    {hint && <p className="pub-sec__hint">{hint}</p>}
    {children}
  </section>
);

const Field = ({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }): ReactElement => (
  <label className={`pub-field${wide ? ' pub-field--wide' : ''}`}>
    <span className="pub-field__label">{label}</span>
    {children}
  </label>
);

const Primary = ({ icon, children, onClick, disabled, testId, hint }: { icon: IconName; children: ReactNode; onClick: () => void; disabled?: boolean; testId?: string; hint?: string }): ReactElement => (
  <div className="pub-primary">
    <button type="button" className="btn btn--primary pub-primary__btn" onClick={onClick} disabled={disabled} data-testid={testId}>
      <Icon name={icon} /> {children}
    </button>
    {hint && <p className="pub-primary__hint">{hint}</p>}
  </div>
);

function useBusy(): boolean {
  const studio = useStudio();
  return useStore(studio.publish.state, (s) => s.job?.running === true);
}

/** Title-screen fields shared by games and share links. */
const MetaFields = memo(function MetaFields({ compact }: { compact?: boolean }): ReactElement {
  const studio = useStudio();
  const meta = useStore(studio.publish.state, (s) => s.meta);
  const music = useStore(studio.publish.state, (s) => s.music);
  return (
    <div className="pub-grid">
      <Field label="Title" wide>
        <input className="input" value={meta.title} maxLength={80} onChange={(e) => studio.publish.setMeta({ title: e.target.value })} data-testid="publish-title" />
      </Field>
      {!compact && (
        <Field label="Author">
          <input className="input" value={meta.author} maxLength={60} placeholder="Your name" onChange={(e) => studio.publish.setMeta({ author: e.target.value })} />
        </Field>
      )}
      <Field label="Music" wide={compact === true}>
        <select className="select" value={music ?? ''} onChange={(e) => studio.publish.setMusic(e.target.value ? (e.target.value as Mood) : null)}>
          <option value="">None</option>
          {MOODS.map((m) => (
            <option key={m} value={m}>
              {MOOD_LABELS[m]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Description" wide>
        <textarea className="input pub-textarea" rows={compact ? 2 : 3} maxLength={600} value={meta.description} placeholder="What is it, and what is the goal?" onChange={(e) => studio.publish.setMeta({ description: e.target.value })} />
      </Field>
      {!compact && (
        <Field label="Controls" wide>
          <input className="input" value={meta.controls} maxLength={300} onChange={(e) => studio.publish.setMeta({ controls: e.target.value })} />
        </Field>
      )}
    </div>
  );
});

/** Copy-able command line. */
const Cmd = ({ text }: { text: string }): ReactElement => {
  const studio = useStudio();
  return (
    <span className="pub-cmd">
      <code>{text}</code>
      <button type="button" className="icon-btn icon-btn--xs" aria-label="Copy command" onClick={() => void studio.publish.copy(text, 'Command')}>
        <Icon name="copy" size={14} />
      </button>
    </span>
  );
};

const HostRow = memo(function HostRow({ t, defaultName }: { t: HostTarget; defaultName: string }): ReactElement {
  const studio = useStudio();
  const busy = useBusy();
  const deploying = useStore(studio.publish.state, (s) => s.hosting.deploying);
  const [name, setName] = useState(defaultName);
  const [itch, setItch] = useState('');
  useEffect(() => setName(defaultName), [defaultName]);
  const needsName = t.id !== 'itch';
  const valid = t.id === 'itch' ? /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/.test(itch) : /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(name);
  return (
    <div className={`pub-host${t.signedIn ? ' is-ready' : ''}`} data-testid={`publish-host-${t.id}`}>
      <div className="pub-host__head">
        <span className="pub-host__name">{t.label}</span>
        <span className={`chip chip--xs ${t.signedIn ? 'chip--action' : 'chip--quiet'}`}>{!t.installed ? 'Not installed' : t.signedIn ? (t.account ? `Signed in · ${t.account}` : 'Signed in') : 'Not signed in'}</span>
      </div>
      {t.signedIn ? (
        <div className="pub-host__form">
          {needsName ? (
            <input className="input input--sm" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} aria-label={`${t.label} name`} placeholder="site-name" />
          ) : (
            <input className="input input--sm" value={itch} onChange={(e) => setItch(e.target.value.trim())} aria-label="itch.io user/game" placeholder="user/game (create the page first)" />
          )}
          <button type="button" className="btn btn--sm btn--primary" disabled={busy || !valid} onClick={() => void studio.publish.deploy(t.id as HostId, t.id === 'itch' ? { itch } : { name })}>
            {deploying === t.id ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      ) : (
        <p className="pub-host__hint">{t.hint ?? ''}</p>
      )}
    </div>
  );
});

const Hosting = memo(function Hosting(): ReactElement {
  const studio = useStudio();
  const hosting = useStore(studio.publish.state, (s) => s.hosting);
  const title = useStore(studio.publish.state, (s) => s.meta.title);
  const busy = useBusy();
  const lan = hosting.lan;
  const lanQr = useMemo(() => {
    const u = lan?.urls[0];
    const code = u ? encodeQr(u, { ecc: 'M' }) : null;
    return code ? { d: qrPath(code), n: code.size + 8 } : null;
  }, [lan]);
  if (hosting.local === null) return <p className="pub-muted">{hosting.checking ? 'Looking for the local app…' : ''}</p>;
  if (!hosting.local)
    return (
      <div className="pub-note">
        <Icon name="info" />
        <span>
          Publishing to your own Netlify, Vercel, GitHub Pages or itch.io account, and sharing on your local network, run in the Aether app on your computer — with the logins of your own command-line tools, never ours. Start it with <Cmd text="npx aether start --open" />, or keep using this page: run <Cmd text={`npx aether start --origin ${location.origin}`} /> and pair it in Settings → AI connection. Downloading the game works everywhere.
        </span>
      </div>
    );
  return (
    <>
      {hosting.via === 'bridge' && <p className="pub-muted">Through the Aether app on your computer (paired bridge).</p>}
      <div className="pub-hosts">
        {(hosting.targets ?? []).map((t) => (
          <HostRow key={t.id} t={t} defaultName={siteSlug(title)} />
        ))}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void studio.publish.checkHosting(true)} disabled={hosting.checking}>
          <Icon name="refresh" /> {hosting.checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
      {hosting.log.length > 0 && (
        <ol className="pub-log" aria-label="Deploy log">
          {hosting.log.slice(-10).map((e) => (
            <li key={e.seq} className={`pub-log__line is-${e.kind}`}>
              {e.text}
            </li>
          ))}
        </ol>
      )}
      <Section title="Share on your local network" hint="Phones, tablets and computers on the same Wi-Fi can play it — no internet needed. Anyone on this network with the link can open it while sharing is on; it turns itself off after two hours.">
        <Toggle label={lan?.on ? 'Sharing on this network' : 'Share on this network'} checked={lan?.on === true} disabled={busy} onChange={(on) => void studio.publish.setLan(on)} />
        {lan?.on && (
          <div className="pub-lan">
            {lanQr && (
              <svg className="pub-qr pub-qr--sm" viewBox={`0 0 ${lanQr.n} ${lanQr.n}`} role="img" aria-label="QR code of the network link">
                <rect width={lanQr.n} height={lanQr.n} fill="#fff" />
                <path d={lanQr.d} fill="#000" />
              </svg>
            )}
            <div className="pub-lan__links">
              {lan.urls.length === 0 && <p className="pub-muted">No network address found (are you on Wi-Fi?).</p>}
              {lan.urls.map((u) => (
                <span key={u} className="pub-cmd">
                  <code>{u}</code>
                  <button type="button" className="icon-btn icon-btn--xs" aria-label="Copy network link" onClick={() => void studio.publish.copy(u, 'Network link')}>
                    <Icon name="copy" size={14} />
                  </button>
                </span>
              ))}
              {lan.until && <p className="pub-muted">Until {new Date(lan.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
            </div>
          </div>
        )}
      </Section>
    </>
  );
});

/** Replay seal: what it is, whether it is on, and what the last seal said. */
export const SealSection = memo(function SealSection(): ReactElement {
  const studio = useStudio();
  const seal = useStore(studio.publish.state, (s) => s.seal);
  return (
    <Section title="Replay seal" hint="Re-simulates your world's physics and rules headless and ships the result with it, so anyone can re-run the check on their own device. It is a deterministic replay check, not a formal proof.">
      <Toggle label="Seal this world when publishing" hint="Adds a verifiable replay proof to the game and to share links" checked={seal.on} onChange={(v) => studio.publish.setSeal({ on: v })} />
      {seal.on && <Toggle label="Sign with this browser's key" hint="Shows later seals come from the same browser. It does not prove who you are" checked={seal.sign} onChange={(v) => studio.publish.setSeal({ sign: v })} />}
      {seal.on && seal.note && (
        <p className={`pub-muted${seal.status === 'failed' ? ' field-error' : ''}`} role="status" data-testid="publish-seal-note">
          {seal.note}
          {seal.hash ? ` · ${seal.hash}` : ''}
          {seal.keyId ? ` · key ${seal.keyId}` : ''}
        </p>
      )}
    </Section>
  );
});

/** Game: download, your own hosting, your network. */
export const GameTarget = memo(function GameTarget(): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const busy = useBusy();
  const includeSave = useStore(studio.publish.state, (s) => s.game.includeSave);
  return (
    <>
      <Section title="Title screen" hint="Shown before play, with a slow fly-through of your world behind it. The published game also has a pause menu, settings, credits, touch and controller support.">
        <MetaFields />
        {world.voxel && <Toggle label="Include my block-world save" hint="Players start from the world as you left it in play mode" checked={includeSave} onChange={(v) => studio.publish.setGame({ includeSave: v })} />}
      </Section>
      <SealSection />
      <Primary icon="download" onClick={() => void studio.publish.downloadGame()} disabled={busy} testId="publish-game-download" hint="A complete static website: index.html, the player, your world and its assets. Upload it to itch.io (HTML game), GitHub Pages, Netlify or any static host. Plays offline and installs as an app.">
        Download game (.zip)
      </Primary>
      <Section title="Publish to your own hosting">
        <Hosting />
      </Section>
    </>
  );
});

/** Music preview button. */
const MusicPreview = memo(function MusicPreview({ mood, volume }: { mood: Mood | null; volume: number }): ReactElement {
  const world = useWorld();
  const [player, setPlayer] = useState<MusicPlayer | null>(null);
  useEffect(() => () => player?.stop(), [player]);
  return (
    <button
      type="button"
      className="btn btn--sm"
      disabled={!mood}
      onClick={() => {
        if (player) {
          player.stop();
          setPlayer(null);
          return;
        }
        if (!mood) return;
        const p = playMusic(mood, 10, { seed: musicSeed(world.name), volume });
        setPlayer(p);
        if (p) setTimeout(() => setPlayer((cur) => (cur === p ? null : cur)), 10_500);
      }}
    >
      <Icon name={player ? 'stop' : 'music'} /> {player ? 'Stop' : 'Listen'}
    </button>
  );
});

/** Video: the shot (camera path), output, titles and music. */
export const VideoTarget = memo(function VideoTarget(): ReactElement {
  const studio = useStudio();
  const busy = useBusy();
  const path = useStore(studio.publish.state, (s) => s.path);
  const video = useStore(studio.publish.state, (s) => s.video);
  const directing = useStore(studio.publish.state, (s) => s.directing);
  const note = useStore(studio.publish.state, (s) => s.directNote);
  const showPath = useStore(studio.publish.state, (s) => s.showPath);
  const [prompt, setPrompt] = useState('');
  return (
    <>
      <Section title="Direct the shot" hint="Describe the camera move, pick a preset, or add keyframes from the view on the timeline below the viewport.">
        <form
          className="pub-direct"
          onSubmit={(e) => {
            e.preventDefault();
            void studio.publish.direct(prompt);
          }}
        >
          <input className="input" value={prompt} maxLength={600} placeholder="slow dolly through the living room, then rise above the roof" onChange={(e) => setPrompt(e.target.value)} aria-label="Describe the camera move" data-testid="publish-direct-input" />
          <button type="submit" className="btn btn--primary btn--sm" disabled={directing || prompt.trim() === ''} data-testid="publish-direct">
            <Icon name="sparkles" /> {directing ? 'Directing…' : 'Direct'}
          </button>
        </form>
        {note && <p className="pub-muted" data-testid="publish-direct-note">{note}</p>}
        <div className="pub-chips" role="group" aria-label="Camera presets">
          {PRESET_IDS.map((id) => (
            <button key={id} type="button" className="chip chip--action" onClick={() => studio.publish.applyPreset(id)} data-tip={PRESETS[id].hint} data-testid={`publish-preset-${id}`}>
              {PRESETS[id].label}
            </button>
          ))}
        </div>
        <div className="pub-row">
          <span className="pub-muted">
            {path.keys.length} keyframe{path.keys.length === 1 ? '' : 's'} · {path.duration.toFixed(1)} s
          </span>
          <Toggle label="Show path" checked={showPath} onChange={(v) => studio.publish.setShowPath(v)} />
        </div>
      </Section>
      <Section title="Output">
        <div className="pub-grid">
          <Field label="Size" wide>
            <Segmented<VideoPresetId> label="Video size" stretch size="sm" value={video.preset} options={(Object.keys(VIDEO_PRESETS) as VideoPresetId[]).map((k) => [k, VIDEO_PRESETS[k].label.split(' ')[0] as string] as const)} titles={Object.fromEntries((Object.keys(VIDEO_PRESETS) as VideoPresetId[]).map((k) => [k, `${VIDEO_PRESETS[k].width} × ${VIDEO_PRESETS[k].height}`]))} onChange={(v) => studio.publish.setVideo({ preset: v })} />
          </Field>
          <Field label="Frame rate">
            <Segmented<'24' | '30' | '60'> label="Frame rate" stretch size="sm" value={String(video.fps) as '24' | '30' | '60'} options={[['24', '24'], ['30', '30'], ['60', '60']]} onChange={(v) => studio.publish.setVideo({ fps: Number(v) as 24 | 30 | 60 })} />
          </Field>
          <Field label="Format">
            <select className="select" value={video.format} onChange={(e) => studio.publish.setVideo({ format: e.target.value as 'auto' | 'mp4' | 'webm' })}>
              <option value="auto">Best available</option>
              <option value="mp4">MP4 (H.264)</option>
              <option value="webm">WebM (VP9)</option>
            </select>
          </Field>
          <Field label="Smoothing" wide>
            <Segmented<'1' | '2' | '4'> label="Temporal smoothing" stretch size="sm" value={String(video.quality) as '1' | '2' | '4'} options={[['1', 'Fast'], ['2', 'Smooth'], ['4', 'Best']]} titles={{ '1': 'One render per frame', '2': 'Two renders per frame (softer edges)', '4': 'Four renders per frame (slowest)' }} onChange={(v) => studio.publish.setVideo({ quality: Number(v) as 1 | 2 | 4 })} />
          </Field>
        </div>
      </Section>
      <Section title="Titles and music">
        <div className="pub-grid">
          <Field label="Opening title" wide>
            <input className="input" value={video.titles.title} maxLength={80} onChange={(e) => studio.publish.setTitles({ title: e.target.value })} />
          </Field>
          <Field label="Subtitle" wide>
            <input className="input" value={video.titles.subtitle} maxLength={120} placeholder="optional" onChange={(e) => studio.publish.setTitles({ subtitle: e.target.value })} />
          </Field>
          <Field label="End card" wide>
            <input className="input" value={video.titles.endText} maxLength={80} placeholder="optional, e.g. Made with Aether" onChange={(e) => studio.publish.setTitles({ endText: e.target.value })} />
          </Field>
        </div>
        <Toggle label="Cinematic bars (2.39:1)" checked={video.titles.letterbox} onChange={(v) => studio.publish.setTitles({ letterbox: v })} />
        <Toggle label="Fade in and out" checked={video.titles.fades} onChange={(v) => studio.publish.setTitles({ fades: v })} />
        <div className="pub-row">
          <select className="select select--sm" value={video.music ?? ''} onChange={(e) => studio.publish.setVideo({ music: e.target.value ? (e.target.value as Mood) : null })} aria-label="Soundtrack">
            <option value="">No music</option>
            {MOODS.map((m) => (
              <option key={m} value={m}>
                {MOOD_LABELS[m]} score
              </option>
            ))}
          </select>
          <input className="slider" type="range" min={0} max={1} step={0.05} value={video.volume} onChange={(e) => studio.publish.setVideo({ volume: Number(e.target.value) })} aria-label="Music volume" disabled={!video.music} />
          <MusicPreview mood={video.music} volume={video.volume} />
        </div>
      </Section>
      <Primary icon="film" onClick={() => void studio.publish.exportVideo()} disabled={busy || path.keys.length < 2} testId="publish-video-export" hint={path.keys.length < 2 ? 'Add a second keyframe, pick a preset or direct a shot first.' : 'Every frame is rendered offline at full quality — the result never drops frames.'}>
        Render video
      </Primary>
    </>
  );
});

/** Render: a still image. */
export const RenderTarget = memo(function RenderTarget(): ReactElement {
  const studio = useStudio();
  const busy = useBusy();
  const still = useStore(studio.publish.state, (s) => s.still);
  const keys = useStore(studio.publish.state, (s) => s.path.keys.length);
  const sim = studio.simulation;
  const photorealAvailable = sim?.renderer.studioQualityAvailable ?? false;
  return (
    <>
      <Section title="Image">
        <div className="pub-grid">
          <Field label="Size" wide>
            <select className="select" value={still.preset} onChange={(e) => studio.publish.setStill({ preset: e.target.value as StillPresetId | 'custom' })} data-testid="publish-still-preset">
              {(Object.keys(STILL_PRESETS) as StillPresetId[]).map((k) => (
                <option key={k} value={k}>
                  {STILL_PRESETS[k].label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </Field>
          {still.preset === 'custom' && (
            <>
              <Field label="Width">
                <input className="input" type="number" min={64} max={MAX_STILL_SIDE} value={still.width} onChange={(e) => studio.publish.setStill({ width: Number(e.target.value) })} />
              </Field>
              <Field label="Height">
                <input className="input" type="number" min={64} max={MAX_STILL_SIDE} value={still.height} onChange={(e) => studio.publish.setStill({ height: Number(e.target.value) })} />
              </Field>
            </>
          )}
          <Field label="Format" wide>
            <Segmented<'png' | 'jpeg' | 'webp'> label="Image format" stretch size="sm" value={still.format} options={[['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']]} onChange={(v) => studio.publish.setStill({ format: v })} />
          </Field>
          <Field label="Camera" wide>
            <Segmented<'view' | 'shot'> label="Camera" stretch size="sm" value={still.source} options={[['view', 'Current view'], ['shot', 'First keyframe']]} disabled={keys === 0} onChange={(v) => studio.publish.setStill({ source: v })} />
          </Field>
        </div>
        <Toggle label="Photoreal" hint={photorealAvailable ? 'Ambient occlusion, reflections, sun shafts, soft shadows and 24 accumulated samples per pixel — for architecture and stills' : 'Needs the studio render, which this device cannot run'} checked={still.photoreal && photorealAvailable} disabled={!photorealAvailable} onChange={(v) => studio.publish.setStill({ photoreal: v })} />
        <Toggle
          label="Path traced (beta)"
          hint="Global illumination, soft area lights and real glass, accumulated sample by sample like Blender Cycles. Slow, and the first one in a session compiles a large shader; cancel any time."
          checked={still.pathTraced}
          onChange={(v) => studio.publish.setStill({ pathTraced: v })}
        />
        {still.pathTraced && (
          <Field label="Quality" wide>
            <Segmented<'64' | '256' | '1024'> label="Path tracing samples" stretch size="sm" value={String(still.samples) as '64' | '256' | '1024'} options={[['64', 'Draft 64'], ['256', 'Good 256'], ['1024', 'Best 1024']]} onChange={(v) => studio.publish.setStill({ samples: Number(v) })} />
          </Field>
        )}
        <Toggle label="Final render" hint="Adds depth of field (and, for a raster render, 48 samples per pixel with 2× supersampling). Slower: the cleanest result the renderer can make." checked={still.final && (still.pathTraced || (still.photoreal && photorealAvailable))} disabled={!still.pathTraced && (!photorealAvailable || !still.photoreal)} onChange={(v) => studio.publish.setStill({ final: v })} />
      </Section>
      <Primary icon="image" onClick={() => void studio.publish.exportStill()} disabled={busy} testId="publish-still-export" hint={`${still.width} × ${still.height}. Larger images render in tiles, so even 4K never needs a 4K screen.`}>
        Render still
      </Primary>
    </>
  );
});

/** 3D model. */
export const ModelTarget = memo(function ModelTarget(): ReactElement {
  const studio = useStudio();
  const busy = useBusy();
  const model = useStore(studio.publish.state, (s) => s.model);
  return (
    <>
      <Section title="3D model" hint="Everything you see in the viewport — meshes with their PBR materials and textures, imported and library models, procedural and architecture geometry — for Blender, Unity, Unreal, Sketchfab or any glTF viewer.">
        <Segmented<'glb' | 'gltf'> label="Model format" stretch value={model.binary ? 'glb' : 'gltf'} options={[['glb', 'GLB (one file)'], ['gltf', 'glTF (JSON)']]} onChange={(v) => studio.publish.setModel({ binary: v === 'glb' })} />
      </Section>
      <Primary icon="box3d" onClick={() => void studio.publish.exportModel()} disabled={busy} testId="publish-model-export">
        Export 3D model
      </Primary>
    </>
  );
});

/** Floor plan of a building. */
export const PlanTarget = memo(function PlanTarget(): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const busy = useBusy();
  const plan = useStore(studio.publish.state, (s) => s.plan);
  const buildings = useMemo(() => listBuildings(world), [world]);
  const building = plan.building && buildings.some((b) => b.id === plan.building) ? plan.building : (buildings[0]?.id ?? null);
  const levels = useMemo(() => (building ? listLevels(world, building) : []), [world, building]);
  if (buildings.length === 0)
    return (
      <div className="empty-state">
        <span className="empty-state__icon">
          <Icon name="plan" size={20} />
        </span>
        <h3 className="empty-state__title">No building in this world</h3>
        <p className="empty-state__text">Floor plans come from buildings. Ask for one — “a modern two-bedroom apartment” — or start from an architecture template.</p>
      </div>
    );
  return (
    <>
      <Section title="Floor plan" hint="Walls, doors with swings, windows, stairs, furniture, room names and areas, dimensions, a scale bar and a north arrow — print-ready at 1:50 or 1:100.">
        <div className="pub-grid">
          <Field label="Building" wide>
            <select className="select" value={building ?? ''} onChange={(e) => studio.publish.setPlan({ building: e.target.value, level: 0 })}>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Storey">
            <select className="select" value={plan.level} onChange={(e) => studio.publish.setPlan({ level: Number(e.target.value) })}>
              {levels.map((l) => (
                <option key={l.id} value={l.index}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Scale">
            <Segmented<'50' | '100'> label="Scale" stretch size="sm" value={String(plan.scale) as '50' | '100'} options={[['50', '1:50'], ['100', '1:100']]} onChange={(v) => studio.publish.setPlan({ scale: Number(v) as 50 | 100 })} />
          </Field>
          <Field label="Format" wide>
            <Segmented<'svg' | 'pdf'> label="Plan format" stretch size="sm" value={plan.format} options={[['svg', 'SVG'], ['pdf', 'PDF']]} onChange={(v) => studio.publish.setPlan({ format: v })} />
          </Field>
        </div>
      </Section>
      <Primary icon="plan" onClick={() => void studio.publish.exportPlan()} disabled={busy} testId="publish-plan-export">
        Export floor plan
      </Primary>
    </>
  );
});

/** Which player share links open (this studio, or a hosted copy when this one runs locally). */
const PlayerAddress = memo(function PlayerAddress(): ReactElement | null {
  const studio = useStudio();
  const base = useStore(studio.publish.state, (s) => s.playerBase);
  const local = useStore(studio.publish.state, (s) => s.playerLocal);
  const [draft, setDraft] = useState(base);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(base), [base]);
  if (!local && !editing)
    return (
      <p className="pub-muted">
        Links open in the player at {base}.{' '}
        <button type="button" className="link" onClick={() => setEditing(true)}>
          Change
        </button>
      </p>
    );
  return (
    <Section title="Player address" hint={local ? 'This studio runs on your computer, so its links only open here. Enter the address of a hosted copy of Aether (any static deployment of the studio) to share links with anyone.' : 'The player share links open in.'}>
      <form
        className="pub-direct"
        onSubmit={(e) => {
          e.preventDefault();
          const err = studio.publish.setPlayerBase(draft);
          setError(err);
          if (!err) setEditing(false);
        }}
      >
        <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://your-aether.example/play" aria-label="Player address" />
        <button type="submit" className="btn btn--sm">
          Use
        </button>
      </form>
      {error && <p className="field-error">{error}</p>}
    </Section>
  );
});

/** Share link with QR code and embed snippet. */
export const ShareTarget = memo(function ShareTarget(): ReactElement {
  const studio = useStudio();
  const share = useStore(studio.publish.state, (s) => s.share);
  const meta = useStore(studio.publish.state, (s) => s.meta);
  const link = share.value ? studio.publish.shareLink() : null;
  const embed = share.value ? studio.publish.embedSnippet() : null;
  useEffect(() => {
    if (!share.value) {
      const t = setTimeout(() => void studio.publish.makeShareLink(), 250);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [share.value, meta, studio]);
  const fill = Math.min(1, share.chars / MAX_FRAGMENT_CHARS);
  return (
    <>
      <Section title="Title screen">
        <MetaFields compact />
      </Section>
      <PlayerAddress />
      <SealSection />
      <Section title="Link" hint="The whole world travels inside the link, after the #. Browsers never send that part to a server, so nothing is uploaded or stored anywhere — the link is the game.">
        <div className="pub-link">
          <input className="input input--mono" readOnly value={link ?? (share.fits ? 'Making the link…' : 'Too large for a link')} aria-label="Share link" data-testid="publish-share-link" onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn--primary btn--sm" disabled={!link} onClick={() => void studio.publish.copyShareLink()} data-testid="publish-share-copy">
            <Icon name="copy" /> Copy
          </button>
          <a className={`btn btn--sm${link ? '' : ' is-disabled'}`} href={link ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!link}>
            <Icon name="external" /> Open
          </a>
        </div>
        <div className="pub-meter" aria-label="Link size">
          <div className={`pub-meter__fill${!share.fits ? ' is-over' : fill > 0.04 ? ' is-long' : ''}`} style={{ width: `${Math.max(1, fill * 100)}%` }} />
        </div>
        <p className="pub-muted" data-testid="publish-share-size">
          {linkSizeLabel(share.chars)} of 1.5 MB{share.note ? ` · ${share.note}` : ''}
        </p>
        {share.qr && (
          <div className="pub-qrbox">
            <svg className="pub-qr" viewBox={`0 0 ${share.qrSize} ${share.qrSize}`} role="img" aria-label="QR code of the share link" data-testid="publish-share-qr">
              <rect width={share.qrSize} height={share.qrSize} fill="#fff" />
              <path d={share.qr} fill="#000" />
            </svg>
            <p className="pub-muted">Scan to play on a phone.</p>
          </div>
        )}
      </Section>
      <Section title="Remix link" hint="Opens this world read-only in the studio; visitors can play it or press Remix to get their own editable copy. Like the player link, the world travels in the link.">
        <button type="button" className="btn btn--sm" onClick={() => void studio.share()} data-testid="publish-share-remix">
          <Icon name="copy" /> Copy remix link
        </button>
      </Section>
      {embed && (
        <Section title="Embed" hint="Paste into a web page, a blog or a portfolio to play it in place.">
          <textarea className="input input--mono pub-textarea" readOnly rows={3} value={embed} onFocus={(e) => e.target.select()} aria-label="Embed code" />
          <button type="button" className="btn btn--sm" onClick={() => void studio.publish.copy(embed, 'Embed code')}>
            <Icon name="copy" /> Copy embed code
          </button>
        </Section>
      )}
    </>
  );
});

const KIND_ICON: Readonly<Record<PublishKind, IconName>> = { game: 'gamepad', video: 'film', render: 'image', model: 'box3d', plan: 'plan', link: 'link', hosting: 'globe', lan: 'wifi' };

const HistoryRow = memo(function HistoryRow({ item }: { item: PublishedItem }): ReactElement {
  const studio = useStudio();
  return (
    <li className="pub-hist">
      {item.thumb ? <img className="pub-hist__thumb" src={item.thumb} alt="" /> : <span className="pub-hist__thumb pub-hist__thumb--icon"><Icon name={KIND_ICON[item.kind]} /></span>}
      <span className="pub-hist__text">
        <span className="pub-hist__title">
          <Icon name={KIND_ICON[item.kind]} size={14} /> {item.title}
        </span>
        <span className="pub-hist__detail">{item.detail}</span>
        <span className="pub-hist__time">{formatRelative(item.createdAt)}</span>
      </span>
      <span className="pub-hist__actions">
        {item.hasBlob && (
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Download again" data-tip="Download again" onClick={() => void studio.publish.downloadItem(item)}>
            <Icon name="download" />
          </button>
        )}
        {item.url && (
          <a className="icon-btn icon-btn--sm" href={item.url} target="_blank" rel="noopener noreferrer" aria-label="Open" data-tip="Open">
            <Icon name="external" />
          </a>
        )}
        <button type="button" className="icon-btn icon-btn--sm" aria-label="Remove from history" data-tip="Remove from history" onClick={() => void studio.publish.removeItem(item.id)}>
          <Icon name="trash" />
        </button>
      </span>
    </li>
  );
});

/** Publish history and saved versions of this project. */
export const HistoryTarget = memo(function HistoryTarget(): ReactElement {
  const studio = useStudio();
  const history = useStore(studio.publish.state, (s) => s.history);
  const versions = useStore(studio.publish.state, (s) => s.versions);
  const [label, setLabel] = useState('');
  return (
    <>
      <Section title="Versions" hint="Snapshots of this project. Publishing saves one automatically; restoring is one Undo away.">
        {studio.projectId ? (
          <form
            className="pub-direct"
            onSubmit={(e) => {
              e.preventDefault();
              void studio.publish.snapshot(label || 'Saved version').then((ok) => {
                if (ok) setLabel('');
                studio.store.getState().toast(ok ? 'Version saved.' : 'This world is too large to keep as a version.', ok ? 'success' : 'error', 3);
              });
            }}
          >
            <input className="input" value={label} maxLength={80} placeholder="Name this version" onChange={(e) => setLabel(e.target.value)} aria-label="Version name" />
            <button type="submit" className="btn btn--sm" data-testid="publish-save-version">
              <Icon name="plus" /> Save version
            </button>
          </form>
        ) : (
          <p className="pub-muted">Versions are kept for projects.</p>
        )}
        <ul className="pub-versions">
          {versions.map((v) => (
            <li key={v.id} className="pub-version">
              <span className="pub-version__text">
                <span className="pub-version__label">{v.label}</span>
                <span className="pub-muted">
                  {formatRelative(v.createdAt)} · {v.entityCount} objects
                </span>
              </span>
              <button type="button" className="btn btn--sm" onClick={() => void studio.publish.restoreVersion(v.id)}>
                Restore
              </button>
              <button type="button" className="icon-btn icon-btn--sm" aria-label="Delete version" onClick={() => void studio.publish.removeVersion(v.id)}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
          {versions.length === 0 && studio.projectId && <li className="pub-muted">No versions yet.</li>}
        </ul>
      </Section>
      <Section title="Published" hint="Everything published from this project in this browser. Files up to 120 MB stay here so you can download them again.">
        {history.length === 0 ? (
          <p className="pub-muted">Nothing published yet.</p>
        ) : (
          <ul className="pub-history" data-testid="publish-history">
            {history.map((item) => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
});
