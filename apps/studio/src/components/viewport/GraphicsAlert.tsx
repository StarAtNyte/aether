/**
 * The renderer stepped down (the view stayed blank) or a shader failed to build: one honest message over the
 * viewport, a Safe mode switch, and the diagnostics the user can copy. Shown only when something went wrong.
 */
import { memo, useState, type ReactElement } from 'react';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';

/** Copy text to the clipboard (falls back to a hidden textarea where the async API is missing). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export const GraphicsAlert = memo(function GraphicsAlert(): ReactElement | null {
  const studio = useStudio();
  const alert = useUI((s) => s.graphicsAlert);
  const safe = useUI((s) => s.safeGraphics);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  if (!alert) return null;
  const text = open ? studio.graphicsDiagnostics() : alert.diagnostics;
  return (
    <div className="vp-gfx" role="alert" data-testid="graphics-alert">
      <div className="vp-gfx__row">
        <span className="vp-gfx__icon">
          <Icon name="alert" size={16} />
        </span>
        <p className="vp-gfx__text">{alert.message}</p>
        <label className="vp-gfx__safe">
          <input type="checkbox" checked={safe} onChange={(e) => studio.setSafeGraphics(e.target.checked)} />
          Safe mode
        </label>
        <button type="button" className="vp-gfx__btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Diagnostics
        </button>
        <button
          type="button"
          className="vp-gfx__btn"
          onClick={() => {
            void copyText(studio.graphicsDiagnostics()).then((ok) => setCopied(ok ? 'ok' : 'failed'));
          }}
        >
          {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Copy failed: select the text' : 'Copy diagnostics'}
        </button>
        <button type="button" className="vp-gfx__btn" aria-label="Dismiss" onClick={() => studio.store.getState().setGraphicsAlert(null)}>
          Dismiss
        </button>
      </div>
      {open && (
        <pre className="vp-gfx__log" tabIndex={0}>
          {text}
        </pre>
      )}
    </div>
  );
});
