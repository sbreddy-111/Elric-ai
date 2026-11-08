// Elric AI service worker: keeps the app shell available offline.
// The model file itself is stored separately by the app (OPFS / Cache API),
// never by this worker.
const VERSION = 'elric-shell-v34';
// Filled in at build time (vite.config.ts, precacheList). Empty in dev.
const SHELL_ASSETS = ["assets/index-CVkOxrj-.js","assets/index-PE6flO1k.css","assets/modulepreload-polyfill-B5Qt9EMX.js"];
const LAZY_ASSETS = ["assets/_commonjsHelpers-Cpj98o6Y.js","assets/abnfDiagram-S7VZAUFO-A4g8TGQp.js","assets/architectureDiagram-YGSQEFNW-DF0vQUmx.js","assets/blockDiagram-APKKGZFW-DvZ4VZKe.js","assets/bpmnIcons-APHXDYXF-ByGoYv9M.js","assets/c4Diagram-KJ2TOQU5-BQzd1bFX.js","assets/chunk-2Q5K7J3B-CA8h1TD6.js","assets/chunk-5VM5RSS4-kEOpkSuV.js","assets/chunk-HFQBQIA3-CDrCagHe.js","assets/chunk-JWPE2WC7-DodsL0bT.js","assets/chunk-KQLB2F66-irntMLEF.js","assets/chunk-KS47KZWR-B9nDXK7B.js","assets/chunk-OY52VR5R-Db1JAt2E.js","assets/chunk-TU62E6Q5-DU6w4sMv.js","assets/chunk-XXDRQBXY-Bs8dOG0d.js","assets/classDiagram-v2-L25IHNXF-DriJttVy.js","assets/cose-bilkent-JH36ORCC-7hdZ_r7s.js","assets/cynefin-EF2NZ3EQ-Be4cbBTC.js","assets/cynefinDiagram-L36ESFBY-gELwP3mV.js","assets/cytoscape.esm-CjX6Hyah.js","assets/d3-scale-4DPf7zan.js","assets/dagre-SPEB5RXH-BMy9Np35.js","assets/diagram-3B7GL73J-BUYSo7_Y.js","assets/diagram-DNEMPZML-DBJjyYde.js","assets/diagram-L3MUGCDN-C_8auQ9V.js","assets/diagram-LA4NIPWU-BW6hCjxV.js","assets/diagram-MHCOC4E2-ClnBUMVJ.js","assets/diagram-XPFHEONP-CaO7zvVz.js","assets/ebnfDiagram-UZSYDL2S-UYUPZB1q.js","assets/elk-XV6XMXQE-KUNgQUZ1.js","assets/erDiagram-EYBAPDEH-Bo9oZ8aI.js","assets/flowDiagram-MALGAFMO-Ckmi5YyR.js","assets/ganttDiagram-23REXITY-Dwo_zneX.js","assets/gitGraphDiagram-STJD7YCW-D7L2EZhH.js","assets/graph-D8UmR1vK.js","assets/infoDiagram-KBXO4MBG-BhHeHcW6.js","assets/ishikawaDiagram-M35NCXHK-BoLFegBY.js","assets/journeyDiagram-OPLOXDXO-DvH15Nqo.js","assets/kanban-definition-BZKZHSQY-ByFWQAwC.js","assets/katex-DLSO0Xi6.js","assets/mermaid.core-CtohWhG_.js","assets/mindmap-definition-I2QAS2VK-CCJSfjwP.js","assets/pdf-Duyp5f_f.js","assets/pdf.worker.min-B5Yc7dP4.mjs","assets/pdf.worker.min-kg7KTZJr.js","assets/pegDiagram-FD4XPPHP-BbmEeuPI.js","assets/pieDiagram-J4AKIIQI-BAD8C6Ub.js","assets/quadrantDiagram-XTYBLID2-CCUo94pl.js","assets/railroadDiagram-MRQ6NCDL-1R4RINd-.js","assets/requirementDiagram-Y7LWUY3S-CR_f77oR.js","assets/sankeyDiagram-WGJFYUXA-YKTNls1t.js","assets/sequenceDiagram-5NDRBG5M-C1XiLbk7.js","assets/sizeCapture-INFHLROL-BX4b5iB3.js","assets/stateDiagram-v2-FJ4FJNEA-COp14HxY.js","assets/swimlanes-UMQ2AFYF-D1NC2jm0.js","assets/swimlanesDiagram-OMPLPG4O-DDEcJ9ij.js","assets/timeline-definition-SEUHKTQE-B396Ep33.js","assets/usecaseDiagram-AFA6YXN4-CeJVHzSp.js","assets/vennDiagram-NNMJR3RB-faIP614X.js","assets/wardleyDiagram-S7YFUSEH-BsCU1Jnw.js","assets/xychartDiagram-GGNKY7IX-C5cMBrPP.js"];
const RUNTIME = ["mediapipe/tasks-genai-0.10.30/genai_wasm_internal.js","mediapipe/tasks-genai-0.10.30/genai_wasm_internal.wasm"];
const BUILD = "c512629088";
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
