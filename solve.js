// A fast drop-in for makefun-site 1.0.0, written from its README and the
// behaviour of its reference code. Same answers, byte for byte, on every
// input; built to spend as little CPU as possible doing it. No imports,
// no state shared between cases: every cache is created inside run().

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const RESERVED = ['posts', 'tags', 'page'];
const ESCAPABLE = '\\`*_[]()#+-.!>';
const MARKS = /\p{M}/gu;
const HTML_SPECIAL = /[&<>"']/;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

// Whether a code unit counts as whitespace, matching JavaScript \s.
function isWsCode(code) {
  if (code <= 32) return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32;
  return code === 160 || code === 1680 || (code >= 8192 && code <= 8202) || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
}

// Runs of non-whitespace characters, as /\S+/g would count them, without
// building the match array the reference builds.
function countWords(text) {
  let n = 0, inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (isWsCode(text.charCodeAt(i))) inWord = false;
    else if (!inWord) { inWord = true; n++; }
  }
  return n;
}

function escapeHtml(text) {
  if (!HTML_SPECIAL.test(text)) return text;
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// The slug rule: NFKD, combining marks dropped, A-Z lowered, each run of
// other characters one '-', trimmed at both ends, cut to 64 (a trailing
// '-' at the cut dropped), 'untitled' when nothing is left. Pure-ASCII
// text needs no normalisation at all, which covers nearly every title.
function slugify(text, cache) {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  let plain = text, ascii = true;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) >= 128) { ascii = false; break; }
  if (!ascii) plain = text.normalize('NFKD').replace(MARKS, '');
  let out = '', gap = false;
  for (let i = 0; i < plain.length; i++) {
    const ch = plain[i], code = plain.charCodeAt(i);
    let keep = null;
    if (code >= 65 && code <= 90) keep = ch.toLowerCase();
    else if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) keep = ch;
    if (keep === null) { gap = out.length > 0; continue; }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, 64).replace(/-+$/, '');
  if (out === '') out = 'untitled';
  cache.set(text, out);
  return out;
}

// First of slug, slug-2, slug-3, ... not yet taken. The per-base counter
// only ever moves forward, and taken only grows, so starting the probe
// there returns exactly the same name the one-by-one scan would.
function uniqueSlug(base, taken, next) {
  if (!taken.has(base)) { taken.add(base); return base; }
  let n = next.get(base) || 2, cand;
  do { cand = base + '-' + n; n++; } while (taken.has(cand));
  taken.add(cand);
  next.set(base, n);
  return cand;
}

function longDate(date, cache) {
  let hit = cache.get(date);
  if (hit === undefined) {
    hit = Number(date.slice(8, 10)) + ' ' + MONTHS[Number(date.slice(5, 7)) - 1] + ' ' + date.slice(0, 4);
    cache.set(date, hit);
  }
  return hit;
}

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

// ---------------------------------------------------------------- front matter

const FM_KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function fmString(raw, key) {
  if (raw[0] === '"') {
    if (raw.length < 2 || raw[raw.length - 1] !== '"') return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw[0] === '[') return { error: 'a bare string opens on [' };
  return { value: raw };
}

