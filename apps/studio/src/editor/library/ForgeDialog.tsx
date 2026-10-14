/**
 * The asset forge dialog: drop / paste / pick a reference image and / or
 * describe an object; the connected model writes a parametric generator,
 * every iteration is rendered from four sides and critiqued against the
 * reference, and the strip below shows each iteration live with its score
 * and what still differs. Accept saves it to the library and places it.
 */
import { memo, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactElement } from 'react';
import { useStore } from 'zustand';
import { useStudio } from '../../app/context';
import { Dialog } from '../../components/ui/Dialog';
import { Icon } from '../../components/Icon';
import { MAX_REFERENCE_BYTES } from '../../engine/forge';

const IMAGE_TYPES = /^image\/(png|jpeg|webp)$/;

function readDataUrl(file: File): Promise<string | null> {
  if (!IMAGE_TYPES.test(file.type) || file.size > MAX_REFERENCE_BYTES) return Promise.resolve(null);
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

/** The forge dialog (state lives in the forge controller). */
export const ForgeDialog = memo(function ForgeDialog(): ReactElement | null {
  const studio = useStudio();
  const forge = studio.forge;
  const open = useStore(forge.state, (s) => s.open);
  const status = useStore(forge.state, (s) => s.status);
  const stage = useStore(forge.state, (s) => s.stage);
  const iterations = useStore(forge.state, (s) => s.iterations);
  const message = useStore(forge.state, (s) => s.message);
  const result = useStore(forge.state, (s) => s.result);
  const score = useStore(forge.state, (s) => s.resultScore);
  const passed = useStore(forge.state, (s) => s.passed);
  const base = useStore(forge.state, (s) => s.base);
  const [text, setText] = useState('');
  const [reference, setReference] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // A fresh dialog starts empty (a running forge keeps its inputs).
  useEffect(() => {
    if (open && forge.state.getState().status !== 'running') {
      setText('');
      setReference(null);
    }
  }, [open, base, forge]);
  if (!open) return null;
  const avail = forge.availability();
  const running = status === 'running';
  const take = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const url = await readDataUrl(file);
    if (url) setReference(url);
    else studio.store.getState().toast('Use a PNG, JPEG or WebP image under 6 MB.', 'error', 4);
  };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setDragOver(false);
    void take(e.dataTransfer.files[0]);
  };
  const onPaste = (e: ClipboardEvent): void => {
    const file = [...e.clipboardData.files].find((f) => IMAGE_TYPES.test(f.type));
    if (file) {
      e.preventDefault();
      void take(file);
    }
  };
  const canRun = avail.ok && !running && (text.trim().length > 0 || reference !== null);
  const title = base ? `Refine “${base.id}”` : 'Create from an image or a description';
  return (
    <Dialog
      open={open}
      onClose={() => forge.close()}
      title={title}
      description="A connected model writes an editable, parametric 3D generator, renders it from four sides and corrects it against your reference until it matches."
      size="lg"
      className="forge-dialog"
      footer={
        <>
          {running ? (
            <button type="button" className="btn" onClick={() => forge.cancel()}>
              Stop
            </button>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={() => forge.close()}>
              Close
            </button>
          )}
          {result && !running && (
            <button type="button" className="btn" onClick={() => void forge.accept()} data-tip="Save to your library and place it in the world">
              <Icon name="check" />
              Add to world
            </button>
          )}
          <button type="button" className="btn btn--primary" disabled={!canRun} onClick={() => void forge.run(text.trim(), base ? null : reference)}>
            <Icon name="sparkles" />
            {base ? 'Apply change' : result ? 'Forge again' : 'Forge'}
          </button>
        </>
      }
    >
      <div className="forge" onPaste={onPaste}>
        {!avail.ok && <p className="forge__notice is-warn">{avail.reason}</p>}
        {avail.ok && avail.reason && <p className="forge__notice">{avail.reason}</p>}
        <div className="forge__inputs">
          {!base && (
            <button
              type="button"
              className={`forge__drop${dragOver ? ' is-over' : ''}${reference ? ' has-image' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              aria-label={reference ? 'Replace the reference image' : 'Add a reference image'}
              disabled={running}
            >
              {reference ? <img src={reference} alt="Reference" /> : (
                <span className="forge__drop-hint">
                  <Icon name="image" size={22} />
                  <strong>Reference image</strong>
                  <span>Drop, paste or pick a photo (optional)</span>
                </span>
              )}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              input.value = '';
              void take(file);
            }}
          />
          <label className="forge__text">
            <span className="forge__label">{base ? 'What should change?' : 'Describe it'}</span>
            <textarea
              value={text}
              maxLength={1500}
              rows={base ? 3 : 5}
              disabled={running}
              placeholder={base ? 'taller, walnut wood, thinner legs' : 'an ornate stone fountain with three tiers and lion heads'}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        </div>
        {(running || iterations.length > 0 || message) && (
          <div className="forge__progress" aria-live="polite">
            {running && (
              <p className="forge__stage">
                <span className="spinner" aria-hidden="true" /> {stage || 'Working…'}
              </p>
            )}
            {!running && message && <p className={`forge__result${passed ? ' is-pass' : ''}`}>{message}{score !== null ? ` Score ${Math.round(score * 100)}/100.` : ''}</p>}
            <ol className="forge__strip">
              {iterations.map((it) => (
                <li key={it.index} className="forge__iter">
                  <div className="forge__sheet">{it.sheet ? <img src={it.sheet} alt={`Iteration ${it.index + 1}: front, side, top and three-quarter views`} /> : <Icon name="alert" />}</div>
                  <div className="forge__meta">
                    <strong>
                      Pass {it.index + 1}
                      {it.score !== null ? ` · ${Math.round(it.score * 100)}/100` : ''}
                    </strong>
                    {it.error && <span className="forge__err">{it.error}</span>}
                    {it.summary && <span>{it.summary}</span>}
                    {it.missing.length > 0 && <span className="forge__missing">Still different: {it.missing.slice(0, 3).join('; ')}</span>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Dialog>
  );
});
