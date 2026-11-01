// Shows the PDF with PDF.js and marks the journals of its References section in place.
// No References section = not an article, so the PDF is shown untouched.
import * as pdfjs from './lib/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.mjs';

const $ = id => document.getElementById(id);
const HEAD = /^\s*(\d+\.?\s*|[IVX]+\.?\s*)?(references|bibliography|works cited|literature cited|références|literatur)\s*:?\s*$/i;
const END = /^\s*(\d+\.?\s*)?(appendix|supplementary|acknowledg|author (information|biograph|contributions)|about the authors?\b)/i;

// Pages are drawn when they come near the screen: drawing a 300-page thesis up front takes gigabytes.
const drawSoon = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  drawSoon.unobserve(e.target);
  e.target.draw();
}), { rootMargin: '1500px 0px' });

// Lays out every page and returns its text lines in reading order, each item placed in page pixels.
// pdf.js returns items column by column, so a y jump or EOL ends a line.
async function render(doc) {
  const lines = [], dpr = devicePixelRatio || 1;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: Math.min(1.6, (innerWidth - 32) / page.getViewport({ scale: 1 }).width) });
    const box = Object.assign(document.createElement('div'), { className: 'page' });
    box.style.cssText = `width:${vp.width}px;height:${vp.height}px`;
    $('pages').append(box);
    box.draw = () => {
      const canvas = document.createElement('canvas');
      canvas.width = vp.width * dpr;
      canvas.height = vp.height * dpr;
      canvas.style.width = '100%';
      box.prepend(canvas);
      page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] }).promise.catch(() => {});
    };
    drawSoon.observe(box);

    const { items, styles } = await page.getTextContent();
    let line = null, y = null;
    const flush = () => { if (line?.text.trim()) lines.push(line); line = null; };
    for (const it of items) {
      if (y !== null && Math.abs(it.transform[5] - y) > 2) flush();
      const [x, by] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      line ??= { text: '', box, items: [] };
      line.items.push({ start: line.text.length, end: line.text.length + it.str.length, x, y: by, str: it.str,
        font: styles[it.fontName]?.fontFamily || 'serif', w: it.width * vp.scale, h: (it.height || 10) * vp.scale });
      line.text += it.str;
      y = it.transform[5];
      if (it.hasEOL) { flush(); y = null; }
    }
    flush();
  }
  return lines;
}

