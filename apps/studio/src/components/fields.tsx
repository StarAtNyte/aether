/**
 * Small form controls for the Inspector. Fields keep a local draft and only
 * commit on blur / Enter, so every edit is one undoable patch.
 */
import { memo, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { fieldNumber } from '../lib/format';

/** Labeled on/off switch row (label left, switch right). */
export const Toggle = memo(function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }): ReactElement {
  const id = useId();
  return (
    <label className={`toggle${hint ? ' toggle--hint' : ''}`} htmlFor={id}>
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {hint && <span className="toggle__hint">{hint}</span>}
      </span>
      <input id={id} className="toggle__input" type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </label>
  );
});

/** Parse a user-typed number; null when not finite. */
export function parseNumberInput(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '' || t.length > 32) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Numeric input with draft state, clamping and Enter/blur commit. */
export const NumberField = memo(function NumberField({
  value,
  onCommit,
  label,
  min,
  max,
  step = 0.1,
  disabled,
  axis,
}: {
  value: number;
  onCommit: (v: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  axis?: 'x' | 'y' | 'z';
}): ReactElement {
  const [draft, setDraft] = useState(fieldNumber(value));
  useEffect(() => setDraft(fieldNumber(value)), [value]);
  const commit = (): void => {
    const n = parseNumberInput(draft);
    if (n === null) {
      setDraft(fieldNumber(value));
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    setDraft(fieldNumber(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <label className={`num-field${axis ? ` num-field--${axis}` : ''}`}>
      {axis && (
        <span className="num-field__axis" aria-hidden="true">
          {axis.toUpperCase()}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') setDraft(fieldNumber(value));
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = parseNumberInput(draft) ?? value;
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round((base + d) * 1e6) / 1e6));
            setDraft(fieldNumber(next));
            onCommit(next);
          }
        }}
      />
    </label>
  );
});

/** Three numeric inputs for a Vec3. */
export const Vec3Field = memo(function Vec3Field({ label, value, onCommit, step, min, disabled }: { label: string; value: readonly [number, number, number]; onCommit: (v: [number, number, number]) => void; step?: number; min?: number; disabled?: boolean }): ReactElement {
  const set = (i: 0 | 1 | 2, n: number): void => {
    const next: [number, number, number] = [value[0], value[1], value[2]];
    next[i] = n;
    onCommit(next);
  };
  return (
    <div className="field-row">
      <span className="field-row__label" title={label}>
        {label}
      </span>
      <div className="vec3">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <NumberField key={axis} axis={axis} label={`${label} ${axis}`} value={value[i] as number} step={step} min={min} disabled={disabled} onCommit={(n) => set(i as 0 | 1 | 2, n)} />
        ))}
      </div>
    </div>
  );
});

/** Labeled row wrapper. */
export function FieldRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="field-row">
      <span className="field-row__label" title={label}>
        {label}
      </span>
      <div className="field-row__control">{children}</div>
    </div>
  );
}

/** Text input committing on blur/Enter. */
export const TextField = memo(function TextField({ value, onCommit, label, maxLength = 200, disabled, placeholder, mono }: { value: string; onCommit: (v: string) => void; label: string; maxLength?: number; disabled?: boolean; placeholder?: string; mono?: boolean }): ReactElement {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={`input input--sm${mono ? ' input--mono' : ''}`}
      value={draft}
      maxLength={maxLength}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        else if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
});

/** Human label for an enum value: "thirdPerson" → "Third person", "lamp-post" → "Lamp post". */
export function humanize(value: string): string {
  const s = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : value;
}

/** Native select over string options (labels are humanized unless `raw`). */
export function SelectField<T extends string>({ value, options, onChange, label, disabled, raw }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string; disabled?: boolean; raw?: boolean }): ReactElement {
  return (
    <select className="select select--sm" value={value} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {raw ? o : humanize(o)}
        </option>
      ))}
    </select>
  );
}

/** Color swatch + hex input. */
export const ColorField = memo(function ColorField({ value, onCommit, label, disabled }: { value: string; onCommit: (v: string) => void; label: string; disabled?: boolean }): ReactElement {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff';
  const [draft, setDraft] = useState(valid);
  useEffect(() => setDraft(valid), [valid]);
  return (
    <div className="color-field">
      <input className="color-field__swatch" type="color" value={draft} aria-label={label} disabled={disabled} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== valid && onCommit(draft.toLowerCase())} />
      <input
        className="input input--sm input--mono"
        value={draft}
        maxLength={7}
        disabled={disabled}
        aria-label={`${label} hex`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (/^#[0-9a-fA-F]{6}$/.test(draft)) {
            if (draft.toLowerCase() !== valid.toLowerCase()) onCommit(draft.toLowerCase());
          } else setDraft(valid);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
});

/**
 * Collapsible inspector section: a 32 px header row (chevron + title, with
 * optional controls on the right, e.g. an enable switch) and a body of
 * label/value rows. Open state is remembered per title for the session.
 */
const openSections = new Map<string, boolean>();

export function Section({ title, children, right, defaultOpen = true, icon }: { title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean; icon?: ReactNode }): ReactElement {
  const [open, setOpen] = useState(() => openSections.get(title) ?? defaultOpen);
  const id = useId();
  return (
    <section className={`section${open ? ' is-open' : ''}`}>
      <div className="section__head">
        <button
          type="button"
          className="section__toggle"
          onClick={() =>
            setOpen((o) => {
              openSections.set(title, !o);
              return !o;
            })
          }
          aria-expanded={open}
          aria-controls={id}
        >
          <svg className="section__chev" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {icon}
          <span className="section__title">{title}</span>
        </button>
        {right && <div className="section__right">{right}</div>}
      </div>
      {open && (
        <div className="section__body" id={id}>
          {children}
        </div>
      )}
    </section>
  );
}

/** Compact switch without a label row (for section headers and table cells). */
export const Switch = memo(function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }): ReactElement {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="switch__thumb" aria-hidden="true" />
    </button>
  );
});

/**
 * Range slider with a numeric readout that is itself editable. The value
 * commits on release / Enter (one undoable edit), not on every drag step.
 */
export const SliderField = memo(function SliderField({
  label,
  value,
  min,
  max,
  step,
  onCommit,
  disabled,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  format?: (v: number) => string;
}): ReactElement {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (v: number): void => {
    const n = Math.min(max, Math.max(min, v));
    if (n !== value) onCommit(n);
  };
  const pct = max > min ? ((draft - min) / (max - min)) * 100 : 0;
  return (
    <div className="slider-field">
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-label={label}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => commit(draft)}
        onKeyUp={() => commit(draft)}
        onBlur={() => commit(draft)}
      />
      <span className="slider-field__value" aria-hidden="true">
        {format ? format(draft) : fieldNumber(draft, 2)}
      </span>
    </div>
  );
});
