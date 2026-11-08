// Elric AI service worker: keeps the app shell available offline.
// The model file itself is stored separately by the app (OPFS / Cache API),
// never by this worker.
const VERSION = 'elric-shell-v35';
// Filled in at build time (vite.config.ts, precacheList). Empty in dev.
const SHELL_ASSETS = ["assets/index-BQDycLCf.css","assets/index-D1tD0CEI.js","assets/modulepreload-polyfill-B5Qt9EMX.js"];
const LAZY_ASSETS = ["assets/_commonjsHelpers-Cpj98o6Y.js","assets/abnfDiagram-S7VZAUFO-CAT7qApi.js","assets/architectureDiagram-YGSQEFNW-KxQQWskm.js","assets/blockDiagram-APKKGZFW-4k7TkCNi.js","assets/bpmnIcons-APHXDYXF-ByGoYv9M.js","assets/c4Diagram-KJ2TOQU5-DdqSyZ1w.js","assets/chunk-2Q5K7J3B-CONr1iqR.js","assets/chunk-5VM5RSS4-PFfGPCUJ.js","assets/chunk-HFQBQIA3-vE6Z8SAH.js","assets/chunk-JWPE2WC7-Ci4nEWH2.js","assets/chunk-KQLB2F66-DxYIvbC-.js","assets/chunk-KS47KZWR-BvJ_uLLS.js","assets/chunk-OY52VR5R-BmMdCyo_.js","assets/chunk-TU62E6Q5-DmGQrnhJ.js","assets/chunk-XXDRQBXY-B_NcEi9J.js","assets/classDiagram-v2-L25IHNXF-CBnRkZFl.js","assets/cose-bilkent-JH36ORCC-ChlxUdWX.js","assets/cynefin-EF2NZ3EQ-Cz6VOni5.js","assets/cynefinDiagram-L36ESFBY-C901Ici2.js","assets/cytoscape.esm-CjX6Hyah.js","assets/d3-scale-4DPf7zan.js","assets/dagre-SPEB5RXH-D0Cm_lbT.js","assets/diagram-3B7GL73J-BOWTav9I.js","assets/diagram-DNEMPZML-8w4jlSrD.js","assets/diagram-L3MUGCDN-B7vftdCJ.js","assets/diagram-LA4NIPWU-CV5aNGwp.js","assets/diagram-MHCOC4E2-CPDOA_MH.js","assets/diagram-XPFHEONP-W2IE_3V4.js","assets/ebnfDiagram-UZSYDL2S-W_vhegw0.js","assets/elk-XV6XMXQE-_HZv78Fr.js","assets/erDiagram-EYBAPDEH-C_cTBCep.js","assets/flowDiagram-MALGAFMO-BianaYPE.js","assets/ganttDiagram-23REXITY-CHJRXK0X.js","assets/gitGraphDiagram-STJD7YCW-DsKBkJN4.js","assets/graph-D8UmR1vK.js","assets/infoDiagram-KBXO4MBG-BJs8elJF.js","assets/ishikawaDiagram-M35NCXHK-BAQcU6Ow.js","assets/journeyDiagram-OPLOXDXO-CwEWtnyt.js","assets/kanban-definition-BZKZHSQY-B-vPrK5w.js","assets/katex-DLSO0Xi6.js","assets/mermaid.core-BNYNokiT.js","assets/mindmap-definition-I2QAS2VK-DXps2s-E.js","assets/pdf-Duyp5f_f.js","assets/pdf.worker.min-B5Yc7dP4.mjs","assets/pdf.worker.min-kg7KTZJr.js","assets/pegDiagram-FD4XPPHP--3kCaXWf.js","assets/pieDiagram-J4AKIIQI-uZStRAB0.js","assets/quadrantDiagram-XTYBLID2-Brt4NCIe.js","assets/railroadDiagram-MRQ6NCDL-Dtc3nSf1.js","assets/requirementDiagram-Y7LWUY3S-CacGoxik.js","assets/sankeyDiagram-WGJFYUXA-CjW9Eh1R.js","assets/sequenceDiagram-5NDRBG5M-C6CngD8Z.js","assets/sizeCapture-INFHLROL-BgyGmL2L.js","assets/stateDiagram-v2-FJ4FJNEA-CfbmbdRO.js","assets/swimlanes-UMQ2AFYF-tU6yuV10.js","assets/swimlanesDiagram-OMPLPG4O-zd4lUtaR.js","assets/timeline-definition-SEUHKTQE-B0HL3iLo.js","assets/usecaseDiagram-AFA6YXN4-Bi7csqYz.js","assets/vennDiagram-NNMJR3RB-Dqvyl1TL.js","assets/wardleyDiagram-S7YFUSEH-Cdx-95gQ.js","assets/xychartDiagram-GGNKY7IX-BYw4XLux.js"];
const RUNTIME = ["mediapipe/tasks-genai-0.10.30/genai_wasm_internal.js","mediapipe/tasks-genai-0.10.30/genai_wasm_internal.wasm"];
const BUILD = "52ce76a40c";
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
