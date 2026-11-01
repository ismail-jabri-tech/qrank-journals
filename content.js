let done = new WeakSet(), asked = new WeakSet(), on = false, gen = 0; // gen: bumped by on/off to drop stale scans
const TITLE_TAGS = 'i,em,cite,h1,h2,h3,h4,h5,h6,a[href*="journal/"]';
// The journal page itself, not "journal/IoT-2624-831X/publication/.../file.pdf" (RG's Download button).
const JOURNAL_PAGE = /^\/journal\/[^/]+\/?$/;
const ISSN_URL = /(?<!\d)(\d{4})-?(\d{3}[\dXx])(?![\dXx])/;
// Publication venues on profiles may be one word ("Displays", "Sensors"); these RG labels are journal titles too.
const UI_WORDS = /^(Source|Research|Publications|Network|Stats)$/;
const SCHOLAR_VENUE = '.gsc_a_t .gs_gray:nth-of-type(2)';
// Page furniture: a one-word heading there ("Resources" in ResearchGate's footer) is a menu, not a journal.
const FURNITURE = 'header,footer,nav,aside,[role=banner],[role=contentinfo],[role=navigation],[role=complementary]';
// Also skipped: Scholar research interests ("Precision agriculture" is also a journal) and paper titles on
// Scholar / ResearchGate ("...with Convolutional Neural Networks" is not published in Neural Networks).
const SKIP ='script,style,noscript,textarea,input,select,code,pre,[contenteditable],.qrank,#gsc_prf_int,' +
  '.gsc_a_at,a[href*="publication/"]';

function badge(j) {
  const a = document.createElement('a');
  a.className = 'qrank';
  // j.seeker: found on journalseeker.com, not in the SCImago list: outlined "Q4*" so it never passes for a current rank.
  a.textContent = j.q + (j.seeker ? '*' : '');
  a.href = j.seeker ?? `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(j.id)}&tip=sid&clean=0`;
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = j.seeker ? `${j.title} · ${j.q} on journalseeker.com (older data; not in your SCImago list)`
    : `${j.title} · ${j.type} · SJR ${j.sjr || '–'}`;
  a.style.cssText = `display:inline-block;margin:0 6px;padding:2px 9px;border-radius:1em;font:bold max(13px,.6em)/1.4 sans-serif;
    color:${j.seeker ? COLORS[j.q] : '#fff'};background:${j.seeker ? '#fff' : COLORS[j.q]};box-shadow:inset 0 0 0 2px ${COLORS[j.q]};
    text-decoration:none;vertical-align:middle;white-space:nowrap`;
  a.addEventListener('click', e => e.stopPropagation());
  return a;
}

// ponytail: matches within one text node only; a title split across tags (<b>Journal</b> of X) is missed.
async function scan() {
  if (!on) return;
  const g = gen, nodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: n => done.has(n) || n.data.trim().length < 3 || n.parentElement?.closest(SKIP)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n; (n = walker.nextNode());) { nodes.push(n); done.add(n); }
  // Journal links with the ISSN in the URL (ResearchGate: journal/IoT-2624-831X, often written without the
  // leading "/") get a badge even when the short name ("IoT") isn't the SCImago title ("Internet of Things").
  const links = [...document.querySelectorAll('a[href*="journal/"]')]
    .filter(a => !done.has(a) && JOURNAL_PAGE.test(a.pathname) && !a.closest(SKIP));
  links.forEach(a => done.add(a));
  if (!nodes.length && !links.length) return summary(); // papers removed (a filter): recount what is left
  const before = nodes.map(n => n.data), items = profileItems(), pubs = items.map(i => i.el);
  const scholarVenue = n => n.parentElement.matches(SCHOLAR_VENUE);
  const venue = n => scholarVenue(n) || pubs.some(p => p.contains(n)) && !TYPES.test(n.data.trim()) && !UI_WORDS.test(n.data.trim());
  // Scholar venues end in volume/pages ("Sensors 23 (4), 2045"); match the name alone.
  const texts = nodes.map(n => scholarVenue(n) ? n.data.replace(/\s+\d[\s\S]*$/, '') : n.data).concat(links.map(a => a.pathname.match(ISSN_URL)?.slice(1).join('-') ?? ''));
  let results;
  try { results = await chrome.runtime.sendMessage(texts); } catch { return; } // extension reloaded
  // Switched off (or off and on again, which starts a new scan) while waiting, or no CSV loaded.
  if (!on || g !== gen || !results) return;
  results.forEach((ms, i) => {
    const n = nodes[i];
    if (!n || n.data !== before[i]) return;
    // One-word titles ("Source", "Matter", "Innovation") double as UI labels, so they need journal styling
    // or a profile venue line.
    // ponytail: misses a one-word journal in plain unstyled text; widen TITLE_TAGS per site if needed.
    ms.filter(m => !m.one || n.parentElement.closest(TITLE_TAGS) && !n.parentElement.closest(FURNITURE) || venue(n)).sort((a, b) => b.end - a.end).forEach(m => {
      done.add(n.splitText(m.end));
      n.after(badge(m.j));
    });
  });
  links.forEach((a, i) => {
    const m = results[nodes.length + i]?.[0];
    if (hasBadge(a)) return;
    if (m) badgeLink(a, m.j);
    else if (a.origin === location.origin && pubs.some(p => p.contains(a))) fromPage(a); // "MAKE": no name, no ISSN
  });
  // Scholar rows whose venue SCImago doesn't know: try journalseeker.com with the venue name.
  for (const { el, venue: v } of items)
    if (v && v !== el && !asked.has(v) && !v.querySelector('.qrank') && v.firstChild?.nodeType === Node.TEXT_NODE) {
      asked.add(v);
      const t = v.firstChild, name = t.data.replace(/\s+\d[\s\S]*$/, '');
      backup(v, name, j => { if (t.data.startsWith(name)) done.add(t.splitText(name.length)); t.after(badge(j)); }); // right after the name
    }
  // ResearchGate articles whose journal is plain text, not a link ("The Review of Socionetwork Strategies").
  for (const { el, venue: v } of items)
    if (v === el && !asked.has(el) && !el.querySelector('.qrank') && rgArticle(el)
        && ![...el.querySelectorAll('a')].some(a => JOURNAL_PAGE.test(a.pathname))) {
      const t = rgVenue(el);
      if (t) { asked.add(el); backup(el, t.data, j => t.after(badge(j))); }
    }
  summary(items);
}

