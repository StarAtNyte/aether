/**
 * Small form controls for the Inspector. Fields keep a local draft and only
 * commit on blur / Enter, so every edit is one undoable patch.
 */
import { memo, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { fieldNumber } from '../lib/format';

/** Labeled on/off switch. */
export const Toggle = memo(function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }): ReactElement {
  const id = useId();
  return (
    <label className="toggle" htmlFor={id}>
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {hint && <span className="toggle__hint">{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" aria-hidden="true" />
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
      {axis && <span className="num-field__label">{axis.toUpperCase()}</span>}
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
      <span className="field-row__label">{label}</span>
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
      <span className="field-row__label">{label}</span>
      <div className="field-row__control">{children}</div>
    </div>
  );
}

/** Text input committing on blur/Enter. */
export const TextField = memo(function TextField({ value, onCommit, label, maxLength = 200, disabled, placeholder }: { value: string; onCommit: (v: string) => void; label: string; maxLength?: number; disabled?: boolean; placeholder?: string }): ReactElement {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="text-field"
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

/** Native select over string options. */
export function SelectField<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string; disabled?: boolean }): ReactElement {
  return (
    <select className="select-field" value={value} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
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
      <input type="color" value={draft} aria-label={label} disabled={disabled} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== valid && onCommit(draft.toLowerCase())} />
      <input
        className="text-field text-field--mono"
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
