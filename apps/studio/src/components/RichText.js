import { jsx as _jsx } from "react/jsx-runtime";
import { memo, useMemo } from 'react';
import { parseRichText } from '../lib/richText';
import { CodeBlock } from './CodeBlock';
function renderInlines(inlines) {
    return inlines.map((node, i) => {
        switch (node.type) {
            case 'bold':
                return _jsx("strong", { children: node.text }, i);
            case 'code':
                return _jsx("code", { className: "inline-code", children: node.text }, i);
            default:
                return _jsx("span", { children: node.text }, i);
        }
    });
}
/**
 * Renders untrusted (LLM) text safely: parsed into a data tree by
 * {@link parseRichText} and emitted only as React text nodes — never HTML.
 */
export const RichText = memo(function RichText({ text, collapseCode = true }) {
    const blocks = useMemo(() => parseRichText(text), [text]);
    return (_jsx("div", { className: "rich-text", children: blocks.map((b, i) => {
            if (b.type === 'code')
                return _jsx(CodeBlock, { code: b.code, lang: b.lang, collapsible: collapseCode }, i);
            if (b.type === 'list')
                return (_jsx("ul", { children: b.items.map((item, j) => (_jsx("li", { children: renderInlines(item) }, j))) }, i));
            return _jsx("p", { children: renderInlines(b.inlines) }, i);
        }) }));
});
