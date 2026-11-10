// Cloudflare Worker "elric-models": serves the Elric Lite 2 web model with CORS + Range for elricai.sbs.
// GitHub release assets max 2 GiB each and have no CORS, so the model (~2.8 GB) is stored as fixed-size
// parts on a GitHub release and this Worker joins them into one virtual file (whole GET or any byte Range).
// Only the fixed file below is served; this is not an open proxy.
// Fill SIZE and PART after the model is split (split -b PART): parts named <name>.part0, .part1, ...
const BASE = 'https://github.com/sbreddy-111/Elric-ai/releases/download/model-elric-lite2-r6/';
const FILES = {
  '/elric-lite2-r6.litertlm': { name: 'elric-lite2-r6.litertlm', size: 2844937920, part: 1900 * 1024 * 1024 },
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};
function parseRange(r, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(r || '');
  if (!m) return null;
  let s, e;
  if (m[1] === '') { s = Math.max(0, size - Number(m[2])); e = size - 1; }
  else { s = Number(m[1]); e = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  return s <= e && s < size ? [s, e] : 'bad';
}
function joined(f, s, e) {
  const { readable, writable } = new TransformStream();
  (async () => {
    try {
      for (let i = Math.floor(s / f.part); i * f.part <= e; i++) {
        const ps = i * f.part, a = Math.max(s, ps) - ps, b = Math.min(e, ps + f.part - 1) - ps;
        const up = await fetch(BASE + f.name + '.part' + i, { headers: { Range: `bytes=${a}-${b}` }, redirect: 'follow' });
        if (up.status !== 206 && up.status !== 200) throw new Error('part ' + i + ' ' + up.status);
        await up.body.pipeTo(writable, { preventClose: true });
      }
      await writable.close();
    } catch (err) { await writable.abort(err); }
  })();
  return readable;
}
export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const f = FILES[url.pathname];
    if (!f || !f.size) return new Response('Not found', { status: 404, headers: CORS });
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: CORS });
    const h = new Headers(CORS);
    h.set('Content-Type', 'application/octet-stream');
    h.set('Accept-Ranges', 'bytes');
    h.set('Cache-Control', 'public, max-age=86400');
    let s = 0, e = f.size - 1, status = 200;
    const rq = req.headers.get('Range');
    if (rq) {
      const r = parseRange(rq, f.size);
      if (r === 'bad') { h.set('Content-Range', `bytes */${f.size}`); return new Response(null, { status: 416, headers: h }); }
      if (r) { [s, e] = r; status = 206; h.set('Content-Range', `bytes ${s}-${e}/${f.size}`); }
    }
    h.set('Content-Length', String(e - s + 1));
    return new Response(req.method === 'HEAD' ? null : joined(f, s, e), { status, headers: h });
  },
};
