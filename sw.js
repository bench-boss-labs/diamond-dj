/* Offline copy of the app. (Songs and announcements live in IndexedDB, not here.)
   - Each release is saved whole (VERSION). A new copy is downloaded and checked before it's used:
     a missing file, a redirect or the wrong kind of file (a ballpark wifi sign-in page answering
     instead of GitHub) skips the update and the current version keeps working.
   - The app always opens from the saved copy, so weak wifi can't hold it up. A new version
     downloads in the background; the app offers it (or, for a quiet release, switches over by
     itself when nothing is playing).
   - The full guide (guide/) is saved too, so it opens at the field without wifi.
   VERSION is set by tools/release.py. */
const VERSION = 'diamond-v14';
const SHELL = ['./', 'index.html', 'app.css', 'version.js', 'release-notes.json', 'manifest.webmanifest', 'guide/',
  'js/model.js', 'js/store.js', 'js/audio.js', 'js/drive.js', 'js/app.js',
  'icons/logo.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'fonts/barlow-latin-400-normal.woff2', 'fonts/barlow-latin-500-normal.woff2', 'fonts/barlow-latin-600-normal.woff2',
  'fonts/barlow-latin-700-normal.woff2', 'fonts/barlow-condensed-latin-600-normal.woff2', 'fonts/barlow-condensed-latin-700-normal.woff2'];
const HOME = new URL('./', self.location).href;
const GUIDE = new URL('guide/', self.location).href;
const TYPES = { html: 'text/html', js: 'javascript', css: 'text/css', json: 'json', webmanifest: 'json', png: 'image/png', woff2: 'font' };

async function fetchChecked(path) {
  const url = new URL(path, self.location).href;
  const res = await fetch(url, { cache: 'reload' });
  const ext = url.endsWith('/') ? 'html' : url.split('?')[0].split('.').pop();
  const type = res.headers.get('content-type') || '';
  if (!res.ok || res.redirected || res.type !== 'basic' || new URL(res.url).origin !== self.location.origin) throw new Error('bad response: ' + url);
  if (TYPES[ext] && !type.includes(TYPES[ext])) throw new Error('unexpected type for ' + url + ': ' + type);
  // the right page, not a wifi sign-in page: the app loads js/app.js, the guide says it's the guide
  if (ext === 'html' && !(await res.clone().text()).includes(url === GUIDE ? 'diamond-guide' : 'js/app.js')) throw new Error('not the right page: ' + url);
  return res;
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const files = await Promise.all(SHELL.map(async p => [new URL(p, self.location).href, await fetchChecked(p)]));
    const cache = await caches.open(VERSION);
    await Promise.all(files.map(([url, res]) => cache.put(url, res)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('diamond-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
    // Tell the open app. A release marked "quiet": true in release-notes.json says so, and the app
    // switches over by itself when nothing is playing instead of showing "A new version is ready".
    let quiet = false;
    try { const r = await caches.match(new URL('release-notes.json', self.location).href, { cacheName: VERSION }); quiet = !!(await r.json())[0].quiet; } catch (err) {}
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: quiet ? 'diamond-updated-quiet' : 'diamond-updated', version: VERSION });
  })());
});

const timeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(HOME)) return;
  e.respondWith((async () => {
    const key = req.mode !== 'navigate' ? url.href.split('#')[0] : url.href.startsWith(GUIDE) ? GUIDE : HOME;
    const saved = await caches.match(key, { ignoreSearch: true, cacheName: VERSION }) || await caches.match(key, { ignoreSearch: true });
    if (saved) return saved;
    try { return await timeout(fetch(req), 8000); }
    catch (err) { return Response.error(); }
  })());
});
