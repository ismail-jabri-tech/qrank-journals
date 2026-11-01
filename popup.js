const $ = id => document.getElementById(id);

// An uploaded CSV lives in the extension's Cache Storage; otherwise the one shipped in the folder is used.
async function status() {
  const saved = await caches.match('scimagojr.csv');
  const ok = saved || await fetch('scimagojr.csv').then(r => r.ok, () => false); // headers only, body not read
  $('ok').hidden = !ok;
  $('missing').hidden = !!ok;
  $('src').textContent = saved ? `(uploaded ${saved.headers.get('x-saved')})` : '(from extension folder)';
}

$('file').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  const head = await file.slice(0, 1000).text();
  if (!['Sourceid', 'Title', 'SJR Best Quartile'].every(c => head.includes(c))) {
    $('msg').textContent = 'Not a SCImago CSV export.';
    return;
  }
  const cache = await caches.open('sjr');
  await cache.put('scimagojr.csv', new Response(file, { headers: { 'x-saved': new Date().toLocaleDateString() } }));
  await chrome.runtime.sendMessage('reload');
  $('msg').textContent = '';
  status();
};

$('pdf').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab.url?.startsWith(chrome.runtime.getURL(''))) return close(); // already in QRank's viewer
  if (!/^(https?|file):/.test(tab.url ?? '')) return $('msg').textContent = 'Open a PDF article in this tab first.';
  // Same tab: the PDF reopens in QRank's viewer with the reference journals marked; Back returns to the original.
  chrome.tabs.update(tab.id, { url: chrome.runtime.getURL(`refs.html?url=${encodeURIComponent(tab.url)}`) });
  close();
};

chrome.storage.local.get({ on: true, seekOn: true }, s => { $('on').checked = s.on; $('seek').checked = s.seekOn; });
$('on').onchange = e => chrome.storage.local.set({ on: e.target.checked });
$('seek').onchange = e => chrome.storage.local.set({ seekOn: e.target.checked });

status();
