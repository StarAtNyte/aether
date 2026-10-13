/** Segmented control (radio group) with arrow-key navigation. */
import { useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';

/** Segmented control. Options are `[value, label]` pairs; a label may be a node (icon + text). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  stretch,
  size = 'md',
  disabled,
  titles,
}: {
  value: T;
  options: ReadonlyArray<readonly [T, ReactNode]>;
  onChange: (v: T) => void;
  label: string;
  stretch?: boolean;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Tooltip per value. */
  titles?: Partial<Record<T, string>>;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = options.findIndex(([v]) => v === value);
    const n = options.length;
    const next = options[(i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n];
    if (!next) return;
    onChange(next[0]);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div ref={ref} className={`segmented segmented--${size}${stretch ? ' segmented--stretch' : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          tabIndex={value === v ? 0 : -1}
          className="segmented__btn"
          disabled={disabled}
          onClick={() => onChange(v)}
          data-tip={titles?.[v]}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
