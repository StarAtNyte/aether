/**
 * Safe "markdown-ish" parser for LLM text.
 *
 * LLM output is untrusted, so it is NEVER rendered as HTML. Instead this
 * module parses a tiny subset (``` fenced code, `inline code`, **bold**,
 * bullet lines) into a plain data tree that React renders as text nodes —
 * React escapes every string, so `<script>` stays literal text.
 */

/** Inline span inside a paragraph. */
export type Inline = { type: 'text'; text: string } | { type: 'bold'; text: string } | { type: 'code'; text: string };

/** Block-level node. */
export type Block =
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; items: Inline[][] }
  | { type: 'code'; lang: string; code: string };

/** Hard cap on parsed input length (characters); the rest is cut with a marker. */
export const MAX_RICH_TEXT = 20_000;
const FENCE = /^\s*```\s*([A-Za-z0-9_+-]{0,20})\s*$/;
const BULLET = /^\s*(?:[-*•]|\d{1,3}[.)])\s+(.*)$/;

/** Parse untrusted text into blocks. Linear time, never throws. */
export function parseRichText(input: string): Block[] {
  let text = typeof input === 'string' ? input : String(input ?? '');
  if (text.length > MAX_RICH_TEXT) text = `${text.slice(0, MAX_RICH_TEXT)}\n…(truncated)`;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] = [];

  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ type: 'paragraph', inlines: parseInline(para.join('\n')) });
      para = [];
    }
  };
  const flushList = (): void => {
    if (list.length > 0) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fence = FENCE.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] as string)) code.push(lines[i++] as string);
      // An unterminated fence swallows the rest of the text as code (still safe).
      blocks.push({ type: 'code', lang: (fence[1] ?? '').toLowerCase(), code: code.join('\n') });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      list.push(parseInline(bullet[1] ?? ''));
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

/** Parse `**bold**` and `` `code` `` spans. Unbalanced markers stay literal. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  let i = 0;
  const pushText = (): void => {
    if (buf) {
      out.push({ type: 'text', text: buf });
      buf = '';
    }
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        pushText();
        out.push({ type: 'code', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (ch === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        pushText();
        out.push({ type: 'bold', text: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  pushText();
  return out;
}
