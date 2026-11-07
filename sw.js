// Elric AI service worker: keeps the app shell available offline.
// The model file itself is stored separately by the app (OPFS / Cache API),
// never by this worker.
const VERSION = 'elric-shell-v34';
// Filled in at build time (vite.config.ts, precacheList). Empty in dev.
const SHELL_ASSETS = ["assets/index-CFsWGumF.css","assets/index-Cg_MVCqA.js","assets/modulepreload-polyfill-B5Qt9EMX.js"];
const LAZY_ASSETS = ["assets/_commonjsHelpers-Cpj98o6Y.js","assets/abnfDiagram-S7VZAUFO-BPlJEvPM.js","assets/architectureDiagram-YGSQEFNW-Ba_yGlnY.js","assets/blockDiagram-APKKGZFW-f3hJaIMW.js","assets/bpmnIcons-APHXDYXF-ByGoYv9M.js","assets/c4Diagram-KJ2TOQU5-DCqnOohw.js","assets/chunk-2Q5K7J3B-D1tqFXUi.js","assets/chunk-5VM5RSS4-D6qaid_r.js","assets/chunk-HFQBQIA3-BTcZWlUj.js","assets/chunk-JWPE2WC7-AemSal25.js","assets/chunk-KQLB2F66-5BeXNBGV.js","assets/chunk-KS47KZWR-CWuM-7Vr.js","assets/chunk-OY52VR5R-D9INJcAV.js","assets/chunk-TU62E6Q5-B2gkx2FB.js","assets/chunk-XXDRQBXY-1-DOAReb.js","assets/classDiagram-v2-L25IHNXF-DTZKF_65.js","assets/cose-bilkent-JH36ORCC-G7-J9F-h.js","assets/cynefin-EF2NZ3EQ-zHOaikz6.js","assets/cynefinDiagram-L36ESFBY-CtSWPPWG.js","assets/cytoscape.esm-CjX6Hyah.js","assets/d3-scale-4DPf7zan.js","assets/dagre-SPEB5RXH-DoadocPb.js","assets/diagram-3B7GL73J-p6q5saMB.js","assets/diagram-DNEMPZML-BqS5GWgY.js","assets/diagram-L3MUGCDN-Cb99NPse.js","assets/diagram-LA4NIPWU-BHsCYr3W.js","assets/diagram-MHCOC4E2-H_hqyQ95.js","assets/diagram-XPFHEONP-BFi_ENNN.js","assets/ebnfDiagram-UZSYDL2S-fzyzhriw.js","assets/elk-XV6XMXQE-BUQ3xWb-.js","assets/erDiagram-EYBAPDEH-DHCiVGVQ.js","assets/flowDiagram-MALGAFMO-QhfB6XA0.js","assets/ganttDiagram-23REXITY-D5DHX9VO.js","assets/gitGraphDiagram-STJD7YCW-BYe1u5gk.js","assets/graph-D8UmR1vK.js","assets/infoDiagram-KBXO4MBG-nWLtdtfY.js","assets/ishikawaDiagram-M35NCXHK-BCMsvo4h.js","assets/journeyDiagram-OPLOXDXO-CePlzlQl.js","assets/kanban-definition-BZKZHSQY-DM36PONd.js","assets/katex-DLSO0Xi6.js","assets/mermaid.core-7DMPcGgX.js","assets/mindmap-definition-I2QAS2VK-fwbEnCHE.js","assets/pdf-Duyp5f_f.js","assets/pdf.worker.min-B5Yc7dP4.mjs","assets/pdf.worker.min-kg7KTZJr.js","assets/pegDiagram-FD4XPPHP-D8SNyaPx.js","assets/pieDiagram-J4AKIIQI-CCqSFMB3.js","assets/quadrantDiagram-XTYBLID2-DfEuljNo.js","assets/railroadDiagram-MRQ6NCDL-DxSrpehM.js","assets/requirementDiagram-Y7LWUY3S-CcsRyb2C.js","assets/sankeyDiagram-WGJFYUXA-VfsBPXeR.js","assets/sequenceDiagram-5NDRBG5M-DgjXAbdD.js","assets/sizeCapture-INFHLROL-SMEDVUYf.js","assets/stateDiagram-v2-FJ4FJNEA-GI4wGJHW.js","assets/swimlanes-UMQ2AFYF-Bm-Y-l4d.js","assets/swimlanesDiagram-OMPLPG4O-Byt8MJ4n.js","assets/timeline-definition-SEUHKTQE-DNsMZosb.js","assets/usecaseDiagram-AFA6YXN4-Cgr-QWWr.js","assets/vennDiagram-NNMJR3RB-DMUdrqKn.js","assets/wardleyDiagram-S7YFUSEH--OTk4isR.js","assets/xychartDiagram-GGNKY7IX-DotGeC-V.js"];
const RUNTIME = ["mediapipe/tasks-genai-0.10.30/genai_wasm_internal.js","mediapipe/tasks-genai-0.10.30/genai_wasm_internal.wasm"];
const BUILD = "a03a1c81c6";
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
