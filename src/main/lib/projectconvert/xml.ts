'use strict';

/**
 * A small, fast XML reader for project files. No dependency needed.
 *
 * Ableton sets can unpack to tens of megabytes of XML, so this walks the text
 * with indexOf rather than a character-at-a-time state machine. It handles
 * what DAW project files actually contain: elements, attributes, self-closing
 * tags, comments, processing instructions, CDATA and the five entities plus
 * numeric references. Text content is kept but rarely needed — DAWs put
 * almost everything in attributes.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function decode(value: string): string {
  if (value.indexOf('&') === -1) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (whole, body) => {
    if (body === 'amp') return '&';
    if (body === 'lt') return '<';
    if (body === 'gt') return '>';
    if (body === 'quot') return '"';
    if (body === 'apos') return "'";
    const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });
}

export function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let pos = 0;
  const length = text.length;

  while (pos < length) {
    const lt = text.indexOf('<', pos);
    if (lt === -1) break;
    if (lt > pos) {
      const chunk = text.slice(pos, lt);
      if (chunk.trim()) stack[stack.length - 1].text += decode(chunk);
    }

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      pos = end === -1 ? length : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += text.slice(lt + 9, end === -1 ? length : end);
      pos = end === -1 ? length : end + 3;
      continue;
    }
    if (text[lt + 1] === '?' || text[lt + 1] === '!') {
      const end = text.indexOf('>', lt + 1);
      pos = end === -1 ? length : end + 1;
      continue;
    }

    const gt = findTagEnd(text, lt + 1);
    if (gt === -1) break;

    if (text[lt + 1] === '/') {
      const name = text.slice(lt + 2, gt).trim();
      // Pop to the matching element. Tolerates a stray close tag instead of
      // corrupting the whole tree.
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
      pos = gt + 1;
      continue;
    }

    const selfClosing = text[gt - 1] === '/';
    const inner = text.slice(lt + 1, selfClosing ? gt - 1 : gt);
    const nameEnd = inner.search(/[\s/]/);
    const name = nameEnd === -1 ? inner : inner.slice(0, nameEnd);
    const attrs: Record<string, string> = {};
    if (nameEnd !== -1) {
      ATTR_RE.lastIndex = 0;
      let m;
      while ((m = ATTR_RE.exec(inner))) {
        attrs[m[1]] = decode(m[3] !== undefined ? m[3] : m[4]);
      }
    }
    const node: XmlNode = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    pos = gt + 1;
  }

  return root;
}

/** The closing `>` of a tag, skipping any `>` inside quoted attribute values. */
function findTagEnd(text: string, from: number): number {
  let quote = '';
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

/* ------------------------------ queries ---------------------------- */

export function child(node: XmlNode | null | undefined, name: string): XmlNode | null {
  if (!node) return null;
  for (const c of node.children) if (c.name === name) return c;
  return null;
}

export function children(node: XmlNode | null | undefined, name?: string): XmlNode[] {
  if (!node) return [];
  return name ? node.children.filter((c) => c.name === name) : node.children;
}

/** Follow a path of child names: path(node, 'Mixer', 'Volume', 'Manual'). */
export function path(node: XmlNode | null | undefined, ...names: string[]): XmlNode | null {
  let current = node || null;
  for (const name of names) {
    current = child(current, name);
    if (!current) return null;
  }
  return current;
}

/** Every descendant with this name, depth first, not descending into matches. */
export function findAll(node: XmlNode | null | undefined, name: string, out: XmlNode[] = []): XmlNode[] {
  if (!node) return out;
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    else findAll(c, name, out);
  }
  return out;
}

/** Ableton's `<Thing Value="..."/>` idiom. */
export function value(node: XmlNode | null | undefined, ...names: string[]): string | null {
  const target = names.length ? path(node, ...names) : node;
  return target && target.attrs.Value !== undefined ? target.attrs.Value : null;
}

export function num(raw: string | null | undefined, fallback = 0): number {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/* ------------------------------ writing ---------------------------- */

export function escapeXml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters other than tab/newline are illegal in XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

export function attrs(map: Record<string, unknown>): string {
  return Object.entries(map)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join('');
}
