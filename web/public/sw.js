// Elric AI service worker: keeps the app shell available offline.
// The model file itself is stored separately by the app (OPFS / Cache API),
// never by this worker.
const VERSION = 'elric-shell-v33';
// Filled in at build time (vite.config.ts, precacheList). Empty in dev.
const SHELL_ASSETS = [];
const LAZY_ASSETS = [];
const RUNTIME = [];
const BUILD = '';
const CACHE = BUILD ? `${VERSION}-${BUILD}` : VERSION;
// The on-device runtime has its own cache (named by its folder, which carries its version),
// so a new app version does not download it again.
const RUNTIME_CACHE = 'elric-runtime-' + (RUNTIME[0] || '').split('/').slice(0, 2).join('/');
const BASE = new URL('./', self.location).pathname;
const SHELL = ['', 'index.html', 'manifest.webmanifest', 'favicon.ico',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/mark.png', ...SHELL_ASSETS].map((p) => BASE + p);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // The page and the bundle it needs: install fails (and the old worker stays) if any is missing.
    await c.addAll(SHELL);
    // PDF reader and diagrams: best effort, one by one.
    await Promise.all(LAZY_ASSETS.map((p) => c.add(BASE + p).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Keep the newest previous shell cache too: a tab still open on the old version can
    // load its old chunks from it until it is refreshed. Older ones are removed.
    const shells = (await caches.keys()).filter((k) => k.startsWith('elric-shell-') && k !== CACHE);
    const drop = shells.slice(0, -1);
    const runtimes = (await caches.keys()).filter((k) => k.startsWith('elric-runtime-') && k !== RUNTIME_CACHE);
    await Promise.all([...drop, ...(RUNTIME.length ? runtimes : [])].map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The app asks for the runtime to be stored once the model is on the device.
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cache-runtime' || !RUNTIME.length) return;
  e.waitUntil(caches.open(RUNTIME_CACHE).then(async (c) => {
    for (const p of RUNTIME) { if (!(await c.match(BASE + p))) await c.add(BASE + p).catch(() => {}); }
  }));
});

const cacheFirst = (req, name) => caches.match(req).then((hit) => hit || fetch(req).then((res) => {
  if (res.ok) { const copy = res.clone(); caches.open(name).then((c) => c.put(req, copy)); }
  return res;
}));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch model downloads
  // Never cache or serve the owner-only admin page or its files.
  if (url.pathname.startsWith(BASE + 'admin') || url.pathname.startsWith(BASE + 'assets/admin-')) return;
  if (req.mode === 'navigate') {
    // Network first for pages, fall back to the cached shell when offline.
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then((res) => {
        // Only the app shell is cached; other pages (privacy.html, terms.html) are not.
        if (res.ok && (url.pathname === BASE || url.pathname === BASE + 'index.html')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(BASE + 'index.html', copy));
        }
        return res;
      }).catch(() => caches.match(BASE + 'index.html').then((r) => r || caches.match(BASE)))
    );
    return;
  }
  // On-device runtime (large, versioned folder): cache first, kept across app versions.
  if (url.pathname.startsWith(BASE + 'mediapipe/')) { e.respondWith(cacheFirst(req, RUNTIME_CACHE)); return; }
  // Cache first for static files (hashed assets, icons).
  if (url.pathname.startsWith(BASE + 'assets/') || url.pathname.startsWith(BASE + 'icons/')) {
    e.respondWith(cacheFirst(req, CACHE));
  }
});
