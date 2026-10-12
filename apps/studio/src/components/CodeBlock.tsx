import { memo, useState } from 'react';
import { Icon } from './Icon';

const COLLAPSED_LINES = 6;

/** Monospace code block with optional collapse and copy-to-clipboard. Content is rendered as text only. */
export const CodeBlock = memo(function CodeBlock({ code, lang, title, collapsible = true }: { code: string; lang?: string; title?: string; collapsible?: boolean }) {
  const lineCount = code.split('\n').length;
  const canCollapse = collapsible && lineCount > COLLAPSED_LINES;
  const [open, setOpen] = useState(!canCollapse);
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => undefined);
  };

  return (
    <div className={`code-block${open ? ' is-open' : ''}`}>
      <div className="code-block__bar">
        <span className="code-block__lang">{title ?? (lang || 'code')}</span>
        <span className="code-block__meta">{lineCount} lines</span>
        <button type="button" className="icon-btn icon-btn--xs" onClick={copy} title="Copy code" aria-label="Copy code">
          <Icon name={copied ? 'check' : 'copy'} size={12} />
        </button>
        {canCollapse && (
          <button type="button" className="icon-btn icon-btn--xs" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? 'Collapse' : 'Expand'}>
            <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} />
          </button>
        )}
      </div>
      <pre className="code-block__pre">
        <code>{open ? code : code.split('\n').slice(0, COLLAPSED_LINES).join('\n')}</code>
      </pre>
    </div>
  );
});