function fmValue(key, raw) {
  if (key === 'title' || key === 'summary') {
    const s = fmString(raw, key);
    return 'error' in s ? { error: 'key "' + key + '": ' + s.error } : s;
  }
  if (key === 'date') {
    let ok = raw.length === 10 && raw[4] === '-' && raw[7] === '-';
    let y = 0, mo = 0, d = 0;
    if (ok) {
      for (let i = 0; i < 10; i++) {
        if (i === 4 || i === 7) continue;
        const c = raw.charCodeAt(i);
        if (c < 48 || c > 57) { ok = false; break; }
      }
      y = Number(raw.slice(0, 4)); mo = Number(raw.slice(5, 7)); d = Number(raw.slice(8, 10));
    }
    if (!ok || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
      return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    }
    return { value: raw };
  }
  if (key === 'tags') {
    if (raw[0] !== '[' || raw[raw.length - 1] !== ']') return { error: 'key "tags": not a list [a, b]' };
    const inner = raw.slice(1, -1);
    if (inner.trim() === '') return { value: [] };
    const tags = inner.split(',');
    for (let i = 0; i < tags.length; i++) {
      tags[i] = tags[i].trim();
      const t = tags[i];
      if (t === '') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      for (let j = 0; j < t.length; j++) {
        const c = t[j];
        if (c === '"' || c === '[' || c === ']') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      }
    }
    return { value: tags };
  }
  if (key === 'draft') {
    if (raw === 'true') return { value: true };
    if (raw === 'false') return { value: false };
    return { error: 'key "draft": true or false' };
  }
  if (key === 'layout') {
    if (raw.length === 0) return { error: 'key "layout": not a template name' };
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i);
      const ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45;
      if (!ok) return { error: 'key "layout": not a template name' };
    }
    return { value: raw };
  }
  // slug: a-z and 0-9, single '-' between, at most 64 characters.
  if (raw.length === 0 || raw.length > 64) return { error: 'key "slug": not a slug' };
  let prevDash = true;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 45) {
      if (prevDash) return { error: 'key "slug": not a slug' };
      prevDash = true;
    } else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) prevDash = false;
    else return { error: 'key "slug": not a slug' };
  }
  if (prevDash) return { error: 'key "slug": not a slug' };
  return { value: raw };
}

