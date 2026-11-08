// Elric AI service worker: keeps the app shell available offline.
// The model file itself is stored separately by the app (OPFS / Cache API),
// never by this worker.
const VERSION = 'elric-shell-v35';
// Filled in at build time (vite.config.ts, precacheList). Empty in dev.
const SHELL_ASSETS = ["assets/index-CwBK8WMB.js","assets/index-DJ9TFcta.css","assets/modulepreload-polyfill-B5Qt9EMX.js"];
const LAZY_ASSETS = ["assets/_commonjsHelpers-Cpj98o6Y.js","assets/abnfDiagram-S7VZAUFO-DigGm66_.js","assets/architectureDiagram-YGSQEFNW-D8SG8ljW.js","assets/blockDiagram-APKKGZFW-SgBEFOhZ.js","assets/bpmnIcons-APHXDYXF-ByGoYv9M.js","assets/c4Diagram-KJ2TOQU5-DMjmHrUt.js","assets/chunk-2Q5K7J3B-i-y-hnJD.js","assets/chunk-5VM5RSS4-16LY6WES.js","assets/chunk-HFQBQIA3-DqtQLrmK.js","assets/chunk-JWPE2WC7-C1OVqw6T.js","assets/chunk-KQLB2F66-D1D0xVIB.js","assets/chunk-KS47KZWR-uTLvurfJ.js","assets/chunk-OY52VR5R-BXQISRgi.js","assets/chunk-TU62E6Q5-D4MuYjov.js","assets/chunk-XXDRQBXY-DRCHfjQ5.js","assets/classDiagram-v2-L25IHNXF-CZtLXuIS.js","assets/cose-bilkent-JH36ORCC-CjGmke8C.js","assets/cynefin-EF2NZ3EQ-BEjYfR8t.js","assets/cynefinDiagram-L36ESFBY-BCM9x4F-.js","assets/cytoscape.esm-CjX6Hyah.js","assets/d3-scale-4DPf7zan.js","assets/dagre-SPEB5RXH-wdgiK1sk.js","assets/diagram-3B7GL73J-CXfq-dls.js","assets/diagram-DNEMPZML-CDrHltDh.js","assets/diagram-L3MUGCDN-DbifEArj.js","assets/diagram-LA4NIPWU-CEMCymvM.js","assets/diagram-MHCOC4E2-CpKABtfs.js","assets/diagram-XPFHEONP-kFGz9EU7.js","assets/ebnfDiagram-UZSYDL2S-CTE_3B9b.js","assets/elk-XV6XMXQE-Ca4zmPgR.js","assets/erDiagram-EYBAPDEH-RJyuYAvk.js","assets/flowDiagram-MALGAFMO-Bhg5cxAc.js","assets/ganttDiagram-23REXITY-BXKleMfN.js","assets/gitGraphDiagram-STJD7YCW-DRMG4o3r.js","assets/graph-D8UmR1vK.js","assets/infoDiagram-KBXO4MBG-BmdcoMYo.js","assets/ishikawaDiagram-M35NCXHK-D49rcKuT.js","assets/journeyDiagram-OPLOXDXO-GsKgVAxs.js","assets/kanban-definition-BZKZHSQY-Cd8c2vkd.js","assets/katex-DLSO0Xi6.js","assets/mermaid.core-D6VmFTwi.js","assets/mindmap-definition-I2QAS2VK-Jdb7MZ1g.js","assets/pdf-Duyp5f_f.js","assets/pdf.worker.min-B5Yc7dP4.mjs","assets/pdf.worker.min-kg7KTZJr.js","assets/pegDiagram-FD4XPPHP-IBAcUH4r.js","assets/pieDiagram-J4AKIIQI-Bp9VzVD1.js","assets/quadrantDiagram-XTYBLID2-zon8NwXs.js","assets/railroadDiagram-MRQ6NCDL-CDcSpNKc.js","assets/requirementDiagram-Y7LWUY3S-Brx484Qs.js","assets/sankeyDiagram-WGJFYUXA-BCPGHMV5.js","assets/sequenceDiagram-5NDRBG5M-fw3Lw_NW.js","assets/sizeCapture-INFHLROL-CerXKDP8.js","assets/stateDiagram-v2-FJ4FJNEA-DCVBXTCN.js","assets/swimlanes-UMQ2AFYF-DQqJ-piz.js","assets/swimlanesDiagram-OMPLPG4O-eExa0pi5.js","assets/timeline-definition-SEUHKTQE-Dq3jMjKt.js","assets/usecaseDiagram-AFA6YXN4-DxstXFKv.js","assets/vennDiagram-NNMJR3RB-CZbqI0_X.js","assets/wardleyDiagram-S7YFUSEH-COMHaiwZ.js","assets/xychartDiagram-GGNKY7IX-DqutIov8.js"];
const RUNTIME = ["mediapipe/tasks-genai-0.10.30/genai_wasm_internal.js","mediapipe/tasks-genai-0.10.30/genai_wasm_internal.wasm"];
const BUILD = "4d6591812a";
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
