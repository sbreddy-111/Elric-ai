// Read a PDF or text file on the device (for a question about it). The PDF reader is loaded only when a PDF
// is picked. Nothing here is uploaded: the app sends only a trimmed part of the text with the question
// (Online answers) or a short part to the on-device model.

export interface Doc { name: string; text: string; pages: number }

export const DOC_ACCEPT = 'application/pdf,.pdf,text/plain,.txt,.md,.csv';
const MAX_FILE = 25 * 1024 * 1024;
const MAX_PAGES = 60;
const MAX_CHARS = 200_000;

export const isDocFile = (f: File) => /pdf|text\//i.test(f.type) || /\.(pdf|txt|md|csv)$/i.test(f.name);

/** Extracts the text. Throws Error('too_large' | 'no_text' | 'read'). */
export async function readDoc(file: File): Promise<Doc> {
  if (file.size > MAX_FILE) throw new Error('too_large');
  const name = file.name.replace(/[\u0000-\u001f]/g, '').slice(0, 80) || 'file';
  let text = '';
  let pages = 0;
  if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    let pdfjs: any;
    try {
      pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
    } catch { throw new Error('read'); }
    let doc: any;
    try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
    catch { throw new Error('read'); }
    pages = doc.numPages;
    const out: string[] = [];
    let size = 0;
    for (let p = 1; p <= Math.min(pages, MAX_PAGES) && size < MAX_CHARS; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let line = '';
      for (const it of tc.items as any[]) {
        if (typeof it.str !== 'string') continue;
        line += it.str + (it.hasEOL ? '\n' : ' ');
      }
      const clean = line.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (clean) { out.push(clean); size += clean.length; }
      page.cleanup?.();
    }
    try { await doc.destroy(); } catch { /* ignore */ }
    text = out.join('\n\n');
  } else {
    try { text = await file.text(); } catch { throw new Error('read'); }
    pages = 1;
  }
  text = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, MAX_CHARS).trim();
  if (text.replace(/\s/g, '').length < 20) throw new Error('no_text');
  return { name, text, pages };
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length > 2));

/**
 * The part of the file to send with a question, at most max chars: the start of the file plus the
 * pieces that share the most words with the question, kept in file order.
 */
export function excerpt(doc: Doc, question: string, max: number): { text: string; trimmed: boolean } {
  if (doc.text.length <= max) return { text: doc.text, trimmed: false };
  const size = Math.max(300, Math.min(1500, Math.floor(max / 4)));
  const parts: string[] = [];
  for (let i = 0; i < doc.text.length; i += size) parts.push(doc.text.slice(i, i + size));
  const q = words(question);
  const score = parts.map((p, i) => {
    let n = 0;
    if (q.size) { const w = words(p); for (const x of q) if (w.has(x)) n++; }
    return { i, n: i === 0 ? n + 0.5 : n };
  });
  const pick = new Set<number>();
  let used = 0;
  for (const { i } of [...score].sort((a, b) => b.n - a.n || a.i - b.i)) {
    if (used + parts[i].length > max) continue;
    pick.add(i); used += parts[i].length;
  }
  const text = [...pick].sort((a, b) => a - b).map((i, k, arr) => (k && arr[k - 1] !== i - 1 ? '…\n' : '') + parts[i]).join('');
  return { text: text.slice(0, max), trimmed: true };
}
