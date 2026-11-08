// Elric AI service worker: keeps the app shell available offline.
// The model file itself is stored separately by the app (OPFS / Cache API),
// never by this worker.
const VERSION = 'elric-shell-v34';
// Filled in at build time (vite.config.ts, precacheList). Empty in dev.
const SHELL_ASSETS = ["assets/index-Di-9oUCx.css","assets/index-DoQL0RRY.js","assets/modulepreload-polyfill-B5Qt9EMX.js"];
const LAZY_ASSETS = ["assets/_commonjsHelpers-Cpj98o6Y.js","assets/abnfDiagram-S7VZAUFO-BWR5bq46.js","assets/architectureDiagram-YGSQEFNW-TIZQ0qVJ.js","assets/blockDiagram-APKKGZFW-OsRzAHJ9.js","assets/bpmnIcons-APHXDYXF-ByGoYv9M.js","assets/c4Diagram-KJ2TOQU5-VQkOk67f.js","assets/chunk-2Q5K7J3B-9CiEFDGp.js","assets/chunk-5VM5RSS4-43X_tGvD.js","assets/chunk-HFQBQIA3-BWawSK5g.js","assets/chunk-JWPE2WC7-BdXmlrY0.js","assets/chunk-KQLB2F66-PNg9pqlf.js","assets/chunk-KS47KZWR-CPMeHqWT.js","assets/chunk-OY52VR5R-CDpYceEK.js","assets/chunk-TU62E6Q5-DPBTUaky.js","assets/chunk-XXDRQBXY-CU2_E9lD.js","assets/classDiagram-v2-L25IHNXF-BVchRpqp.js","assets/cose-bilkent-JH36ORCC-kgQSPMbE.js","assets/cynefin-EF2NZ3EQ-DVy3CYOK.js","assets/cynefinDiagram-L36ESFBY-CqrPu77B.js","assets/cytoscape.esm-CjX6Hyah.js","assets/d3-scale-4DPf7zan.js","assets/dagre-SPEB5RXH-2eBi0rLe.js","assets/diagram-3B7GL73J-BgQshQmZ.js","assets/diagram-DNEMPZML-Uv8ZHjmR.js","assets/diagram-L3MUGCDN-B02EIHD_.js","assets/diagram-LA4NIPWU-BkJqMyaC.js","assets/diagram-MHCOC4E2-Du0I7IAN.js","assets/diagram-XPFHEONP-BBUlyPUx.js","assets/ebnfDiagram-UZSYDL2S-DX45UYfQ.js","assets/elk-XV6XMXQE-BclYq9ps.js","assets/erDiagram-EYBAPDEH-COQHmDJV.js","assets/flowDiagram-MALGAFMO-72Iwe9kd.js","assets/ganttDiagram-23REXITY-CXgMF10m.js","assets/gitGraphDiagram-STJD7YCW-DeXjbh_D.js","assets/graph-D8UmR1vK.js","assets/infoDiagram-KBXO4MBG-BYvmQLDq.js","assets/ishikawaDiagram-M35NCXHK-C_SNSjPf.js","assets/journeyDiagram-OPLOXDXO-C5sUEXHK.js","assets/kanban-definition-BZKZHSQY-p2p4NYf3.js","assets/katex-DLSO0Xi6.js","assets/mermaid.core-D64c1mYj.js","assets/mindmap-definition-I2QAS2VK-D5OVX58R.js","assets/pdf-Duyp5f_f.js","assets/pdf.worker.min-B5Yc7dP4.mjs","assets/pdf.worker.min-kg7KTZJr.js","assets/pegDiagram-FD4XPPHP-nxZOiOxv.js","assets/pieDiagram-J4AKIIQI-DrPOkdUv.js","assets/quadrantDiagram-XTYBLID2-Bfv_y9UQ.js","assets/railroadDiagram-MRQ6NCDL-Bjy6D4Dx.js","assets/requirementDiagram-Y7LWUY3S-akuh-V6n.js","assets/sankeyDiagram-WGJFYUXA-D1iRMsT6.js","assets/sequenceDiagram-5NDRBG5M-FhthCvJ8.js","assets/sizeCapture-INFHLROL-Dn8OUiV1.js","assets/stateDiagram-v2-FJ4FJNEA-rcTJusoJ.js","assets/swimlanes-UMQ2AFYF-BlCjOArA.js","assets/swimlanesDiagram-OMPLPG4O-CYSoPhww.js","assets/timeline-definition-SEUHKTQE-D5mUlgsz.js","assets/usecaseDiagram-AFA6YXN4-DfxJHsS7.js","assets/vennDiagram-NNMJR3RB-z9_U8deO.js","assets/wardleyDiagram-S7YFUSEH-5u2OddyJ.js","assets/xychartDiagram-GGNKY7IX-DGKf6j9x.js"];
const RUNTIME = ["mediapipe/tasks-genai-0.10.30/genai_wasm_internal.js","mediapipe/tasks-genai-0.10.30/genai_wasm_internal.wasm"];
const BUILD = "9e2465c45b";
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
