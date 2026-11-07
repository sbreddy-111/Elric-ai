// Elric AI service worker: keeps the app shell available offline.
// The model file itself is stored separately by the app (OPFS / Cache API),
// never by this worker.
const VERSION = 'elric-shell-v33';
// Filled in at build time (vite.config.ts, precacheList). Empty in dev.
const SHELL_ASSETS = ["assets/index-CEkufJt5.js","assets/index-IV30jkVC.css","assets/modulepreload-polyfill-B5Qt9EMX.js"];
const LAZY_ASSETS = ["assets/_commonjsHelpers-Cpj98o6Y.js","assets/abnfDiagram-S7VZAUFO-Bl9EAXH0.js","assets/architectureDiagram-YGSQEFNW-BZeKc76m.js","assets/blockDiagram-APKKGZFW-DRKPtryA.js","assets/bpmnIcons-APHXDYXF-ByGoYv9M.js","assets/c4Diagram-KJ2TOQU5-BIckIjBu.js","assets/chunk-2Q5K7J3B-C478tCeB.js","assets/chunk-5VM5RSS4-CMiXyEIF.js","assets/chunk-HFQBQIA3-DvPZ0l_n.js","assets/chunk-JWPE2WC7-B_8sildU.js","assets/chunk-KQLB2F66-E3TuLrYl.js","assets/chunk-KS47KZWR-Dq9qfeRK.js","assets/chunk-OY52VR5R-BG_BRVKz.js","assets/chunk-TU62E6Q5-DuNyLlWF.js","assets/chunk-XXDRQBXY-BL93Q11D.js","assets/classDiagram-v2-L25IHNXF-Bda88Lx8.js","assets/cose-bilkent-JH36ORCC-ntZK8Cyb.js","assets/cynefin-EF2NZ3EQ-D0pIqr5V.js","assets/cynefinDiagram-L36ESFBY-CFGwUYi7.js","assets/cytoscape.esm-CjX6Hyah.js","assets/d3-scale-4DPf7zan.js","assets/dagre-SPEB5RXH-CsKYWinW.js","assets/diagram-3B7GL73J-CEt7KHKc.js","assets/diagram-DNEMPZML-h1Nh-Rgn.js","assets/diagram-L3MUGCDN-R6eNKAD_.js","assets/diagram-LA4NIPWU-BzSFWC5J.js","assets/diagram-MHCOC4E2-BVT3j5Qf.js","assets/diagram-XPFHEONP-BxnxFlqo.js","assets/ebnfDiagram-UZSYDL2S-e2MlgQKe.js","assets/elk-XV6XMXQE-CFD9w_pq.js","assets/erDiagram-EYBAPDEH-BlGPWzsq.js","assets/flowDiagram-MALGAFMO-CO4IB54c.js","assets/ganttDiagram-23REXITY--WbDcHtl.js","assets/gitGraphDiagram-STJD7YCW-RFjE6RaB.js","assets/graph-D8UmR1vK.js","assets/infoDiagram-KBXO4MBG-Bvbfvn2v.js","assets/ishikawaDiagram-M35NCXHK-BkW5XCAy.js","assets/journeyDiagram-OPLOXDXO-CGM4ofH5.js","assets/kanban-definition-BZKZHSQY-C4SnCKui.js","assets/katex-DLSO0Xi6.js","assets/mermaid.core-p2RtGR8z.js","assets/mindmap-definition-I2QAS2VK-Ekt8_I3x.js","assets/pdf-Duyp5f_f.js","assets/pdf.worker.min-B5Yc7dP4.mjs","assets/pdf.worker.min-kg7KTZJr.js","assets/pegDiagram-FD4XPPHP-DW9UdHo1.js","assets/pieDiagram-J4AKIIQI-BPgTdqJA.js","assets/quadrantDiagram-XTYBLID2-CQJLwDwR.js","assets/railroadDiagram-MRQ6NCDL-1zaYE2WV.js","assets/requirementDiagram-Y7LWUY3S-QSEU6xAv.js","assets/sankeyDiagram-WGJFYUXA-CJQv1Xmf.js","assets/sequenceDiagram-5NDRBG5M-zmaj5oGD.js","assets/sizeCapture-INFHLROL-DkDm8O4F.js","assets/stateDiagram-v2-FJ4FJNEA-DohBM52Q.js","assets/swimlanes-UMQ2AFYF-CM0bbnIC.js","assets/swimlanesDiagram-OMPLPG4O-Cf550IIx.js","assets/timeline-definition-SEUHKTQE-Bt7ipa5T.js","assets/usecaseDiagram-AFA6YXN4-DB6EBWZl.js","assets/vennDiagram-NNMJR3RB-CigEbgj6.js","assets/wardleyDiagram-S7YFUSEH-DR86xWmA.js","assets/xychartDiagram-GGNKY7IX-CiocGhUk.js"];
const RUNTIME = ["mediapipe/tasks-genai-0.10.30/genai_wasm_internal.js","mediapipe/tasks-genai-0.10.30/genai_wasm_internal.wasm"];
const BUILD = "ed7dbf8f23";
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
