// Elric AI image worker: Workers AI via binding, called only by the ai-image Supabase function (shared secret).
// Models: FLUX.2 klein 4B (default: better quality, can edit a photo) and FLUX.1 schnell (fallback).
const ALLOWED = new Set(["@cf/black-forest-labs/flux-1-schnell", "@cf/black-forest-labs/flux-2-klein-4b"]);
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const m = u.pathname.match(/^\/accounts\/[^/]+\/ai\/run\/(@cf\/[\w./-]+)$/);
    if (req.method !== "POST" || !m) return new Response("not found", { status: 404 });
    if ((req.headers.get("authorization") || "") !== `Bearer ${env.SHARED}`) return new Response("unauthorized", { status: 401 });
    if (!ALLOWED.has(m[1])) return new Response("bad model", { status: 400 });
    let body; try { body = await req.json(); } catch { return new Response("bad", { status: 400 }); }
    const prompt = String(body?.prompt || "").slice(0, 2048);
    if (prompt.length < 3) return new Response("bad", { status: 400 });
    try {
      let out;
      if (m[1].includes("flux-2")) {
        const form = new FormData();
        form.append("prompt", prompt);
        form.append("width", "1024"); form.append("height", "1024");
        if (typeof body?.image === "string" && body.image.length > 100) {
          form.append("input_image_0", new Blob([b64ToBytes(body.image)], { type: body.mime || "image/jpeg" }), "in.jpg");
        }
        const fr = new Response(form);
        out = await env.AI.run(m[1], { multipart: { body: fr.body, contentType: fr.headers.get("content-type") } });
      } else {
        out = await env.AI.run(m[1], { prompt, steps: Math.min(8, Math.max(1, Number(body?.steps) || 4)) });
      }
      return Response.json({ success: true, result: { image: out.image } });
    } catch (e) {
      const s = String(e && e.message || e);
      console.log("ai error", s.slice(0, 200));
      return new Response(JSON.stringify({ success: false, err: s.slice(0, 200) }), { status: /limit|neuron|429|exceeded/i.test(s) ? 429 : /nsfw|safety|flag/i.test(s) ? 400 : 503, headers: { "content-type": "application/json" } });
    }
  },
};
