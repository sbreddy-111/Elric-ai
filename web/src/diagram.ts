// Draws ```mermaid diagrams in answers. Mermaid is loaded only when a diagram first appears;
// if it can't draw one, the code stays visible instead.

import * as F from './feedback';

let lib: Promise<any> | null = null;
let reported = 0;
/** Version is passed in by main.ts so this file has no import cycle. */
export const diag = { version: '' };
let n = 0;

function load(): Promise<any> {
  if (!lib) {
    lib = import('mermaid').then((m) => {
      const mm = m.default;
      const light = document.documentElement.dataset.theme === 'light';
      mm.initialize({ startOnLoad: false, securityLevel: 'strict', theme: light ? 'default' : 'dark', fontFamily: 'inherit', flowchart: { htmlLabels: false } });
      return mm;
    }).catch((e) => { lib = null; throw e; });
  }
  return lib;
}

const cache = new Map<string, string>();

/** Safari draws an SVG with width="100%" and no height at 150 px tall, so the diagram came out tiny.
 *  Give it its real size from the viewBox; CSS then shrinks it to fit the screen. */
export function sized(svg: string): string {
  const vb = svg.match(/viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"/);
  if (!vb) return svg;
  const w = Math.round(+vb[1]), h = Math.round(+vb[2]);
  return svg.replace(/<svg\b([^>]*)>/, (_m, a: string) =>
    {
      // Medium size: at most 360 px tall in the chat (tap opens it full screen). Very wide diagrams keep readable
      // text and scroll sideways instead of shrinking to a strip.
      let dw = Math.min(w, Math.round((360 * w) / h));
      const wide = dw > 600;
      if (wide) dw = Math.max(420, Math.round(dw * 0.6));
      dw = Math.max(dw, Math.min(w, 160));
      return `<svg${a.replace(/\s(width|height|style)="[^"]*"/g, '')} width="${w}" height="${h}" style="width:${dw}px;${wide ? 'max-width:none' : 'max-width:100%'};height:auto;aspect-ratio:${w} / ${h}">`;
    });
}

/** Small models often write flowchart nodes as bare "Label" strings, which Mermaid rejects: give each one an id. */
export function repair(code: string): string {
  if (!/^\s*(flowchart|graph)\b/i.test(code)) return code;
  const ids = new Map<string, string>();
  return code.replace(/(^|[\s>])"([^"\n]+)"/gm, (_m, pre: string, label: string) => {
    let id = ids.get(label);
    if (!id) { id = `n${ids.size + 1}`; ids.set(label, id); return `${pre}${id}["${label}"]`; }
    return `${pre}${id}`;
  });
}

/** Renders every diagram placeholder inside root that isn't drawn yet. */
export async function drawDiagrams(root: ParentNode): Promise<void> {
  const els = Array.from(root.querySelectorAll<HTMLElement>('.mmd:not([data-done])'));
  if (!els.length) return;
  for (const el of els) {
    el.dataset.done = '1';
    const code = el.querySelector('code')?.textContent || '';
    if (!code.trim()) continue;
    const hit = cache.get(code);
    if (hit) { el.innerHTML = hit; el.classList.add('ok'); continue; }
    try {
      const mm = await load();
      let svg = '';
      try { ({ svg } = await mm.render(`elric-mmd-${++n}`, code)); } catch (e) {
        const fixed = repair(code);
        if (fixed === code) throw e;
        document.getElementById(`delric-mmd-${n}`)?.remove();
        ({ svg } = await mm.render(`elric-mmd-${++n}`, fixed));
      }
      if (!el.isConnected) continue;
      const html = `<div class="mmd-svg">${sized(svg)}</div>`;
      cache.set(code, html);
      el.innerHTML = html;
      el.classList.add('ok');
    } catch (e: any) {
      el.classList.add('bad'); // keep showing the code
      // One silent error row per session (no chat text: only the diagram code and the error), so we can fix it.
      if (reported++ < 1) F.send({ kind: 'crash', app_version: diag.version, platform: `web ${F.shortUA()}`, device: F.device(),
        backend: 'diagram', note: `diagram: ${String(e?.message || e).slice(0, 600)}`, answer: code.slice(0, 2000) });
      document.getElementById(`delric-mmd-${n}`)?.remove(); // mermaid's leftover error box
    }
  }
}
