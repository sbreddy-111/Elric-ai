// Draws ```mermaid diagrams in answers. Mermaid is loaded only when a diagram first appears;
// if it can't draw one, the code stays visible instead.

let lib: Promise<any> | null = null;
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
      const html = `<div class="mmd-svg">${svg}</div>`;
      cache.set(code, html);
      el.innerHTML = html;
      el.classList.add('ok');
    } catch {
      el.classList.add('bad'); // keep showing the code
      document.getElementById(`delric-mmd-${n}`)?.remove(); // mermaid's leftover error box
    }
  }
}
