// Elric AI service worker: keeps the app shell available offline.
// The model file itself is stored separately by the app (OPFS / Cache API),
// never by this worker.
const VERSION = 'elric-shell-v34';
// Filled in at build time (vite.config.ts, precacheList). Empty in dev.
const SHELL_ASSETS = ["assets/index-ClX7OTXU.js","assets/index-DB9Xa98c.css","assets/modulepreload-polyfill-B5Qt9EMX.js"];
const LAZY_ASSETS = ["assets/_commonjsHelpers-Cpj98o6Y.js","assets/abnfDiagram-S7VZAUFO-Dqlw4z_b.js","assets/architectureDiagram-YGSQEFNW-BQgNXhlj.js","assets/blockDiagram-APKKGZFW-B5iUWLlp.js","assets/bpmnIcons-APHXDYXF-ByGoYv9M.js","assets/c4Diagram-KJ2TOQU5-BjCwASO7.js","assets/chunk-2Q5K7J3B-CcBT1WCJ.js","assets/chunk-5VM5RSS4-ChiEAAdK.js","assets/chunk-HFQBQIA3-DzpN6bUN.js","assets/chunk-JWPE2WC7-vDtJae2R.js","assets/chunk-KQLB2F66-AFu6uo2y.js","assets/chunk-KS47KZWR-Cte_Nixf.js","assets/chunk-OY52VR5R-NelQwekJ.js","assets/chunk-TU62E6Q5-CiBDrKJU.js","assets/chunk-XXDRQBXY-S62Mgnxj.js","assets/classDiagram-v2-L25IHNXF-Crv13QsP.js","assets/cose-bilkent-JH36ORCC-DFVrZEW5.js","assets/cynefin-EF2NZ3EQ-WnEeHCe6.js","assets/cynefinDiagram-L36ESFBY-CKcune52.js","assets/cytoscape.esm-CjX6Hyah.js","assets/d3-scale-4DPf7zan.js","assets/dagre-SPEB5RXH-BqDftfgL.js","assets/diagram-3B7GL73J-C78V8rRC.js","assets/diagram-DNEMPZML-B8SHyT9r.js","assets/diagram-L3MUGCDN-DB8EnzAE.js","assets/diagram-LA4NIPWU-Cu0MOIBh.js","assets/diagram-MHCOC4E2-B4HkXXkD.js","assets/diagram-XPFHEONP-6vLgul3q.js","assets/ebnfDiagram-UZSYDL2S-dWuk1NJS.js","assets/elk-XV6XMXQE-B1S1lqm5.js","assets/erDiagram-EYBAPDEH-BMKct24z.js","assets/flowDiagram-MALGAFMO-4Fq5g4cs.js","assets/ganttDiagram-23REXITY-CujldYk5.js","assets/gitGraphDiagram-STJD7YCW-CaoAEDZt.js","assets/graph-D8UmR1vK.js","assets/infoDiagram-KBXO4MBG-wUB9C9FN.js","assets/ishikawaDiagram-M35NCXHK-C6M_M0vL.js","assets/journeyDiagram-OPLOXDXO-DDHBlfqR.js","assets/kanban-definition-BZKZHSQY-msoTfTg7.js","assets/katex-DLSO0Xi6.js","assets/mermaid.core-BJlwBrXb.js","assets/mindmap-definition-I2QAS2VK-BZMNKfV2.js","assets/pdf-Duyp5f_f.js","assets/pdf.worker.min-B5Yc7dP4.mjs","assets/pdf.worker.min-kg7KTZJr.js","assets/pegDiagram-FD4XPPHP-_nWqVK2z.js","assets/pieDiagram-J4AKIIQI-lv_WSD6r.js","assets/quadrantDiagram-XTYBLID2-CZOlhwoD.js","assets/railroadDiagram-MRQ6NCDL-DQqg2e6J.js","assets/requirementDiagram-Y7LWUY3S-c3BmULjr.js","assets/sankeyDiagram-WGJFYUXA-Bz8PjnnH.js","assets/sequenceDiagram-5NDRBG5M-BUSkCq4R.js","assets/sizeCapture-INFHLROL-CFYp2Kn0.js","assets/stateDiagram-v2-FJ4FJNEA-DbQtNFJd.js","assets/swimlanes-UMQ2AFYF-BnGvrCUy.js","assets/swimlanesDiagram-OMPLPG4O-WWo_WkWY.js","assets/timeline-definition-SEUHKTQE-CzL0DYaR.js","assets/usecaseDiagram-AFA6YXN4-K6vU0uwD.js","assets/vennDiagram-NNMJR3RB-DXl6Q10z.js","assets/wardleyDiagram-S7YFUSEH-CLyuoCVo.js","assets/xychartDiagram-GGNKY7IX-D8EJTm_L.js"];
const RUNTIME = ["mediapipe/tasks-genai-0.10.30/genai_wasm_internal.js","mediapipe/tasks-genai-0.10.30/genai_wasm_internal.wasm"];
const BUILD = "cf8be52280";
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
