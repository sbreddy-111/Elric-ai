import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, createReadStream } from 'node:fs';

// The on-device runtime (MediaPipe GenAI WASM) is served from this site, not a CDN,
// so offline answers keep working when the browser's HTTP cache is cleared.
const MP_PKG = resolve(__dirname, 'node_modules/@mediapipe/tasks-genai');
const MP_VERSION: string = JSON.parse(readFileSync(resolve(MP_PKG, 'package.json'), 'utf8')).version;
const MP_DIR = `mediapipe/tasks-genai-${MP_VERSION}`;
// Only the non-module loaders are used (FilesetResolver.forGenAiTasks(base) with useModule=false):
// SIMD build on every WebGPU browser, no-SIMD kept as a fallback.
const MP_FILES = ['genai_wasm_internal.js', 'genai_wasm_internal.wasm', 'genai_wasm_nosimd_internal.js', 'genai_wasm_nosimd_internal.wasm'];

/** Copies the runtime files into dist (build) and serves them from node_modules (dev). */
function selfHostRuntime(): Plugin {
  return {
    name: 'elric-self-host-runtime',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(new RegExp(`/${MP_DIR}/([\\w.]+)$`));
        if (!m || !MP_FILES.includes(m[1])) return next();
        res.setHeader('Content-Type', m[1].endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(resolve(MP_PKG, 'wasm', m[1])).pipe(res);
      });
    },
    generateBundle() {
      for (const f of MP_FILES) this.emitFile({ type: 'asset', fileName: `${MP_DIR}/${f}`, source: readFileSync(resolve(MP_PKG, 'wasm', f)) });
    },
  };
}

/**
 * Writes the built file list into dist/sw.js, so the service worker precaches the hashed
 * JS/CSS bundle on install (the app works offline from the very first visit).
 *  - SHELL_ASSETS: the main entry, its CSS and every chunk it imports statically (install fails without them).
 *  - LAZY_ASSETS: chunks loaded later (PDF reader + worker, diagrams); cached on install, best effort.
 *  - RUNTIME: the on-device runtime files, cached when the model is on the device (see engine.ts).
 *  - BUILD: a hash of the list, so each deploy gets its own cache.
 */
function precacheList(): Plugin {
  let shell: string[] = [];
  let lazy: string[] = [];
  let outDir = 'dist';
  return {
    name: 'elric-precache-list',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    generateBundle(_o, bundle) {
      const isAdmin = (f: string) => /(^|\/)admin[-/]/.test(f) || f.startsWith('admin');
      const entry = Object.values(bundle).find((b) => b.type === 'chunk' && b.isEntry && b.name === 'index');
      if (!entry || entry.type !== 'chunk') throw new Error('precache: no index entry chunk');
      const crit = new Set<string>();
      const walk = (f: string) => {
        if (crit.has(f)) return;
        crit.add(f);
        const c = bundle[f];
        if (c?.type !== 'chunk') return;
        c.imports.forEach(walk);
        c.viteMetadata?.importedCss.forEach((x) => crit.add(x));
        c.viteMetadata?.importedAssets.forEach((x) => crit.add(x));
      };
      walk(entry.fileName);
      shell = [...crit].filter((f) => !isAdmin(f)).sort();
      lazy = Object.keys(bundle)
        .filter((f) => f.startsWith('assets/') && !crit.has(f) && !isAdmin(f) && !f.endsWith('.map'))
        .sort();
    },
    closeBundle() {
      const p = resolve(outDir, 'sw.js');
      if (!existsSync(p)) throw new Error('precache: dist/sw.js missing');
      const runtime = MP_FILES.filter((f) => !f.includes('nosimd')).map((f) => `${MP_DIR}/${f}`);
      const build = createHash('sha256').update(JSON.stringify([shell, lazy, runtime])).digest('hex').slice(0, 10);
      let src = readFileSync(p, 'utf8');
      const put = (name: string, v: unknown) => {
        const re = new RegExp(`const ${name} = [^;]*;`);
        if (!re.test(src)) throw new Error(`precache: ${name} placeholder missing in sw.js`);
        src = src.replace(re, `const ${name} = ${JSON.stringify(v)};`);
      };
      put('SHELL_ASSETS', shell);
      put('LAZY_ASSETS', lazy);
      put('RUNTIME', runtime);
      put('BUILD', build);
      writeFileSync(p, src);
    },
  };
}

export default defineConfig({
  base: './',
  define: { __MP_DIR__: JSON.stringify(MP_DIR) },
  plugins: [selfHostRuntime(), precacheList()],
  build: {
    target: 'es2022', outDir: 'dist', assetsInlineLimit: 0,
    rollupOptions: {
      // Main app (unchanged) + separate owner-only admin page at /admin/.
      input: { index: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin/index.html') },
    },
  },
});