// References as text plus, per wrapped line, where that line starts in the text (to map matches back to pixels).
// ponytail: an entry starts at "[1]", "1." or "Surname, A."; other styles merge into fewer, longer entries.
function split(ls) {
  const t = l => l.text.trim();
  const start = ls.filter(l => /^\[\d+\]/.test(t(l))).length > 2 ? /^\[\d+\]/
    : ls.filter(l => /^\d{1,3}\.\s/.test(t(l))).length > 2 ? /^\d{1,3}\.\s/
    : /^[\p{Lu}][\p{L}'’-]+,\s+\p{Lu}/u;
  const refs = [];
  for (const l of ls) {
    if (!refs.length || start.test(t(l))) { refs.push({ text: l.text, segs: [{ at: 0, l }] }); continue; }
    const r = refs.at(-1);
    if (r.text.endsWith('-') && /^\p{Ll}/u.test(l.text)) r.text = r.text.slice(0, -1); // "Intelli-" + "gence"
    else if (!r.text.endsWith('-')) r.text += ' ';                                     // "Real-" + "Time" keeps it
    r.segs.push({ at: r.text.length, l });
    r.text += l.text;
  }
  return refs;
}

// Character offset in a reference -> pixel point on its page. Within a text item the offset is placed by
// measured glyph widths (counting characters drifts: "il" is narrower than "Wm").
const ctx = document.createElement('canvas').getContext('2d');
const measure = (it, n) => { ctx.font = `100px ${it.font}`; return ctx.measureText(it.str.slice(0, n)).width; };
function point(r, c, isEnd) {
  const seg = r.segs.findLast(s => s.at <= c - (isEnd ? 1 : 0)) ?? r.segs[0];
  const lc = c - seg.at, items = seg.l.items;
  const it = items.find(i => isEnd ? lc <= i.end : lc < i.end) ?? items.at(-1);
  const n = Math.min(it.str.length, Math.max(0, lc - it.start)), all = measure(it, it.str.length);
  return { seg, box: seg.l.box, x: it.x + (all ? measure(it, n) / all : 0) * it.w, y: it.y, h: it.h };
}

function add(box, cls, css, props = {}) {
  const el = Object.assign(document.createElement(props.href ? 'a' : 'div'), { className: cls }, props);
  el.style.cssText = css;
  box.append(el);
}

// Tinted highlight over the journal name (split if it wraps) and a badge in the page margin beside that line,
// left margin for the left column, right margin for the right one, so no text is covered.
function mark(r, m) {
  const a = point(r, m.start, false), b = point(r, m.end, true), c = COLORS[m.j.q]; // COLORS from sjr.js
  const lineEnd = p => Math.max(...p.seg.l.items.map(i => i.x + i.w));
  const lineStart = p => Math.min(...p.seg.l.items.map(i => i.x));
  const spans = a.seg === b.seg ? [[a, a.x, b.x]] : [[a, a.x, lineEnd(a)], [b, lineStart(b), b.x]];
  for (const [p, x1, x2] of spans)
    add(p.box, 'hl', `left:${x1 - 2}px;top:${p.y - p.h}px;width:${x2 - x1 + 4}px;height:${p.h * 1.2}px;` +
      `background:${c}30;border-bottom:2px solid ${c}`);
  const w = b.box.clientWidth, side = b.x < w / 2 ? `right:${w - lineStart(b) + 5}px` : `left:${lineEnd(b) + 5}px`;
  add(b.box, 'qb', `${side};top:${b.y - b.h * 1.05}px;font-size:${Math.max(9, b.h * 0.8)}px;background:${c}`, {
    textContent: m.j.q, title: `${m.j.title} · SJR ${m.j.sjr || '–'}`, target: '_blank', rel: 'noopener',
    href: `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(m.j.id)}&tip=sid&clean=0`,
  });
}

async function run() {
  const url = new URLSearchParams(location.search).get('url');
  if (!url) return $('msg').textContent = 'No PDF to show.';
  $('orig').href = url;
  try { document.title = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop()) || 'PDF'; } catch {} // stray "%" in the name
  let data;
  try { data = new Uint8Array(await (await fetch(url)).arrayBuffer()); }
  catch { return $('msg').textContent = 'Could not download this PDF. For local files, turn on "Allow access to file URLs" for QRank.'; }
  // The "%PDF-" header may come after a few junk bytes (allowed within the first 1 KB).
  if (!String.fromCharCode(...data.slice(0, 1024)).includes('%PDF-')) return $('msg').textContent = 'This page is not a PDF.';

  let ls;
  try { ls = await render(await pdfjs.getDocument({ data }).promise); }
  catch { return $('msg').textContent = 'This PDF could not be read (damaged or password-protected).'; }
  const at = ls.findLastIndex(l => HEAD.test(l.text));
  if (at < 0) return $('msg').textContent = 'No References section, so this is not an article. QRank is off for this PDF.';
  let body = ls.slice(at + 1);
  const end = body.findIndex(l => END.test(l.text));
  if (end >= 0) body = body.slice(0, end);
  const refs = split(body);

  const results = await chrome.runtime.sendMessage(refs.map(r => r.text));
  if (!results) return $('msg').textContent = 'No SCImago CSV loaded. Add one from the QRank popup.';
  const count = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, NR: 0 };
  results.forEach((ms, i) => {
    // One-word titles ("Source", "Matter") are skipped: plain PDF text can't tell them from words.
    const m = ms.find(m => !m.one);
    if (m) { count[m.j.q]++; mark(refs[i], m); }
  });
  $('msg').textContent = `${refs.length} references:`;
  $('sum').innerHTML = Object.entries(count)
    .map(([q, n]) => `<span style="color:${COLORS[q]}">${q === 'NR' ? 'Not ranked' : q} ${n}</span>`).join('') +
    `<span style="color:#bbb">Not in SCImago / conference ${refs.length - Object.values(count).reduce((a, b) => a + b)}</span>`;
  const head = ls[at];
  $('jump').hidden = false;
  $('jump').onclick = () => scrollTo({ top: head.box.offsetTop + head.items[0].y - 120, behavior: 'smooth' });
}

run();
