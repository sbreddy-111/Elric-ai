// Elric AI service worker: keeps the app shell available offline.
// The model file itself is stored separately by the app (OPFS / Cache API),
// never by this worker.
const VERSION = 'elric-shell-v37';
// Filled in at build time (vite.config.ts, precacheList). Empty in dev.
const SHELL_ASSETS = ["assets/index-BQDycLCf.css","assets/index-BTdZoLb8.js","assets/modulepreload-polyfill-B5Qt9EMX.js"];
const LAZY_ASSETS = ["assets/_commonjsHelpers-Cpj98o6Y.js","assets/abnfDiagram-S7VZAUFO-Djp8_DZF.js","assets/architectureDiagram-YGSQEFNW-DTF8tpNZ.js","assets/blockDiagram-APKKGZFW-CB0-orCU.js","assets/bpmnIcons-APHXDYXF-ByGoYv9M.js","assets/c4Diagram-KJ2TOQU5-UYc8WEo0.js","assets/chunk-2Q5K7J3B-aZV4AeHd.js","assets/chunk-5VM5RSS4-BDwzuIMU.js","assets/chunk-HFQBQIA3-D-9shKRE.js","assets/chunk-JWPE2WC7-BfKfyoCb.js","assets/chunk-KQLB2F66-BQhPa6_Y.js","assets/chunk-KS47KZWR-D37BVU6j.js","assets/chunk-OY52VR5R-Ks5lmA9M.js","assets/chunk-TU62E6Q5-DJi_bzTi.js","assets/chunk-XXDRQBXY-B0E3p6Wd.js","assets/classDiagram-v2-L25IHNXF-B9BhO_ZM.js","assets/cose-bilkent-JH36ORCC-CuXkNqaj.js","assets/cynefin-EF2NZ3EQ-B_5A462q.js","assets/cynefinDiagram-L36ESFBY-DAc1kC89.js","assets/cytoscape.esm-CjX6Hyah.js","assets/d3-scale-4DPf7zan.js","assets/dagre-SPEB5RXH-BWIVioSn.js","assets/diagram-3B7GL73J-D9zqqPQQ.js","assets/diagram-DNEMPZML-Cx-ADKI9.js","assets/diagram-L3MUGCDN-CkZy7WPH.js","assets/diagram-LA4NIPWU-DnVrIurW.js","assets/diagram-MHCOC4E2-DnZamskh.js","assets/diagram-XPFHEONP-DLvymzdI.js","assets/ebnfDiagram-UZSYDL2S-BFGioyRO.js","assets/elk-XV6XMXQE-BLvhg63f.js","assets/erDiagram-EYBAPDEH-Bgn0us7Y.js","assets/flowDiagram-MALGAFMO-DpIQ0YhK.js","assets/ganttDiagram-23REXITY-I5OE_rok.js","assets/gitGraphDiagram-STJD7YCW-CT23b3vX.js","assets/graph-D8UmR1vK.js","assets/infoDiagram-KBXO4MBG-DGXcgprA.js","assets/ishikawaDiagram-M35NCXHK-C5D4EJED.js","assets/journeyDiagram-OPLOXDXO-CUdGs5ZW.js","assets/kanban-definition-BZKZHSQY-BQ_8FYCn.js","assets/katex-DLSO0Xi6.js","assets/mermaid.core-Dqqurgjh.js","assets/mindmap-definition-I2QAS2VK-3zLQVxfe.js","assets/pdf-Duyp5f_f.js","assets/pdf.worker.min-B5Yc7dP4.mjs","assets/pdf.worker.min-kg7KTZJr.js","assets/pegDiagram-FD4XPPHP-CLMU22FA.js","assets/pieDiagram-J4AKIIQI-DZeD0Kbw.js","assets/quadrantDiagram-XTYBLID2-BAyfYuQg.js","assets/railroadDiagram-MRQ6NCDL-dgg1CUAd.js","assets/requirementDiagram-Y7LWUY3S-C0ItT-7i.js","assets/sankeyDiagram-WGJFYUXA-BeJ9991P.js","assets/sequenceDiagram-5NDRBG5M-Bvf8VApv.js","assets/sizeCapture-INFHLROL-BUzYYw9f.js","assets/stateDiagram-v2-FJ4FJNEA-joqh6x4K.js","assets/swimlanes-UMQ2AFYF-fbLyEuNd.js","assets/swimlanesDiagram-OMPLPG4O-DqTDhsZL.js","assets/timeline-definition-SEUHKTQE-GrRvGIxW.js","assets/usecaseDiagram-AFA6YXN4-Dk75hUfu.js","assets/vennDiagram-NNMJR3RB-CQ8hpw2R.js","assets/wardleyDiagram-S7YFUSEH-6677KfDC.js","assets/xychartDiagram-GGNKY7IX-BW-MF_xY.js"];
const RUNTIME = ["mediapipe/tasks-genai-0.10.30/genai_wasm_internal.js","mediapipe/tasks-genai-0.10.30/genai_wasm_internal.wasm"];
const BUILD = "dd2ab7be1d";
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
