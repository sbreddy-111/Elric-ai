// Elric AI service worker: keeps the app shell available offline.
// The model file itself is stored separately by the app (OPFS / Cache API),
// never by this worker.
const VERSION = 'elric-shell-v34';
// Filled in at build time (vite.config.ts, precacheList). Empty in dev.
const SHELL_ASSETS = ["assets/index-D6yinNU6.js","assets/index-PE6flO1k.css","assets/modulepreload-polyfill-B5Qt9EMX.js"];
const LAZY_ASSETS = ["assets/_commonjsHelpers-Cpj98o6Y.js","assets/abnfDiagram-S7VZAUFO-BKJq9_6A.js","assets/architectureDiagram-YGSQEFNW-k-iCTKY6.js","assets/blockDiagram-APKKGZFW-I_nSrn8p.js","assets/bpmnIcons-APHXDYXF-ByGoYv9M.js","assets/c4Diagram-KJ2TOQU5-DvZbfd0_.js","assets/chunk-2Q5K7J3B-TY6osz2l.js","assets/chunk-5VM5RSS4-DpoEBcZh.js","assets/chunk-HFQBQIA3-DNhSo_uH.js","assets/chunk-JWPE2WC7-CDQ-ScIG.js","assets/chunk-KQLB2F66-BodKVTF1.js","assets/chunk-KS47KZWR-D7EBTYh_.js","assets/chunk-OY52VR5R-CddRUnrS.js","assets/chunk-TU62E6Q5-CbXk7Q-n.js","assets/chunk-XXDRQBXY-BRoWvt5F.js","assets/classDiagram-v2-L25IHNXF-at3Gc4Rp.js","assets/cose-bilkent-JH36ORCC-5ONA94d9.js","assets/cynefin-EF2NZ3EQ-B8Z5YGVe.js","assets/cynefinDiagram-L36ESFBY-DMnFm9c9.js","assets/cytoscape.esm-CjX6Hyah.js","assets/d3-scale-4DPf7zan.js","assets/dagre-SPEB5RXH-OsC052te.js","assets/diagram-3B7GL73J-De4k_ahe.js","assets/diagram-DNEMPZML-BNQPK4dH.js","assets/diagram-L3MUGCDN-CENm5sXn.js","assets/diagram-LA4NIPWU-BzqimFzQ.js","assets/diagram-MHCOC4E2-BIB7uV-0.js","assets/diagram-XPFHEONP-uol9P5N9.js","assets/ebnfDiagram-UZSYDL2S-Wm3czUXQ.js","assets/elk-XV6XMXQE-CPkg0A59.js","assets/erDiagram-EYBAPDEH-DqI23Rog.js","assets/flowDiagram-MALGAFMO-C39epelK.js","assets/ganttDiagram-23REXITY-DmBiN2j2.js","assets/gitGraphDiagram-STJD7YCW-CeeZN4du.js","assets/graph-D8UmR1vK.js","assets/infoDiagram-KBXO4MBG-CfC-OpnK.js","assets/ishikawaDiagram-M35NCXHK-sZLIsisQ.js","assets/journeyDiagram-OPLOXDXO-C_Qfyncv.js","assets/kanban-definition-BZKZHSQY-B9zWn2jW.js","assets/katex-DLSO0Xi6.js","assets/mermaid.core-BLVmkeWL.js","assets/mindmap-definition-I2QAS2VK-vW6roK29.js","assets/pdf-Duyp5f_f.js","assets/pdf.worker.min-B5Yc7dP4.mjs","assets/pdf.worker.min-kg7KTZJr.js","assets/pegDiagram-FD4XPPHP-BMLGoAYp.js","assets/pieDiagram-J4AKIIQI-VVSxDZ45.js","assets/quadrantDiagram-XTYBLID2-BWRappQs.js","assets/railroadDiagram-MRQ6NCDL-DGP-2cBw.js","assets/requirementDiagram-Y7LWUY3S-CGEqWVI3.js","assets/sankeyDiagram-WGJFYUXA-DDGrrOzC.js","assets/sequenceDiagram-5NDRBG5M-Cd6BelKW.js","assets/sizeCapture-INFHLROL-rG55AROr.js","assets/stateDiagram-v2-FJ4FJNEA-D94VHUmX.js","assets/swimlanes-UMQ2AFYF-CbdBoCiM.js","assets/swimlanesDiagram-OMPLPG4O-BMPmGy09.js","assets/timeline-definition-SEUHKTQE-R5K7OxRm.js","assets/usecaseDiagram-AFA6YXN4-SAkevY1W.js","assets/vennDiagram-NNMJR3RB-CXzAdkPU.js","assets/wardleyDiagram-S7YFUSEH-By0JsqxS.js","assets/xychartDiagram-GGNKY7IX-DT_Ghp5v.js"];
const RUNTIME = ["mediapipe/tasks-genai-0.10.30/genai_wasm_internal.js","mediapipe/tasks-genai-0.10.30/genai_wasm_internal.wasm"];
const BUILD = "9fb4f307cd";
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
