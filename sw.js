// Elric AI service worker: keeps the app shell available offline.
// The model file itself is stored separately by the app (OPFS / Cache API),
// never by this worker.
const VERSION = 'elric-shell-v34';
// Filled in at build time (vite.config.ts, precacheList). Empty in dev.
const SHELL_ASSETS = ["assets/index-Dx_YAejF.js","assets/index-uuviMWQJ.css","assets/modulepreload-polyfill-B5Qt9EMX.js"];
const LAZY_ASSETS = ["assets/_commonjsHelpers-Cpj98o6Y.js","assets/abnfDiagram-S7VZAUFO-8YO9GQ8G.js","assets/architectureDiagram-YGSQEFNW-C7VPQE5V.js","assets/blockDiagram-APKKGZFW-C_JCaO8N.js","assets/bpmnIcons-APHXDYXF-ByGoYv9M.js","assets/c4Diagram-KJ2TOQU5-CbLZ0VU3.js","assets/chunk-2Q5K7J3B-CKfHUpzg.js","assets/chunk-5VM5RSS4-COKUdufW.js","assets/chunk-HFQBQIA3-CK2MpvEC.js","assets/chunk-JWPE2WC7-t6sTSoTV.js","assets/chunk-KQLB2F66-CXpjFqeC.js","assets/chunk-KS47KZWR-DN0ToL4h.js","assets/chunk-OY52VR5R-xiFmvEWw.js","assets/chunk-TU62E6Q5-BxfjL1QD.js","assets/chunk-XXDRQBXY-B_M1vhG0.js","assets/classDiagram-v2-L25IHNXF-Cu958LBk.js","assets/cose-bilkent-JH36ORCC-B0FEBUMv.js","assets/cynefin-EF2NZ3EQ-BWNDV5lo.js","assets/cynefinDiagram-L36ESFBY-vJ9Oghdw.js","assets/cytoscape.esm-CjX6Hyah.js","assets/d3-scale-4DPf7zan.js","assets/dagre-SPEB5RXH-uV6HZqEa.js","assets/diagram-3B7GL73J-CD21RLsw.js","assets/diagram-DNEMPZML-CXwJ6qsn.js","assets/diagram-L3MUGCDN-D0UaQVbi.js","assets/diagram-LA4NIPWU-D6IUfmW-.js","assets/diagram-MHCOC4E2-CgIo3A-R.js","assets/diagram-XPFHEONP-36owbqPD.js","assets/ebnfDiagram-UZSYDL2S-B7sDHWEB.js","assets/elk-XV6XMXQE-Dc054JPl.js","assets/erDiagram-EYBAPDEH-CzZPJ5K7.js","assets/flowDiagram-MALGAFMO-CVoC3uEe.js","assets/ganttDiagram-23REXITY-D3-bJYZZ.js","assets/gitGraphDiagram-STJD7YCW-DnJ96d2w.js","assets/graph-D8UmR1vK.js","assets/infoDiagram-KBXO4MBG-Daf7U4U5.js","assets/ishikawaDiagram-M35NCXHK-DjvYSuj6.js","assets/journeyDiagram-OPLOXDXO-D1TUhmFI.js","assets/kanban-definition-BZKZHSQY-TZQ2lCHY.js","assets/katex-DLSO0Xi6.js","assets/mermaid.core-vHiybsQP.js","assets/mindmap-definition-I2QAS2VK-DnxAciGV.js","assets/pdf-Duyp5f_f.js","assets/pdf.worker.min-B5Yc7dP4.mjs","assets/pdf.worker.min-kg7KTZJr.js","assets/pegDiagram-FD4XPPHP-BpuIYsof.js","assets/pieDiagram-J4AKIIQI-qihwd3F1.js","assets/quadrantDiagram-XTYBLID2-VzdC4c6D.js","assets/railroadDiagram-MRQ6NCDL-VSNZBqD-.js","assets/requirementDiagram-Y7LWUY3S-R-lRQYHb.js","assets/sankeyDiagram-WGJFYUXA-C2C7P8Vx.js","assets/sequenceDiagram-5NDRBG5M-CnGeHVkb.js","assets/sizeCapture-INFHLROL-Bd9wY3ly.js","assets/stateDiagram-v2-FJ4FJNEA-Da8ANX88.js","assets/swimlanes-UMQ2AFYF-CfXHbNoH.js","assets/swimlanesDiagram-OMPLPG4O-DHALSP7k.js","assets/timeline-definition-SEUHKTQE-BqCHy-Kb.js","assets/usecaseDiagram-AFA6YXN4-DkafV2qt.js","assets/vennDiagram-NNMJR3RB-DEbTXsmC.js","assets/wardleyDiagram-S7YFUSEH-BJ4i-GWZ.js","assets/xychartDiagram-GGNKY7IX-B3pF1Rj8.js"];
const RUNTIME = ["mediapipe/tasks-genai-0.10.30/genai_wasm_internal.js","mediapipe/tasks-genai-0.10.30/genai_wasm_internal.wasm"];
const BUILD = "7b9d2e8b75";
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