const hasBadge = a => a.querySelector('.qrank');
// Inside the link, right after its text, so the badge sits on the name's line.
function badgeLink(a, j) {
  const texts = document.createTreeWalker(a, NodeFilter.SHOW_TEXT, { acceptNode: n => n.data.trim() ? 1 : 3 });
  let last;
  while (texts.nextNode()) last = texts.currentNode;
  last ? last.after(badge(j)) : a.append(badge(j));
}

// A journal link QRank can't place by name or URL ("MAKE"): open the journal page in the background, read its
// ISSN and its full name from the page title, and badge the link with whichever matches. Each page is fetched once.
const pages = new Map();
async function fromPage(a) {
  if (!pages.has(a.href)) pages.set(a.href, fetch(a.href).then(r => r.text()).then(html => [
    html.match(/ISSN\D{0,30}(\d{4}-\d{3}[\dXx])\b/i)?.[1] ?? '', // labelled only: pages are full of other numbers
    new DOMParser().parseFromString(html, 'text/html').title.split(/\s+[|–-]\s+/)[0].trim(),
  ], () => []));
  const texts = await pages.get(a.href);
  if (!on) return;
  const m = texts.some(Boolean) && (await chrome.runtime.sendMessage(texts).catch(() => null))?.flat()[0];
  if (hasBadge(a)) return;
  if (m) { badgeLink(a, m.j); return summary(); }
  // Not in SCImago either: journalseeker.com, by the full name from the page title or the link ("Review-of-...-2523-3173").
  backup(a, texts[1] || a.pathname.split('/')[2].replace(ISSN_URL, '').replace(/%20|-+/g, ' '), j => badgeLink(a, j));
}

// ponytail: RG has no venue class, so the journal line is found by elimination: the first text in the card that is
// not the title, a type label, a date, an author or profile link, or a button. Only for "Article" cards.
const RG_UI = /^(New|Full-text available|Request full-text|Download|Recommend|Follow|Following|Share|Source|Cite|Read|Add supplementary resources|·|\[\.\.\.\])$/;
const rgArticle = el => [...el.querySelectorAll('*')].some(e => !e.children.length && e.textContent.trim() === 'Article');
function rgVenue(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    const t = n.data.trim();
    if (t.length < 3 || TYPES.test(t) || UI_WORDS.test(t) || RG_UI.test(t) || /^(\p{Lu}\p{Ll}+ )?\d{4}$/u.test(t)) continue;
    if (n.parentElement.closest('a[href*="publication/"],a[href*="profile/"],a[href*="journal/"],button,[role=button],.qrank')) continue;
    return n;
  }
}

// A profile journal SCImago doesn't know: the background asks journalseeker.com (older data, badge "Q4*").
const NOT_JOURNAL = /conference|proceedings|symposium|workshop|congress|arxiv|rxiv|preprint|patent|thesis|dissertation|\bbook|chapter|university|ssrn|research square/i;
async function backup(el, name, put) {
  name = name.replace(/[\s,.;:]+$/, '').trim();
  if (name.length < 3 || NOT_JOURNAL.test(name)) return;
  const j = await chrome.runtime.sendMessage({ seek: name }).catch(() => null);
  if (j && on && !el.querySelector('.qrank')) { put(j); summary(); }
}

