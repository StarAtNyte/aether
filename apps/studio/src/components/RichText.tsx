import { memo, useMemo, type ReactElement } from 'react';
import { parseRichText, type Inline } from '../lib/richText';
import { CodeBlock } from './CodeBlock';

function renderInlines(inlines: readonly Inline[]): ReactElement[] {
  return inlines.map((node, i) => {
    switch (node.type) {
      case 'bold':
        return <strong key={i}>{node.text}</strong>;
      case 'code':
        return <code key={i} className="inline-code">{node.text}</code>;
      default:
        return <span key={i}>{node.text}</span>;
    }
  });
}

/**
 * Renders untrusted (LLM) text safely: parsed into a data tree by
 * {@link parseRichText} and emitted only as React text nodes — never HTML.
 */
export const RichText = memo(function RichText({ text, collapseCode = true }: { text: string; collapseCode?: boolean }) {
  const blocks = useMemo(() => parseRichText(text), [text]);
  return (
    <div className="rich-text">
      {blocks.map((b, i) => {
        if (b.type === 'code') return <CodeBlock key={i} code={b.code} lang={b.lang} collapsible={collapseCode} />;
        if (b.type === 'list')
          return (
            <ul key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{renderInlines(item)}</li>
              ))}
            </ul>
          );
        return <p key={i}>{renderInlines(b.inlines)}</p>;
      })}
    </div>
  );
});
