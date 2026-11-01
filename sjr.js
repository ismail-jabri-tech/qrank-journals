// Parse the SCImago CSV export (";"-separated, quoted fields) and find journal titles / ISSNs in text.

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ';') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Words lowercased, "&" read as "and", so "Science & Engineering" == "Science and Engineering".
function tokens(s) {
  return [...s.matchAll(/[\p{L}\p{N}]+|&/gu)].map(m => ({
    w: m[0] === '&' ? 'and' : m[0].toLowerCase(), s: m.index, e: m.index + m[0].length,
  }));
}

const COLORS = { Q1: '#43a047', Q2: '#c9a400', Q3: '#ef6c00', Q4: '#d32f2f', NR: '#9e9e9e' };
const STOP = new Set(['of', 'the', 'and', 'in', 'on', 'for', 'a', 'an', 'to', 'with']);

function buildIndex(csv) {
  const [head, ...rows] = parseCSV(csv.replace(/^﻿/, ''));
  const [ID, TITLE, TYPE, ISSN, SJR, Q] =
    ['Sourceid', 'Title', 'Type', 'Issn', 'SJR', 'SJR Best Quartile'].map(n => head.indexOf(n));
  const titles = new Map(), prefixes = new Set(), issns = new Map();
  const abbrs = new Map(); // initials of the significant words ("jasa") -> [{j, sig}], best-ranked first
  for (const r of rows) {
    if (!r[TITLE]) continue;
    const j = { id: r[ID], title: r[TITLE], type: r[TYPE], sjr: r[SJR], q: /^Q[1-4]$/.test(r[Q]) ? r[Q] : 'NR' };
    const words = tokens(j.title).map(t => t.w);
    if (!words.length) continue;
    for (let i = 1; i < words.length; i++) prefixes.add(words.slice(0, i).join(' '));
    const key = words.join(' ');
    if (!titles.has(key)) titles.set(key, j); // CSV is rank-ordered: keep the best-ranked duplicate
    for (const s of (r[ISSN] || '').split(/,\s*/)) if (s && !issns.has(s.toUpperCase())) issns.set(s.toUpperCase(), j);
    const sig = words.filter(w => !STOP.has(w));
    if (sig.length > 1) {
      const k = sig.map(w => w[0]).join('');
      if (!abbrs.has(k)) abbrs.set(k, []);
      abbrs.get(k).push({ j, sig });
    }
  }
  return { titles, prefixes, issns, abbrs };
}

// IEEE-style abbreviation starting at token i: "Neural Netw.", "J. Amer. Statist. Assoc.", "IEEE Trans. Neural Netw.".
// Capitalised words joined by spaces, at least one ending in "."; a dotted word must start the title word
// ("Netw" -> "networks"), an undotted one must equal it. Returns {end, j, k} or null.
// ponytail: dotted words need 3+ letters (except "J.") so author initials ("S. Holm") never match.
function abbreviation(abbrs, text, tk, i) {
  const span = [];
  for (let k = i; k < tk.length && span.length < 8; k++) {
    const t = tk[k], dot = text[t.e] === '.';
    if (!/^\p{Lu}/u.test(text[t.s]) || dot && t.w.length < 3 && t.w !== 'j') break;
    if (span.length && !/^\.?\s+$/.test(text.slice(tk[k - 1].e, t.s))) break;
    span.push({ w: t.w, dot, e: t.e + dot });
  }
  for (let n = span.length; n >= 2; n--) {
    const s = span.slice(0, n);
    if (!s.some(t => t.dot)) continue;
    const c = abbrs.get(s.map(t => t.w[0]).join(''))
      ?.find(c => c.sig.length === n && s.every((t, x) => t.dot ? c.sig[x].startsWith(t.w) : c.sig[x] === t.w));
    if (c) return { end: s[n - 1].e, j: c.j, k: i + n - 1 };
  }
  return null;
}

// Returns [{start, end, j}]: the matched span and which journal it is. Longest title wins.
// Single-word titles ("Nature", "October", "Explore") are common words, so they only match when they are
// the whole text node, exactly capitalised (a heading, a link, an italic journal name in a reference).
// ponytail: misses "Nature 521, 436" written as one plain text node; accepted to avoid badges on dates/buttons.
// A journal title inside a longer capitalised name is not that journal:
// "Computer Vision and |Pattern Recognition|", "|Proceedings of the IEEE| Conference on ...".
const LONGER_BEFORE = /\p{Lu}\p{L}* (and|of|on|for|in|&) $/u, LONGER_AFTER = /^ ((and|of|on|for|&) )?\p{Lu}/u;

function match({ titles, prefixes, issns, abbrs }, text) {
  const out = [], tk = tokens(text), whole = text.trim().replace(/[.,;:]+$/, '');
  for (let i = 0; i < tk.length; i++) {
    let key = '', best = null;
    for (let k = i; k < tk.length; k++) {
      key += (k > i ? ' ' : '') + tk[k].w;
      const j = titles.get(key);
      // Multi-word: first letter must match the title's case, so prose ("medical image analysis",
      // "remote sensing") is skipped but "Medical Image Analysis" / "Medical image analysis" match.
      if (j && (k > i ? text[tk[i].s] === j.title.match(/[\p{L}\p{N}]/u)[0] : whole === j.title))
        best = { end: tk[k].e, j, k };
      if (!prefixes.has(key)) break;
    }
    if (best && best.k > i && (LONGER_BEFORE.test(text.slice(0, tk[i].s)) || LONGER_AFTER.test(text.slice(best.end))))
      best = null;
    best ??= abbreviation(abbrs, text, tk, i);
    if (best) { out.push({ start: tk[i].s, end: best.end, j: best.j, one: best.k === i }); i = best.k; }
  }
  // An ISSN needs an "ISSN" label just before it, or a text node of its own: "2008-2010" is a journal's ISSN too.
  // An ISSN needs an "ISSN" label just before it, or a text node of its own: "2008-2010" is a journal's ISSN too.
  for (const m of text.matchAll(/\b(\d{4})-(\d{3}[\dXx])\b/g)) {
    if (whole !== m[0] && !/ISSN/i.test(text.slice(Math.max(0, m.index - 24), m.index))) continue;
    if (whole !== m[0] && !/ISSN/i.test(text.slice(Math.max(0, m.index - 24), m.index))) continue;
    const j = issns.get((m[1] + m[2]).toUpperCase());
    if (j) out.push({ start: m.index, end: m.index + m[0].length, j });
  }
  return out;
}

// Backup source for journals missing from SCImago: a journalseeker.com journal page carries the quartile in its
// JSON-LD block ("quartile": "Q4"). An unknown journal still gets a page, with an empty quartile.
function seekerQuartile(html) {
  const q = html.match(/"quartile":\s*"(Q[1-4])"/)?.[1];
  return q ? { q, title: html.match(/"name":\s*"([^"]+)"/)?.[1] ?? '' } : null;
}

if (typeof module !== 'undefined') module.exports = { buildIndex, match, seekerQuartile };