// Profile pages (Google Scholar, ResearchGate): a bar above the publication list with the share per quartile.
const TYPES = /^(Article|Conference Paper|Chapter|Book|Preprint|Thesis|Dataset|Data|Presentation|Poster|Technical Report|Working Paper|Patent|Research Proposal|Experiment Findings|Literature Review|Code|Method)$/;
function profileItems() {
  const rows = document.querySelectorAll('#gsc_a_b .gsc_a_tr'); // Scholar: the venue is the 2nd grey line
  if (rows.length) return [...rows].map(r => ({ el: r, venue: r.querySelector('.gs_gray:nth-of-type(2)') }));
  if (!/(^|\.)researchgate\.net$/.test(location.hostname) || !location.pathname.startsWith('/profile/')) return [];
  // ponytail: RG class names are obfuscated, so a publication = the largest block holding exactly one type label
  // and a link to its paper. The type filter menu ("Data", "Poster") has labels but no paper links, so it drops out.
  const labels = [...document.body.querySelectorAll('span,div,a,li,p')]
    .filter(e => !e.children.length && TYPES.test(e.textContent.trim()));
  const held = new Map(); // element -> number of type labels inside it
  for (const l of labels) for (let e = l.parentElement; e; e = e.parentElement) held.set(e, (held.get(e) ?? 0) + 1);
  return labels.map(l => {
    let e = l;
    while (e.parentElement !== document.body && held.get(e.parentElement) === 1) e = e.parentElement;
    return { el: e, venue: e };
  }).filter(i => i.el.querySelector('a[href*="publication/"]'));
}

const ORDER = ['Q1', 'Q2', 'Q3', 'Q4', 'NR', 'none'];
function summary(items = profileItems()) {
  const old = document.getElementById('qrank-sum');
  if (!items.length) return old?.remove();
  // One entry per paper, keyed by its id: ResearchGate links carry changing tracking parameters ("?_sg=...") and a
  // paper can be rendered twice. The last badge is the venue's (a title can contain a journal name too).
  const seen = new Map();
  for (const { el, venue } of items) {
    const href = el.querySelector('a.gsc_a_at, a[href*="publication/"]')?.href;
    const key = href?.match(/publication\/(\d+)/)?.[1] ?? href ?? el;
    const q = [...venue?.querySelectorAll('.qrank') ?? []].at(-1)?.textContent ?? 'none';
    if ((seen.get(key) ?? 'none') === 'none') seen.set(key, q);
  }
  const count = Object.fromEntries(ORDER.map(q => [q, 0]));
  for (const q of seen.values()) count[q.replace('*', '')]++; // "Q4*" (journalseeker.com) counts as Q4
  const starred = [...seen.values()].some(q => q.endsWith('*'));
  const key = JSON.stringify(count);
  if (old?.dataset.key === key) return;
  const box = document.createElement('div');
  box.id = 'qrank-sum';
  box.className = 'qrank';
  box.dataset.key = key;
  box.style.cssText = 'margin:12px 0;padding:12px 14px;border:1px solid #e3e3e3;border-radius:10px;background:#fafafa;' +
    'font:13px/1.35 sans-serif;color:#333;text-align:left';
  box.innerHTML = '<b>Journal quartiles</b><div style="display:flex;gap:2px;margin:8px 0 6px;border-radius:6px;overflow:hidden">' +
    `<div style="flex:none;margin-right:4px;padding:5px 10px;background:#14213d;color:#fff"><b>Total</b><br>` +
    `${seen.size} publication${seen.size === 1 ? '' : 's'}</div>` +
    ORDER.filter(q => count[q]).map(q => `<div style="flex:${count[q]};min-width:64px;padding:5px 8px;` +
      `background:${q === 'none' ? '#e6e6e6' : COLORS[q]};color:${q === 'none' ? '#555' : '#fff'}">` +
      `<b>${q === 'NR' ? 'Not ranked' : q === 'none' ? 'Not in SCImago / conference' : q}</b><br>` +
      `${Math.round(100 * count[q] / seen.size)}% · ${count[q]}</div>`).join('') +
    '</div><span style="color:#777">Counts the publications loaded so far; scroll down or click "Show more" to ' +
    'include the rest. Grey: conference papers, books, preprints and journals missing from SCImago.' +
    (starred ? ' Ranks marked * come from journalseeker.com (older data).' : '') + '</span>';
  if (old) return old.replaceWith(box);
  // Right before the first publication (Scholar: before its table), never into the page layout around the list.
  const first = items[0].el, table = first.closest('table');
  (table ?? first).before(box);
}

let timer;
new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 500); })
  .observe(document.body, { childList: true, subtree: true });

// On/off switch from the popup: off removes every badge, on rescans the page.
function toggle(value) {
  on = value;
  gen++;
  if (on) return scan();
  document.querySelectorAll('.qrank').forEach(b => b.remove());
  done = new WeakSet();
  asked = new WeakSet();
}
chrome.storage.local.get({ on: true }, s => toggle(s.on));
chrome.storage.onChanged.addListener(c => c.on && toggle(c.on.newValue));
