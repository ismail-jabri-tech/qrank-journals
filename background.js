importScripts('sjr.js');

// Prefer a CSV uploaded from the popup (Cache Storage), else the one in the extension folder.
let index;
const load = () => index ??= caches.match('scimagojr.csv')
  .then(saved => saved || fetch('scimagojr.csv'))
  .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
  .then(buildIndex)
  .catch(e => {
    index = undefined; // retry on next page
    chrome.action.setBadgeText({ text: '!' });
    console.error('QRank: no SCImago CSV; click the extension icon to add one', e);
  });

// Colourful toolbar icon when badges are on, grey when off. setIcon resets on browser restart, so repaint then too.
const paint = () => chrome.storage.local.get({ on: true }, ({ on }) => {
  const s = on ? 'on' : 'off';
  chrome.action.setIcon({ path: { 16: `icons/${s}-16.png`, 32: `icons/${s}-32.png` } });
});
chrome.runtime.onStartup.addListener(paint);
chrome.runtime.onInstalled.addListener(paint);
chrome.storage.onChanged.addListener(c => c.on && paint());

// Backup for profile journals missing from SCImago: look the name up on journalseeker.com. Each name is asked once
// (answers and misses kept in storage), one request at a time. The popup's switch turns it off.
let line = Promise.resolve();
// journalseeker wants the exact title: "The Review of Socionetwork Strategies" is listed without "The".
async function seek(name) {
  for (const n of new Set([name, name.replace(/^the\s+/i, '')])) {
    const found = await seekOne(n);
    if (found) return found;
  }
  return null;
}
async function seekOne(name) {
  const key = 'seek:' + name.toLowerCase();
  const { [key]: known, seekOn } = await chrome.storage.local.get([key, 'seekOn']);
  if (seekOn === false) return null;
  if (known !== undefined) return known;
  const url = `https://journalseeker.com/journal.php?q=${encodeURIComponent(name)}`;
  const ask = line.then(() => fetch(url)).then(r => r.ok ? r.text() : Promise.reject(r.status))
    .then(html => { const r = seekerQuartile(html); return r && { ...r, seeker: url }; });
  line = ask.catch(() => {});
  const found = await ask.catch(() => undefined); // network trouble: not remembered, asked again next time
  if (found !== undefined) await chrome.storage.local.set({ [key]: found });
  return found ?? null;
}

chrome.runtime.onMessage.addListener((texts, _, reply) => {
  if (texts?.seek) { seek(texts.seek).then(reply, () => reply(null)); return true; }
  if (texts === 'reload') { index = undefined; chrome.action.setBadgeText({ text: '' }); reply(); return; }
  load().then(idx => reply(idx && texts.map(t => match(idx, t))));
  return true;
});