// Returns {data, body} or {error}. Only the lines up to the closing '---'
// are ever walked; the body is a slice, never split and re-joined.
function parseFrontMatter(text) {
  let nl = text.indexOf('\n');
  if ((nl === -1 ? text : text.slice(0, nl)) !== '---') return { error: 'no front matter' };
  if (nl === -1) return { error: 'the front matter is not closed' };
  const fmLines = [];
  let pos = nl + 1, closeEnd = -1;
  for (;;) {
    const e = text.indexOf('\n', pos);
    const line = e === -1 ? text.slice(pos) : text.slice(pos, e);
    if (line === '---') { closeEnd = e; break; }
    fmLines.push(line);
    if (e === -1) return { error: 'the front matter is not closed' };
    pos = e + 1;
  }
  const data = {};
  for (let k = 0; k < fmLines.length; k++) {
    const line = fmLines[k], lineNo = k + 2;
    let blank = true;
    for (let i = 0; i < line.length; i++) {
      const c = line.charCodeAt(i);
      if (c !== 32 && c !== 9) { blank = false; break; }
    }
    if (blank || line[0] === '#') continue;
    // /^([a-z_]+):(?: (.*))?$/ — the key, then either the end of the line
    // or one space and the rest.
    const colon = line.indexOf(':');
    if (colon < 1) return { error: 'line ' + lineNo + ' is not "key: value"' };
    let keyOk = true;
    for (let i = 0; i < colon; i++) {
      const c = line.charCodeAt(i);
      if (!((c >= 97 && c <= 122) || c === 95)) { keyOk = false; break; }
    }
    if (!keyOk) return { error: 'line ' + lineNo + ' is not "key: value"' };
    let raw;
    if (colon === line.length - 1) raw = '';
    else if (line[colon + 1] === ' ') raw = line.slice(colon + 2);
    else return { error: 'line ' + lineNo + ' is not "key: value"' };
    let end = raw.length;
    while (end > 0 && (raw.charCodeAt(end - 1) === 32 || raw.charCodeAt(end - 1) === 9)) end--;
    raw = raw.slice(0, end);
    const key = line.slice(0, colon);
    if (!FM_KEYS.has(key)) return { error: 'unknown key "' + key + '"' };
    if (hasOwn(data, key)) return { error: 'key "' + key + '" is given twice' };
    if (raw === '') return { error: 'key "' + key + '" has no value' };
    const v = fmValue(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: closeEnd === -1 ? '' : text.slice(closeEnd + 1) };
}

// ---------------------------------------------------------------- Markdown

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function trimLine(line) {
  let a = 0, b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return line.slice(a, b);
}

function langChar(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95 || code === 43 || code === 45;
}

// A fence-opening line, returning its language, or null.
function fenceLang(line) {
  if (line.length < 3 || line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return null;
  let k = 3;
  while (k < line.length && langChar(line.charCodeAt(k))) k++;
  const lang = line.slice(3, k);
  while (k < line.length && (line.charCodeAt(k) === 32 || line.charCodeAt(k) === 9)) k++;
  return k === line.length ? lang : null;
}

function fenceClose(line) {
  if (line.length < 3 || line[0] !== '`' || line[1] !== '`' || line[2] !== '`') return false;
  for (let k = 3; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// A heading line, or null: 1-6 '#', a space or tab, then non-blank text
// (trailing spaces and tabs dropped; closing '#'s kept as text).
function headingInfo(line) {
  let hashes = 0;
  while (hashes < line.length && line[hashes] === '#') hashes++;
  if (hashes === 0 || hashes > 6) return null;
  const c = line.charCodeAt(hashes);
  if (c !== 32 && c !== 9) return null;
  let b = line.length;
  while (b > hashes && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  if (b === hashes + 1 && (line.charCodeAt(hashes) === 32 || line.charCodeAt(hashes) === 9)) {
    // Only spaces/tabs after the hashes: check the text is not empty.
    let allWs = true;
    for (let i = hashes; i < b; i++) { const cc = line.charCodeAt(i); if (cc !== 32 && cc !== 9) { allWs = false; break; } }
    if (allWs) return null;
  }
  // The text is everything after the first space/tab run, trailing
  // spaces/tabs dropped; if that is empty it is not a heading.
  let a = hashes;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  if (a === b) return null;
  return { depth: hashes, text: line.slice(a, b) };
}

function isHr(line) {
  if (line.length < 3) return false;
  const ok = (line[0] === '-' && line[1] === '-' && line[2] === '-') || (line[0] === '*' && line[1] === '*' && line[2] === '*');
  if (!ok) return false;
  for (let k = 3; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function endsParagraph(line) {
  return isBlank(line) || fenceLang(line) !== null || headingInfo(line) !== null || isHr(line);
}

function findUnescaped(s, what, from) {
  const wl = what.length;
  for (let j = from; j + wl <= s.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.indexOf(s[j + 1]) !== -1) { j++; continue; }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.indexOf(s[j + 1]) !== -1) { j++; continue; }
    if (c !== '*') continue;
    if (s[j + 1] === '*') { j++; continue; }
    return j;
  }
  return -1;
}

// The index of the next character inline parsing treats specially, or the
// end of the string: plain runs between specials need no escaping.
function nextSpecial(s, from) {
  let best = s.length;
  const idx = [s.indexOf('\\', from), s.indexOf('`', from), s.indexOf('*', from), s.indexOf('[', from), s.indexOf('&', from), s.indexOf('<', from), s.indexOf('>', from), s.indexOf('"', from), s.indexOf("'", from)];
  for (let i = 0; i < idx.length; i++) if (idx[i] !== -1 && idx[i] < best) best = idx[i];
  return best;
}

function inlineRender(s, link) {
  let out = '', i = 0;
  const n = s.length;
  while (i < n) {
    const j = nextSpecial(s, i);
    if (j > i) { out += s.slice(i, j); i = j; }
    if (i >= n) break;
    const c = s[i];
    if (c === '&') { out += '&amp;'; i++; continue; }
    if (c === '<') { out += '&lt;'; i++; continue; }
    if (c === '>') { out += '&gt;'; i++; continue; }
    if (c === '"') { out += '&quot;'; i++; continue; }
    if (c === "'") { out += '&#39;'; i++; continue; }
    if (c === '\\') {
      if (i + 1 < n && ESCAPABLE.indexOf(s[i + 1]) !== -1) { out += escapeHtml(s[i + 1]); i += 2; }
      else { out += '\\'; i++; }
      continue;
    }
    if (c === '`') {
      const k = s.indexOf('`', i + 1);
      if (k > i + 1) { out += '<code>' + escapeHtml(s.slice(i + 1, k)) + '</code>'; i = k + 1; }
      else { out += '`'; i++; }
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const k = findUnescaped(s, '**', i + 2);
        if (k > i + 2) { out += '<strong>' + inlineRender(s.slice(i + 2, k), link) + '</strong>'; i = k + 2; }
        else { out += '**'; i += 2; }
      } else {
        const k = findSingleStar(s, i + 1);
        if (k > i + 1) { out += '<em>' + inlineRender(s.slice(i + 1, k), link) + '</em>'; i = k + 1; }
        else { out += '*'; i++; }
      }
      continue;
    }
    // '[': the first unescaped ']' closes the text, '(' must follow at
    // once, and the next ')' closes a target with no whitespace in it.
    const k = findUnescaped(s, ']', i + 1);
    const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
    const target = m === -1 ? '' : s.slice(k + 2, m);
    if (target !== '' && !/\s/.test(target)) {
      out += '<a href="' + escapeHtml(link(target)) + '">' + inlineRender(s.slice(i + 1, k), link) + '</a>';
      i = m + 1;
    } else { out += '['; i++; }
  }
  return out;
}

// Renders one body straight into blocks, with no token array in between.
// Returns {html, toc, excerpt}.
function renderMarkdown(src, link, slugCache) {
  const lines = src.split('\n');
  const ids = new Set(), idNext = new Map();
  const blocks = [], toc = [];
  let excerpt = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const lang = fenceLang(line);
    if (lang !== null) {
      let code = '';
      i++;
      while (i < lines.length && !fenceClose(lines[i])) { code += escapeHtml(lines[i]) + '\n'; i++; }
      i++;
      const cls = lang === '' ? '' : ' class="language-' + escapeHtml(lang) + '"';
      blocks.push('<pre><code' + cls + '>' + code + '</code></pre>');
      continue;
    }
    const heading = headingInfo(line);
    if (heading !== null) {
      const id = uniqueSlug(slugify(heading.text, slugCache), ids, idNext);
      const html = inlineRender(heading.text, link);
      blocks.push('<h' + heading.depth + ' id="' + id + '">' + html + '</h' + heading.depth + '>');
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
      i++;
      continue;
    }
    if (isHr(line)) { blocks.push('<hr>'); i++; continue; }
    if (line[0] === '>') {
      const parts = [];
      while (i < lines.length && lines[i][0] === '>') {
        const raw = lines[i].replace(/^> ?/, '');
        const t = trimLine(raw);
        if (t !== '') parts.push(t);
        i++;
      }
      blocks.push(parts.length === 0 ? '<blockquote>\n</blockquote>' : '<blockquote>\n<p>' + inlineRender(parts.join('\n'), link) + '</p>\n</blockquote>');
      continue;
    }
    // A list: bullet ('- ' or '* ') or ordered ('N. '), each following
    // line of the same kind another item, a line of two or more spaces
    // then a non-space continuing the item.
    let ordered = false, startNum = 1, firstRest = null;
    if ((line[0] === '-' || line[0] === '*') && line[1] === ' ') { firstRest = line.slice(2); }
    else {
      let d = 0;
      while (d < line.length && line.charCodeAt(d) >= 48 && line.charCodeAt(d) <= 57) d++;
      if (d >= 1 && d <= 9 && line[d] === '.' && line[d + 1] === ' ') { ordered = true; startNum = Number(line.slice(0, d)); firstRest = line.slice(d + 2); }
    }
    if (firstRest !== null) {
      const items = [[trimLine(firstRest)]];
      i++;
      while (i < lines.length) {
        const ln = lines[i];
        let rest = null, isOrd = false, num = 0;
        if ((ln[0] === '-' || ln[0] === '*') && ln[1] === ' ') { if (!ordered) rest = ln.slice(2); }
        else {
          let d = 0;
          while (d < ln.length && ln.charCodeAt(d) >= 48 && ln.charCodeAt(d) <= 57) d++;
          if (d >= 1 && d <= 9 && ln[d] === '.' && ln[d + 1] === ' ') { if (ordered) { isOrd = true; num = Number(ln.slice(0, d)); rest = ln.slice(d + 2); } }
        }
        if (rest !== null) { items.push([trimLine(rest)]); i++; continue; }
        let sp = 0;
        while (sp < ln.length && ln[sp] === ' ') sp++;
        if (sp >= 2 && sp < ln.length && !isWsCode(ln.charCodeAt(sp))) { items[items.length - 1].push(trimLine(ln)); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const open = ordered && startNum !== 1 ? '<ol start="' + startNum + '">' : '<' + tag + '>';
      let body = open + '\n';
      for (const parts of items) body += '<li>' + inlineRender(parts.join('\n'), link) + '</li>\n';
      blocks.push(body + '</' + tag + '>');
      continue;
    }
    // A paragraph: lines up to a blank line, a fence, a heading or a
    // thematic break, each trimmed, joined by '\n'.
    const parts = [trimLine(line)];
    i++;
    while (i < lines.length && !endsParagraph(lines[i])) { parts.push(trimLine(lines[i])); i++; }
    const html = inlineRender(parts.join('\n'), link);
    if (excerpt === null) excerpt = html;
    blocks.push('<p>' + html + '</p>');
  }
  return { html: blocks.map((b) => b + '\n').join(''), toc, excerpt: excerpt === null ? '' : excerpt };
}

// ---------------------------------------------------------------- Templates

class TemplateError extends Error {}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError('template "' + name + '": ' + JSON.stringify(text) + ' is not a path');
  return text.split('.');
}

// Tokenise one template source. A {% %} tag alone on its line (only
// spaces or tabs beside it) takes the whole line, newline included.
function tokenize(name, src) {
  const tokens = [];
  let text = '', i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) { text += src.slice(i); break; }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') { text += src.slice(i, open + 1); i = open + 1; continue; }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError('template "' + name + '": a ' + (raw ? '{{{' : '{{') + ' is not closed');
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError('template "' + name + '": a {% is not closed');
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    let standalone = true;
    for (let k = lineStart; k < open; k++) { const c = src.charCodeAt(k); if (c !== 32 && c !== 9) { standalone = false; break; } }
    if (standalone) for (let k = end; k < lineEnd; k++) { const c = src.charCodeAt(k); if (c !== 32 && c !== 9) { standalone = false; break; } }
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

// Node shapes: ['t', text] ['v', path, raw] ['f', name, path, body]
// ['i', path, not, then, else|null] ['c', templateName]
function parseTemplate(name, src) {
  const root = [];
  const stack = [{ kind: 'root', node: null, body: root }];
  let body = root;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') { body.push(['t', tok.text]); continue; }
    if (tok.t === 'var' || tok.t === 'raw') { body.push(['v', tok.path, tok.t === 'raw']); continue; }
    const tag = tok.tag;
    const top = stack[stack.length - 1];
    let m;
    if ((m = FOR_RE.exec(tag)) !== null) {
      const node = ['f', m[1], pathOf(name, m[2]), []];
      body.push(node);
      stack.push({ kind: 'for', node, body: node[3] });
      body = node[3];
    } else if ((m = IF_RE.exec(tag)) !== null) {
      const node = ['i', pathOf(name, m[2]), m[1] !== undefined, [], null];
      body.push(node);
      stack.push({ kind: 'if', node, body: node[3] });
      body = node[3];
    } else if (tag === 'else') {
      if (top.kind !== 'if' || top.node[4] !== null) throw new TemplateError('template "' + name + '": an else outside an if');
      top.node[4] = [];
      top.body = top.node[4];
      body = top.node[4];
    } else if (tag === 'endfor' || tag === 'endif') {
      const want = tag === 'endfor' ? 'for' : 'if';
      if (top.kind !== want) throw new TemplateError('template "' + name + '": an ' + tag + ' with no open ' + tag.slice(3));
      stack.pop();
      body = stack[stack.length - 1].body;
    } else if ((m = INCLUDE_RE.exec(tag)) !== null) {
      body.push(['c', m[1]]);
    } else {
      throw new TemplateError('template "' + name + '": {% ' + tag + ' %} is not a tag');
    }
  }
  if (stack.length > 1) throw new TemplateError('template "' + name + '": a ' + stack[stack.length - 1].kind + ' is not closed');
  return root;
}

// Includes render in the same scope, at most 8 deep; a deeper or
// missing one renders nothing. Since every render starts at depth 0,
// expanding includes into the caller's node list once, with the depth
// carried through the expansion, renders exactly the same text while
// skipping a map lookup and a call per include at render time.
function expandNodes(nodes, parsed, depth) {
  const out = [];
  for (const nd of nodes) {
    if (nd[0] === 'c') {
      if (depth < 8 && parsed.has(nd[1])) out.push(...expandNodes(parsed.get(nd[1]), parsed, depth + 1));
    } else if (nd[0] === 'f') {
      out.push(['f', nd[1], nd[2], expandNodes(nd[3], parsed, depth)]);
    } else if (nd[0] === 'i') {
      out.push(['i', nd[1], nd[2], expandNodes(nd[3], parsed, depth), nd[4] === null ? null : expandNodes(nd[4], parsed, depth)]);
    } else out.push(nd);
  }
  return out;
}

function lookup(frames, path) {
  const first = path[0];
  for (let f = frames.length - 1; f >= 0; f--) {
    const vars = frames[f];
    if (!hasOwn(vars, first)) continue;
    let v = vars[first];
    for (let k = 1; k < path.length; k++) {
      if (v === null || typeof v !== 'object' || !hasOwn(v, path[k])) return undefined;
      v = v[path[k]];
    }
    return v;
  }
  return undefined;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function renderNodes(nodes, frames, out) {
  for (const nd of nodes) {
    const kind = nd[0];
    if (kind === 't') { out.push(nd[1]); continue; }
    if (kind === 'v') {
      const v = textOf(lookup(frames, nd[1]));
      out.push(nd[2] ? v : escapeHtml(v));
      continue;
    }
    if (kind === 'i') {
      const branch = truthy(lookup(frames, nd[1])) !== nd[2] ? nd[3] : nd[4];
      if (branch !== null) renderNodes(branch, frames, out);
      continue;
    }
    // 'f': one frame reused across iterations, its loop record mutated;
    // rendering is synchronous, so nothing can observe the reuse.
    const xs = lookup(frames, nd[2]);
    if (!Array.isArray(xs)) continue;
    const frame = {}, loop = { index: 0, first: false, last: false, length: xs.length };
    frame[nd[1]] = undefined;
    frame.loop = loop;
    frames.push(frame);
    for (let k = 0; k < xs.length; k++) {
      frame[nd[1]] = xs[k];
      loop.index = k + 1;
      loop.first = k === 0;
      loop.last = k === xs.length - 1;
      renderNodes(nd[3], frames, out);
    }
    frames.pop();
  }
}

// ---------------------------------------------------------------- the build

function resolveRel(dirParts, rel) {
  const parts = dirParts.slice();
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

export function run(input) {
  const slugCache = new Map(), dateCache = new Map();
  const base = input.site.base_url.replace(/\/+$/, '');

  // Templates, parsed in code-unit order of name; one that does not
  // parse is reported and left out, as if it were not there.
  const parsed = new Map(), report = [];
  for (const name of Object.keys(input.templates).sort(cmp)) {
    try { parsed.set(name, parseTemplate(name, input.templates[name])); }
    catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const templates = new Map();
  for (const [name, nodes] of parsed) templates.set(name, expandNodes(nodes, parsed, 0));

  // Sources, sorted by path in code-unit order; line ends made '\n'.
  const files = [...input.files].sort((a, b) => cmp(a.path, b.path));
  const sources = [], statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
    else statics.push({ path: f.path, content: f.content });
  }

  // Front matter, in the order the checks are reported: a refused front
  // matter, a reserved directory, a post with no date, a layout that is
  // no template that parses, then a draft.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) { report.push('refused ' + s.path + ': ' + fm.error); continue; }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own = null;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== null) { report.push('refused ' + s.path + ': ' + own + '/ is the generator\'s own'); continue; }
    if (s.post && !hasOwn(s.data, 'date')) { report.push('refused ' + s.path + ': a post needs a date'); continue; }
    const layout = s.data.layout !== undefined ? s.data.layout : (s.post ? 'post' : 'page');
    if (!templates.has(layout)) { report.push('refused ' + s.path + ': layout "' + layout + '" is no template that parses'); continue; }
    s.layout = layout;
    if (s.data.draft === true) { report.push('draft ' + s.path); continue; }
    kept.push(s);
  }

  // Permalinks: slugs made unique in their directory, in source order.
  const bySource = new Map(), dirState = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let st = dirState.get(dir);
    if (st === undefined) {
      st = { taken: new Set(dir === '' ? RESERVED : []), next: new Map() };
      dirState.set(dir, st);
    }
    const slug = uniqueSlug(hasOwn(s.data, 'slug') ? s.data.slug : slugify(s.data.title, slugCache), st.taken, st.next);
    s.slug = slug;
    s.outDir = dir === '' ? slug : dir + '/' + slug;
    s.url = base + '/' + s.outDir + '/';
    bySource.set(s.path, s);
  }

  // Markdown, each body's links resolved to the pages and static files.
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const dirParts = dir === '' ? [] : dir.split('/');
    const link = (target) => {
      let i = 0;
      const first = target.charCodeAt(0);
      if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
        while (i < target.length) {
          const c = target.charCodeAt(i);
          if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) i++;
          else break;
        }
        if (target[i] === ':') return target;
      }
      if (target[0] === '/' || target[0] === '#') return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolveRel(dirParts, rel);
      if (path !== null && bySource.has(path)) return bySource.get(path).url + frag;
      if (path !== null && staticPaths.has(path)) return base + '/' + path + frag;
      broken.add('broken-link ' + s.path + ' -> ' + target);
      return target;
    };
    const md = renderMarkdown(s.body, link, slugCache);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.words = countWords(s.body);
  }

  // Collections: posts newest first, equal dates by slug; neighbours.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => cmp(y.data.date, x.data.date) || cmp(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // Tags: each post's tags, each slug once in its own order, named as
  // first met walking the posts in collection order, ordered by count
  // then slug. A page's tags link to the tag of the same slug, or to
  // nothing where no post has it.
  const bySlug = new Map();
  for (const p of posts) {
    p.tagRefs = [];
    const seen = new Set();
    for (const name of (p.data.tags || [])) {
      const slug = slugify(name, slugCache);
      if (seen.has(slug)) continue;
      seen.add(slug);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: base + '/tags/' + slug + '/', posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (s.post) continue;
    s.tagRefs = [];
    const seen = new Set();
    for (const name of (s.data.tags || [])) {
      const slug = slugify(name, slugCache);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const tag = bySlug.get(slug);
      s.tagRefs.push(tag !== undefined ? tag : { name, slug, url: '', posts: [] });
    }
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || cmp(x.slug, y.slug));

  // The records templates read: one card per source, one link record per
  // post, one page record per source, all shared where the reference
  // would rebuild the same values.
  const linkOf = (s) => ({ title: s.data.title, url: s.url, date: s.data.date === undefined ? '' : s.data.date, date_long: s.data.date === undefined ? '' : longDate(s.data.date, dateCache) });
  for (const s of kept) {
    const cardTags = s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url }));
    s.card = {
      title: s.data.title,
      url: s.url,
      date: s.data.date === undefined ? '' : s.data.date,
      date_long: s.data.date === undefined ? '' : longDate(s.data.date, dateCache),
      summary: s.data.summary === undefined ? '' : s.data.summary,
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(s.words / 200)),
      tags: cardTags,
    };
  }
  for (const p of posts) p.linkRec = linkOf(p);
  for (const s of kept) {
    s.pageRec = {
      ...s.card,
      slug: s.slug,
      content: s.html,
      toc: s.toc,
      newer: s.post ? (s.newer === null ? null : s.newer.linkRec) : null,
      older: s.post ? (s.older === null ? null : s.older.linkRec) : null,
      is_post: s.post,
    };
  }

  // Layouts: every page, the index pages, the tag pages, then statics.
  const siteRec = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => p.card);
  const output = {};
  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const out = [];
    renderNodes(nodes, [{ site: siteRec, tags: allTags, recent, ...vars }], out);
    return out.join('');
  };
  let pageCount = 0;
  for (const s of kept) {
    if (!s.post) pageCount++;
    output[s.outDir + '/index.html'] = render(s.layout, { page: s.pageRec });
  }
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? base + '/' : base + '/page/' + k + '/');
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => p.card),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => p.card) } });
    if (html !== null) output['tags/' + t.slug + '/index.html'] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (hasOwn(output, f.path)) report.push('shadowed ' + f.path + ': a built page has its path');
    else output[f.path] = f.content;
  }

  // The report: every line reported above and each broken link, sorted
  // in code-unit order, then the counts.
  const lines = [...report, ...broken].sort(cmp);
  lines.push('built ' + pageCount + ' pages, ' + posts.length + ' posts, ' + tags.length + ' tags and ' + statics.length + ' static files');
  output['build-report.txt'] = lines.join('\n') + '\n';
  return output;
}
