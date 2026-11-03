// Photos for Online answers: downscaled on the device to a JPEG small enough for the server.

export interface Photo { mime: 'image/jpeg'; data: string; thumb: string }

/** Server cap is 1.4 MB of base64; stay well under it. */
const MAX_B64 = 1_100_000;

function load(file: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, max: number, q: number): string {
  const w0 = img.naturalWidth || img.width; const h0 = img.naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // transparent PNGs -> white, not black
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}

/** Reads a picked photo and returns it as a downscaled JPEG (max 1280 px) plus a small thumbnail. */
export async function prepare(file: Blob): Promise<Photo> {
  const img = await load(file);
  for (const [max, q] of [[1280, 0.8], [1024, 0.72], [800, 0.6]] as const) {
    const url = draw(img, max, q);
    const data = url.slice(url.indexOf(',') + 1);
    if (!url.startsWith('data:image/jpeg')) throw new Error('jpeg');
    if (data.length <= MAX_B64) return { mime: 'image/jpeg', data, thumb: draw(img, 240, 0.7) };
  }
  throw new Error('too_large');
}
