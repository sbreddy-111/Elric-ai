// Elric AI image worker: Workers AI via binding, called only by the ai-image Supabase function (shared secret).
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const m = u.pathname.match(/^\/accounts\/[^/]+\/ai\/run\/(@cf\/[\w./-]+)$/);
    if (req.method !== "POST" || !m) return new Response("not found", { status: 404 });
    if ((req.headers.get("authorization") || "") !== `Bearer ${env.SHARED}`) return new Response("unauthorized", { status: 401 });
    if (m[1] !== "@cf/black-forest-labs/flux-1-schnell") return new Response("bad model", { status: 400 });
    let body; try { body = await req.json(); } catch { return new Response("bad", { status: 400 }); }
    const prompt = String(body?.prompt || "").slice(0, 2048);
    if (prompt.length < 3) return new Response("bad", { status: 400 });
    try {
      const out = await env.AI.run(m[1], { prompt, steps: Math.min(8, Math.max(1, Number(body?.steps) || 4)) });
      return Response.json({ success: true, result: { image: out.image } });
    } catch (e) {
      const s = String(e && e.message || e);
      return new Response(JSON.stringify({ success: false }), { status: /limit|neuron|429/i.test(s) ? 429 : /nsfw|safety|flag/i.test(s) ? 400 : 503, headers: { "content-type": "application/json" } });
    }
  },
};
