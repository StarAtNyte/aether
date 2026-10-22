import { memo, useState, type ReactElement } from 'react';
import { useStudio, useUI, useWorld } from '../../app/context';
import { FIDELITY_KEYS, type ChatEventView, type DifferenceEventView, type FidelityKey, type PhotoProvenanceEventView, type PhotoStageEventView } from '../../lib/chat';
import { patchChips } from '../../lib/patchSummary';
import { compactCount } from '../../lib/format';
import { CodeBlock } from '../CodeBlock';
import { Icon } from '../Icon';
import { RichText } from '../RichText';

/** Expandable diff chip row for a patch batch. */
const PatchesView = memo(function PatchesView({ event }: { event: Extract<ChatEventView, { type: 'patches' }> }): ReactElement {
  const [open, setOpen] = useState(false);
  const s = event.summary;
  const chips = patchChips(s);
  const lists: Array<[string, string[], number]> = [
    ['Added', s.added, s.addedCount],
    ['Changed', s.updated, s.updatedCount],
    ['Removed', s.removed, s.removedCount],
  ];
  return (
    <div className="ev ev--patches">
      <button type="button" className="diff-chips" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="cube" className="diff-chips__icon" />
        <span className="diff-chips__msg" title={event.message || 'World edit'}>
          {event.message || 'World edit'}
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} className="diff-chips__chev" />
        <span className="diff-chips__list">
          {chips.length === 0 ? <span className="chip">no changes</span> : chips.map((c) => <span key={c} className={`chip${c.startsWith('＋') ? ' chip--add' : c.startsWith('−') ? ' chip--remove' : c.startsWith('✎') ? ' chip--edit' : ''}`}>{c}</span>)}
        </span>
      </button>
      {open && (
        <div className="diff-detail">
          {lists.map(([label, ids, count]) =>
            count > 0 ? (
              <div key={label} className="diff-detail__row">
                <span className="diff-detail__label">{label}</span>
                <span className="diff-detail__ids">
                  {ids.join(', ')}
                  {count > ids.length ? ` +${count - ids.length} more` : ''}
                </span>
              </div>
            ) : null,
          )}
          {s.generators.length > 0 && (
            <div className="diff-detail__row">
              <span className="diff-detail__label">Generators</span>
              <span className="diff-detail__ids">{s.generators.join(', ')}</span>
            </div>
          )}
          {s.scripts.length > 0 && (
            <div className="diff-detail__row">
              <span className="diff-detail__label">Scripts</span>
              <span className="diff-detail__ids">{s.scripts.join(', ')}</span>
            </div>
          )}
        </div>
      )}
      {event.errors.length > 0 && (
        <ul className="ev-errors">
          {event.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
});

/** A small edit applied on the spot: what changed, in one glance, with one-click undo / redo. */
const EditView = memo(function EditView({ event }: { event: Extract<ChatEventView, { type: 'edit' }> }): ReactElement {
  const studio = useStudio();
  useWorld(); // re-render when the history moves (the buttons follow it)
  const [undone, setUndone] = useState(false);
  const head = event.head;
  const here = studio.history.head;
  const canUndo = !undone && head !== undefined && here === head && studio.history.canUndo();
  const canRedo = undone && head !== undefined && here !== head && studio.history.canRedo();
  const time = event.ms < 1 ? 'under 1 ms' : event.ms < 10 ? `${event.ms.toFixed(1)} ms` : `${Math.round(event.ms)} ms`;
  return (
    <div className="ev ev--edit" data-testid="edit-card">
      <div className="edit__head">
        <Icon name="check" className="edit__icon" />
        <span className="edit__summary" data-testid="edit-summary">
          {event.summary}
        </span>
        {event.local && (
          <span className="edit__meta" title="Applied locally: no model call, only the named property changed">
            {time} · no model call
          </span>
        )}
      </div>
      {event.lines.length > 0 && (
        <ul className="edit__lines" aria-label="What changed">
          {event.lines.map((l, i) => (
            <li key={i} className={`edit__line is-${l.kind}`}>
              {l.fromColor && <span className="swatch" style={{ background: l.fromColor }} aria-hidden="true" />}
              {l.toColor && <span className="swatch" style={{ background: l.toColor }} aria-hidden="true" />}
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      {event.notes.map((n, i) => (
        <p key={i} className="edit__note">
          {n}
        </p>
      ))}
      {(canUndo || canRedo || undone) && (
        <div className="edit__actions">
          {!undone ? (
            <button
              type="button"
              className="btn btn--sm"
              disabled={!canUndo}
              onClick={() => {
                studio.undo();
                setUndone(true);
              }}
              data-testid="edit-undo"
            >
              <Icon name="undo" /> Undo
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--sm"
              disabled={!canRedo}
              onClick={() => {
                studio.redo();
                setUndone(false);
              }}
              data-testid="edit-redo"
            >
              <Icon name="redo" /> Redo
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/** "Which one?": numbered candidates (outlined in the viewport) to click. */
const ClarifyView = memo(function ClarifyView({ event }: { event: Extract<ChatEventView, { type: 'clarify' }> }): ReactElement {
  const studio = useStudio();
  const active = useUI((s) => s.clarify !== null && s.clarify.text === event.text);
  return (
    <div className="ev ev--clarify" role="group" aria-label="Which one?" data-testid="clarify">
      <p className="clarify__text">{event.text}</p>
      <div className="clarify__choices">
        {event.candidates.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className="chip chip--action"
            disabled={!active}
            onClick={() => studio.answerClarify(c.id)}
            onMouseEnter={() => active && studio.simulation?.setCandidates([c.id])}
            onMouseLeave={() => active && studio.simulation?.setCandidates(event.candidates.map((x) => x.id))}
            data-testid="clarify-choice"
          >
            <b>{i + 1}</b> {c.label}
          </button>
        ))}
      </div>
      {active && <p className="clarify__hint">They are numbered in the viewport: click one there, or pick here.</p>}
    </div>
  );
});

/**
 * The ranked differences between the reference (the photo, or what was asked for) and the render, as the AI listed them:
 * largest first, each with its kind, where, the amount and whether the next render showed it smaller.
 */
function DifferencesList({ items, label }: { items: readonly DifferenceEventView[]; label: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const ranked = [...items].sort((a, b) => b.size - a.size);
  return (
    <>
      <button type="button" className="diff-chips" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="differences-toggle">
        <span className="diff-chips__msg">{ranked.length} {label}{ranked.length === 1 ? '' : 's'}, largest first</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} className="diff-chips__chev" />
      </button>
      {open && (
        <ol className="differences" data-testid="differences-list">
          {ranked.map((d) => (
            <li key={`${d.source}-${d.id}`} className={`differences__row${d.status === 'fixed' ? ' is-fixed' : ''}`}>
              <span className="differences__size" title={`Size ${d.size} of 5`} aria-label={`size ${d.size} of 5`}>{'●'.repeat(Math.max(1, d.size))}</span>
              <span className="differences__kind">{d.kind}</span>
              <span className="differences__text">
                {d.where ? <b>{d.where} </b> : null}
                {d.what}
                {d.status !== 'open' ? <i> · {d.status}</i> : d.rounds > 1 ? <i> · open {d.rounds} rounds</i> : null}
                {d.source === 'independent' ? <i> · independent check</i> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

const STAGE_MARK: Readonly<Record<PhotoStageEventView['status'], string>> = { pending: '○', active: '●', passed: '✓', failed: '✕', blocked: '■', skipped: '–' };

/** The stages of a photo room as a checklist with ticks; the model's evidence for each verdict is its tooltip. */
function StageList({ stages }: { stages: readonly PhotoStageEventView[] }): ReactElement {
  return (
    <ol className="photo__stages" aria-label="Stages" data-testid="photo-stages">
      {stages.map((s) => (
        <li key={s.id} className={`photo__stage is-${s.status}`} title={s.note || undefined} aria-label={`${s.title}: ${s.status}`} data-testid={`photo-stage-${s.id}`}>
          <span className="photo__mark" aria-hidden="true">{STAGE_MARK[s.status]}</span> {s.title}
        </li>
      ))}
    </ol>
  );
}

/** What the photo room rests on: the photo's hash, the permission note, the estimated scale, the assumptions with confidence, the limits; and the ways to take it out. */
function ProvenancePanel({ prov, resumable }: { prov: PhotoProvenanceEventView; resumable: boolean }): ReactElement {
  const studio = useStudio();
  const busy = useUI((s) => s.agentBusy);
  const p = (v: number): string => `${Math.round(v * 100)}%`;
  return (
    <details className="photo__prov" data-testid="photo-provenance">
      <summary>Source, assumptions and limits</summary>
      <dl className="photo__facts">
        <dt>Photo</dt>
        <dd>{prov.sha256 ? `SHA-256 ${prov.sha256.slice(0, 16)}…` : 'hash not available'}{prov.width && prov.height ? ` · ${prov.width} × ${prov.height} px` : ''} · the photo itself is not stored</dd>
        <dt>Permission</dt>
        <dd>{prov.permission.localProcessing} Publication: {prov.permission.publication}</dd>
        <dt>Scale</dt>
        <dd>about {prov.scale.width} × {prov.scale.depth} m, {prov.scale.ceiling} m high ({p(prov.scale.confidence)} sure): {prov.scale.basis}</dd>
        <dt>Repairs</dt>
        <dd>{prov.repairs.length === 0 ? 'none declared' : prov.repairs.map((r) => `${r.cause} (${r.difference})`).join(', ')} · {prov.rounds} round{prov.rounds === 1 ? '' : 's'}</dd>
      </dl>
      {prov.assumptions.length > 0 && (
        <ul className="photo__failing" aria-label="Assumptions by confidence">
          {prov.assumptions.slice(0, 12).map((a) => (
            <li key={a.id}>
              {a.text} <i>({p(a.confidence)} sure{a.kind !== 'other' ? `, ${a.kind}` : ''})</i>
            </li>
          ))}
        </ul>
      )}
      {prov.open.length > 0 && <p className="photo__measures">Still open: {prov.open.slice(0, 6).map((d) => `${d.id} (${d.cause})`).join(', ')}.</p>}
      <ul className="photo__failing" aria-label="Limits">
        {prov.limits.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="photo__actions" role="group" aria-label="Export">
        <button type="button" className="chip chip--action" onClick={() => void studio.exportGltf()} data-testid="photo-export-glb" title="The room as a portable glTF model (.glb)">Download GLB</button>
        <button type="button" className="chip chip--action" onClick={() => studio.exportToFile()} data-testid="photo-export-project" title="The playable project (.aether.json)">Download project</button>
        <button type="button" className="chip chip--action" onClick={() => studio.exportPhotoRecord(prov.raw as Parameters<typeof studio.exportPhotoRecord>[0])} data-testid="photo-export-record" title="This record as JSON">Download record</button>
        {resumable && studio.canContinuePhoto() && (
          <button type="button" className="chip chip--action" disabled={busy} onClick={() => void studio.send('Continue repairing this room against the photo.', { continuePhoto: true, intent: 'refine' })} data-testid="photo-continue">Continue repair</button>
        )}
      </div>
    </details>
  );
}

const FIDELITY_LABELS: Readonly<Record<FidelityKey, string>> = { openings: 'openings', inventory: 'pieces', placement: 'placement', sizes: 'sizes', materials: 'colours', clearance: 'clearance', framing: 'framing', similarity: 'pixels', regionColour: 'region colour' };

/**
 * A room rebuilt from a photograph: what is happening, the assumptions as one-tap "adjust" chips (each sends a
 * plain-language edit to the same minimal-patch path as any other message), the swatches read from the picture
 * when no assistant could look at it, and the item-by-item score with what still differs.
 */
const PhotoView = memo(function PhotoView({ event }: { event: Extract<ChatEventView, { type: 'photo' }> }): ReactElement {
  const studio = useStudio();
  const busy = useUI((s) => s.agentBusy);
  const [open, setOpen] = useState(false);
  const tone = event.phase === 'done' ? 'ok' : event.phase === 'offline' || event.phase === 'unavailable' ? 'warn' : 'info';
  const label = event.phase === 'analysing' ? 'Reading photo' : event.phase === 'described' ? 'Described' : event.phase === 'building' ? 'Building' : event.phase === 'built' ? 'Built' : event.phase === 'textures' ? 'Textures' : event.phase === 'stage' ? 'Stages' : event.phase === 'comparing' ? `Comparing${event.round ? ` ${event.round}` : ''}` : event.phase === 'round' ? `Round ${event.round ?? ''}`.trim() : event.phase === 'done' ? 'Matched' : event.phase === 'offline' ? 'Needs a vision model' : 'Not compared';
  const sc = event.score;
  const pct = sc && sc.total > 0 ? Math.round((sc.passed / sc.total) * 100) : null;
  const p = (v: number): string => `${Math.round(v * 100)}%`;
  const measures = sc?.fidelity ? FIDELITY_KEYS.flatMap((k) => (sc.fidelity?.[k] !== undefined ? [`${FIDELITY_LABELS[k]} ${p(sc.fidelity[k] as number)}`] : [])) : [];
  return (
    <div className="ev ev--photo" data-testid={`photo-${event.phase}`}>
      <div className="ev__label">
        <Icon name="image" /> <span className={`status-chip is-${tone}`}>{label}</span>
        {pct !== null && sc && (
          <span className="photo__score" aria-label={`${sc.passed} of ${sc.total} items match${sc.judges ? ` (median of ${sc.judges} AI judges)` : sc.judgedBy === 'assistant' ? ' (judged by the assistant)' : ''}`} data-testid="photo-score">
            {sc.passed}/{sc.total} · {pct}%{sc.judge !== undefined && sc.judges ? ` · judges ${p(sc.judge)}` : ''}
            {sc.judgedBy === 'panel' ? ` · judged by ${sc.judges ?? 'several'} AI judges` : sc.judgedBy === 'assistant' ? ' · judged by the assistant' : ''}
            {sc.accepted === false ? ' · not kept' : ''}
          </span>
        )}
      </div>
      <p className="ev__desc">{event.text}</p>
      {event.stages && (event.phase === 'stage' || event.phase === 'done') && <StageList stages={event.stages} />}
      {measures.length > 0 && (
        <p className="photo__measures" data-testid="photo-measures" title="Deterministic measures of the room against the photo. They are evidence the AI judges were given; they are not the verdict and never decide whether a change is kept.">
          Measured, advisory: {measures.join(' · ')}
          {sc?.judges ? ` · ${sc.judges} judges${sc.spread !== undefined && sc.spread > 0.15 ? `, disagreeing ${p(sc.spread)}` : ''}` : ''}
          {sc?.preference ? ` · vs accepted: ${sc.preference === 'current' ? 'closer' : sc.preference === 'previous' ? 'further' : 'no difference'}` : ''}
        </p>
      )}
      {event.palette && event.palette.length > 0 && (
        <div className="photo__swatches" aria-label="Colours read from the picture">
          {event.palette.map((c) => (
            <span key={c} className="photo__swatch" style={{ background: c }} title={c} />
          ))}
        </div>
      )}
      {event.assumptions && event.assumptions.length > 0 && (
        <div className="photo__assume" role="group" aria-label="Assumptions">
          <p className="clarify__hint">What I assumed (tap one to change it):</p>
          {event.assumptions.map((a) => (
            <div key={a.id} className="photo__row">
              <span className="photo__text">{a.text}</span>
              {a.adjust && (
                <button type="button" className="chip chip--action" disabled={busy} onClick={() => void studio.send(a.adjust, { intent: 'refine' })} data-testid="photo-adjust" title={`Send: ${a.adjust}`}>
                  {a.adjust.length > 38 ? `${a.adjust.slice(0, 36)}…` : a.adjust}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {event.differences && event.differences.length > 0 && <DifferencesList items={event.differences} label="difference" />}
      {event.provenance && <ProvenancePanel prov={event.provenance} resumable={event.resumable === true} />}
      {event.score && event.score.failing.length > 0 && (
        <>
          <button type="button" className="diff-chips" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <span className="diff-chips__msg">{event.score.failing.length} still differ{event.score.failing.length === 1 ? 's' : ''}</span>
            <Icon name={open ? 'chevronUp' : 'chevronDown'} className="diff-chips__chev" />
          </button>
          {open && (
            <ul className="photo__failing">
              {event.score.failing.map((f) => (
                <li key={f.id}>
                  <b>{f.id}</b> {f.note && f.note !== 'not judged' ? f.note : f.text}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
});

/** Verification result card with per-test badges. */
const VerifyView = memo(function VerifyView({ event }: { event: Extract<ChatEventView, { type: 'verify' }> }): ReactElement {
  const [open, setOpen] = useState(!event.passed);
  const passed = event.results.filter((r) => r.passed).length;
  return (
    <div className={`ev ev--verify ${event.passed ? 'is-pass' : 'is-fail'}`}>
      <button type="button" className="verify-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`status-chip is-${event.passed ? 'ok' : 'bad'}`}>{event.passed ? 'Checks passed' : 'Checks failed'}</span>
        {event.results.length > 0 && (
          <span className="ev__meta">
            {passed}/{event.results.length} tests
          </span>
        )}
        {event.diagnostics.length > 0 && <span className="ev__meta">{event.diagnostics.length} notes</span>}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} />
      </button>
      {open && (
        <ul className="test-list">
          {event.results.map((r, i) => (
            <li key={`${r.id}-${i}`} className={r.passed ? 'is-pass' : 'is-fail'}>
              <Icon name={r.passed ? 'check' : 'x'} />
              <span className="test-list__id">{r.id}</span>
              <span className="test-list__msg">{r.message}</span>
            </li>
          ))}
          {event.diagnostics.map((d, i) => (
            <li key={`d${i}`} className={`sev-${d.severity}`}>
              <Icon name={d.severity === 'info' ? 'info' : 'alert'} />
              <span className="test-list__id">{d.code}</span>
              <span className="test-list__msg">{d.message}</span>
            </li>
          ))}
          {event.results.length === 0 && event.diagnostics.length === 0 && <li className="test-list__empty">{event.summary || 'No tests defined.'}</li>}
        </ul>
      )}
    </div>
  );
});

/** A notice; when the offline planner could not map the request it also offers the examples and the connect-AI action. */
const NoticeView = memo(function NoticeView({ event }: { event: Extract<ChatEventView, { type: 'notice' }> }): ReactElement {
  const studio = useStudio();
  const busy = useUI((s) => s.agentBusy);
  return (
    <div className={`ev ev--notice${event.tone === 'warning' ? ' is-warning' : ''}`} role="status" data-testid={event.offline ? 'offline-notice' : undefined}>
      <Icon name={event.tone === 'warning' ? 'alert' : 'info'} /> <span>{event.text}</span>
      {event.offline && (
        <div className="clarify__choices">
          <button type="button" className="chip chip--action" onClick={() => studio.store.getState().openSettings('ai')} data-testid="offline-connect">
            Connect an AI
          </button>
          {event.offline.examples.map((ex) => (
            <button key={ex} type="button" className="chip chip--action" disabled={busy} onClick={() => void studio.send(ex, { offline: true, intent: 'new' })}>
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

/** Renders one agent event. LLM text goes through the safe RichText renderer only. */
export const ChatEvent = memo(function ChatEvent({ event, live }: { event: ChatEventView; live: boolean }): ReactElement | null {
  switch (event.type) {
    case 'status':
      return (
        <div className={`ev ev--status${live ? ' is-live' : ''}`}>
          <span>{event.text}</span>
        </div>
      );
    case 'plan':
      return (
        <div className="ev ev--plan">
          <div className="ev__label">
            <Icon name="list" /> Plan
          </div>
          <RichText text={event.text} />
        </div>
      );
    case 'message':
      return (
        <div className="ev ev--message">
          <RichText text={event.text} />
        </div>
      );
    case 'error':
      return (
        <div className="ev ev--error" role="alert">
          <Icon name="alert" /> <span>{event.text}</span>
        </div>
      );
    case 'repair':
      return (
        <div className="ev ev--repair">
          <span className="status-chip is-warn">Repair {event.attempt}</span>
          <span className="ev__text">{event.text}</span>
        </div>
      );
    case 'patches':
      return <PatchesView event={event} />;
    case 'edit':
      return <EditView event={event} />;
    case 'clarify':
      return <ClarifyView event={event} />;
    case 'verify':
      return <VerifyView event={event} />;
    case 'generator':
      return (
        <div className="ev ev--generator">
          <div className="ev__label">
            <Icon name="code" /> Generator <code className="inline-code">{event.id}</code>
            <span className={`status-chip is-${event.ok ? 'ok' : 'bad'}`}>{event.ok ? 'Sandbox ok' : 'Rejected'}</span>
          </div>
          {event.description && <p className="ev__desc">{event.description}</p>}
          <CodeBlock code={event.source} lang="js" title={`${event.id}.js`} />
          {event.error && <p className="ev-errors">{event.error}</p>}
        </div>
      );
    case 'done': {
      const parts: string[] = [];
      if (event.via) parts.push(event.via);
      // The built-in planner is not a model: its internal name is not shown as one.
      const named = (event.models ?? []).filter((m) => m !== 'aether-mock');
      if (named.length > 0) parts.push(`answered by ${named.join(', ')}`);
      if (event.ms !== undefined) parts.push(formatElapsed(event.ms));
      // The offline planner estimates tokens from text length: those are not real model usage, never shown.
      if (event.calls > 0 && event.via !== 'Offline planner') parts.push(`${event.calls} model call${event.calls === 1 ? '' : 's'}`, `${compactCount(event.inputTokens)} in${event.cachedInputTokens ? ` (${compactCount(event.cachedInputTokens)} cached)` : ''} / ${compactCount(event.outputTokens)} out tokens`);
      return parts.length > 0 ? <div className="ev ev--done">{parts.join(' · ')}</div> : null;
    }
    // Steps are listed together (and folded) by the chat entry, not one by one.
    case 'step':
      return null;
    case 'notice':
      return <NoticeView event={event} />;
    case 'quality':
      return <QualityView event={event} />;
    case 'photo':
      return <PhotoView event={event} />;
    case 'review': {
      const tone = event.phase === 'approved' ? 'ok' : event.phase === 'stalled' || event.phase === 'limit' ? 'warn' : 'info';
      const label = event.phase === 'checking' ? 'Checking' : event.phase === 'found' ? 'Found' : event.phase === 'fixing' ? 'Fixing' : event.phase === 'approved' ? 'Checked' : event.phase === 'crosscheck' ? 'Independent check' : 'Stopped';
      return (
        <div className="ev ev--repair" role="status">
          <span className={`status-chip is-${tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'info'}`}>
            {label} {event.round > 0 ? event.round : ''}
          </span>
          <span className="ev__text">
            {event.text}
            {event.score !== undefined ? ` (automatic checks ${event.score}/100, advice for the assistant)` : ''}
          </span>
          {event.differences && event.differences.length > 0 && <DifferencesList items={event.differences} label="gap" />}
        </div>
      );
    }
  }
});

/** "12 s" / "1 min 05 s". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/** Quality score with an expandable rubric breakdown. */
const QualityView = memo(function QualityView({ event }: { event: Extract<ChatEventView, { type: 'quality' }> }): ReactElement {
  const [open, setOpen] = useState(false);
  const grade = event.score >= 85 ? 'ok' : event.score >= 72 ? 'fair' : 'low';
  const title = event.round === 0 ? 'Quality review' : `Quality after refinement ${event.round}`;
  return (
    <div className={`ev ev--quality is-${grade}`}>
      <button type="button" className="quality__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="quality__score" aria-label={`Quality score ${event.score} of 100`}>
          {event.score}
        </span>
        <span className="quality__text">
          <span className="quality__title">{title}</span>
          <span className="quality__summary">{event.applied.length > 0 ? `Improved: ${event.applied.join(', ')}.` : event.summary}</span>
          <span className="quality__source">{event.source === 'heuristic' ? 'Automatic checks only (no assistant reviewed the renders)' : 'Judged by the assistant from renders; automatic checks are advice'}</span>
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} className="quality__chev" />
      </button>
      {open && (
        <ul className="quality__rubric">
          {event.criteria.map((c) => (
            <li key={c.id} className="quality__row">
              <span className="quality__label">{c.label}</span>
              <span className="quality__bar" aria-hidden="true">
                <span className="quality__fill" style={{ width: `${Math.round(c.score * 10)}%` }} />
              </span>
              <span className="quality__value">{c.score.toFixed(1)}</span>
              {c.note && <span className="quality__note">{c.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
