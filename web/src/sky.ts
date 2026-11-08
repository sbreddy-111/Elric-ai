// Living sky for the General Home (0.4.41): a painted Andhra sky (morning / afternoon / evening / night,
// picked from the real sunrise and sunset) with live weather drawn on top: drifting clouds, rain,
// lightning, mist, twinkling stars and the odd shooting star. Everything runs on the phone; the only
// data is the free Open-Meteo weather the Home already fetches.

export type Phase = 'morning' | 'afternoon' | 'evening' | 'night';
export type Kind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'storm';
export interface SkyWx { code: number; sr?: string; ss?: string }

const RATIO = 1520 / 704; // painted sky images are 704 x 1520 (tall, so any phone height is covered)
// Where the field meets the sky in each painting, as a share of its height (measured from the images).
const HZ: Record<Phase, number> = { morning: 0.625, afternoon: 0.405, evening: 0.655, night: 0.665 };
const GAP = 64; // horizon sits this many px above the price card, so the card floats on the field
const IMG = (p: Phase) => `icons/sky2-${p}.webp`;
let cloudImg: HTMLImageElement | null = null;

/** Day part from the clock and (when known) today's sunrise / sunset. */
export function phaseFor(now: Date, sr?: string, ss?: string): Phase {
  const at = (s: string | undefined, h: number, m: number) => {
    const d = s ? new Date(s) : null;
    if (d && !isNaN(+d)) { const x = new Date(now); x.setHours(d.getHours(), d.getMinutes(), 0, 0); return +x; }
    const x = new Date(now); x.setHours(h, m, 0, 0); return +x;
  };
  const rise = at(sr, 6, 10), set = at(ss, 17, 50), t = +now, min = 60e3;
  if (t < rise - 40 * min || t > set + 40 * min) return 'night';
  if (t < rise + 210 * min) return 'morning';
  if (t > set - 105 * min) return 'evening';
  return 'afternoon';
}

/** WMO weather code -> what the sky shows. */
export function kindFor(code: number): Kind {
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code === 2) return 'partly';
  if (code <= 1) return 'clear';
  return 'cloudy'; // 3, snow codes (not seen in AP), anything unknown
}

/** Short weather word for the line under the date. */
export function wxWord(code: number, night: boolean, lang: 'en' | 'hi'): string {
  const hi = lang === 'hi';
  if (code >= 95) return hi ? 'आंधी-तूफ़ान' : 'Thunderstorm';
  if (code >= 51 && code <= 57) return hi ? 'बूंदाबांदी' : 'Drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return hi ? 'बारिश' : 'Rain';
  if (code === 45 || code === 48) return hi ? 'कोहरा' : 'Foggy';
  if (code === 2) return hi ? 'आंशिक बादल' : 'Partly cloudy';
  if (code <= 1) return night ? (hi ? 'साफ़ आसमान' : 'Clear') : (hi ? 'धूप' : 'Sunny');
  return hi ? 'बादल' : 'Cloudy';
}

// ------------------------------------------------------------------ state

let wx: SkyWx | null = null;
let el: HTMLElement | null = null;
let fx: HTMLCanvasElement | null = null;
let raf = 0, phaseTimer: any = 0, resizeT: any = 0;
let phase: Phase | null = null, kind: Kind = 'clear';
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Puts the sky behind the Home (once; later calls only re-align it). */
export function mountSky(app: HTMLElement, main: HTMLElement) {
  document.documentElement.classList.add('skyon');
  if (!el || !el.isConnected) {
    el = document.createElement('div');
    el.id = 'sky'; el.className = 'sky'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<img class="si" alt=""><img class="si" alt=""><div class="sglow"></div><canvas class="sfx"></canvas><div class="sflash"></div><div class="sshade"></div>';
    app.prepend(el);
    fx = el.querySelector('canvas');
    phase = null;
    try { const c = JSON.parse(localStorage.getItem('elric.wxlast') || 'null'); if (c && typeof c.code === 'number') wx = c; } catch { /* ignore */ }
    apply();
    clearInterval(phaseTimer); phaseTimer = setInterval(() => { if (el?.isConnected) apply(); else clearInterval(phaseTimer); }, 60e3);
    addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
  }
  if (!main.dataset.sky) {
    main.dataset.sky = '1';
    main.addEventListener('scroll', () => parallax(main.scrollTop), { passive: true });
  }
  parallax(main.scrollTop);
  requestAnimationFrame(layout);
}

/** Removes the sky (chat open, another mode). */
export function unmountSky() {
  document.documentElement.classList.remove('skyon');
  cancelAnimationFrame(raf); raf = 0; clearInterval(phaseTimer);
  removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onVis);
  el?.remove(); el = null; fx = null; phase = null;
}

/** New weather from the Home's weather fetch. */
export function setSkyWeather(w: SkyWx) {
  wx = w;
  try { localStorage.setItem('elric.wxlast', JSON.stringify(w)); } catch { /* storage full */ }
  if (el?.isConnected) apply();
}

export function skyPhase(): Phase { return phaseFor(new Date(), wx?.sr, wx?.ss); }

function onResize() { clearTimeout(resizeT); resizeT = setTimeout(layout, 120); }
function onVis() { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else start(); }

function parallax(s: number) {
  if (!el) return;
  const y = Math.max(0, s);
  el.style.transform = `translate3d(0,${-y * 0.55}px,0)`;
  el.style.opacity = String(Math.max(0, 1 - y / 520));
}

/** Lines each painting's horizon up just above the price card, whatever the screen size. */
let anchor = 0;
function layout() {
  if (!el?.isConnected) return;
  const app = el.parentElement!, main = document.getElementById('main'), card = document.getElementById('tCrop');
  const w = app.clientWidth;
  let cardTop = w * 1.0;
  if (card && main) cardTop = card.getBoundingClientRect().top - app.getBoundingClientRect().top + main.scrollTop;
  anchor = Math.max(120, cardTop - GAP);
  const H = Math.round(cardTop + 300);
  el.style.top = '0px';
  el.style.height = `${H}px`;
  el.querySelectorAll<HTMLImageElement>('.si').forEach((im) => {
    const hz = HZ[(im.dataset.ph as Phase) || 'afternoon'] || 0.5;
    const h = Math.max(w * RATIO, anchor / hz, H + 40);
    const iw = h / RATIO, top = Math.min(0, anchor - hz * h);
    Object.assign(im.style, { height: `${Math.round(h)}px`, width: `${Math.round(iw)}px`, top: `${Math.round(top)}px`, left: `${Math.round((w - iw) / 2)}px` });
  });
  const sh = el.querySelector<HTMLElement>('.sshade');
  if (sh) sh.style.background = `linear-gradient(180deg,rgba(0,0,0,.42) 0,rgba(0,0,0,0) 150px),linear-gradient(180deg,rgba(15,15,18,0) ${anchor + 30}px,rgba(15,15,18,.55) ${anchor + 150}px,#0F0F12 ${H}px)`;
  sizeCanvas();
}

function apply() {
  if (!el) return;
  const p = phaseFor(new Date(), wx?.sr, wx?.ss);
  const k: Kind = wx ? kindFor(wx.code) : 'clear';
  let changed = false;
  if (p !== phase) {
    // Cross-fade to the new painting once it has loaded.
    const [a, b] = Array.from(el.querySelectorAll<HTMLImageElement>('.si'));
    const show = a.classList.contains('on') ? b : a, hide = show === a ? b : a;
    const done = () => { show.classList.add('on'); hide.classList.remove('on'); };
    show.onload = done;
    show.onerror = () => { show.classList.remove('on'); };
    show.dataset.ph = p;
    show.src = IMG(p);
    layout();
    if (show.complete && show.naturalWidth) done();
    el.classList.remove('ph-morning', 'ph-afternoon', 'ph-evening', 'ph-night');
    el.classList.add('ph-' + p);
    phase = p; changed = true;
  }
  if (k !== kind || !el.dataset.k) {
    el.classList.remove('k-clear', 'k-partly', 'k-cloudy', 'k-fog', 'k-rain', 'k-storm');
    el.classList.add('k-' + k);
    el.dataset.k = k; kind = k; changed = true;
  }
  if (changed) seed();
  if (still()) frame(performance.now(), true); else start();
}

// ------------------------------------------------------------------ weather effects (canvas)

type Cloud = { x: number; y: number; s: number; v: number; a: number };
type Drop = { x: number; y: number; l: number; v: number };
type Star = { x: number; y: number; r: number; f: number; o: number };
let clouds: Cloud[] = [], drops: Drop[] = [], stars: Star[] = [];
let sprite: HTMLCanvasElement | null = null;
let W = 0, H = 0, dpr = 1, last = 0, nextShoot = 0, shoot: { x: number; y: number; t: number } | null = null, nextFlash = 0;

function sizeCanvas() {
  if (!fx || !el) return;
  dpr = Math.min(2, devicePixelRatio || 1);
  W = el.clientWidth; H = el.clientHeight;
  if (!W || !H) return;
  fx.width = Math.round(W * dpr); fx.height = Math.round(H * dpr);
  seed();
  if (still() || !raf) frame(performance.now(), true);
}

function cloudSrc(): CanvasImageSource & { width: number; height: number } {
  if (!cloudImg) { cloudImg = new Image(); cloudImg.onload = () => { if (still()) frame(performance.now(), true); }; cloudImg.src = 'icons/cloud1.webp'; }
  return cloudImg.complete && cloudImg.naturalWidth ? cloudImg : cloudSprite();
}

function cloudSprite(): HTMLCanvasElement {
  if (sprite) return sprite;
  const c = document.createElement('canvas'); c.width = 320; c.height = 140;
  const g = c.getContext('2d')!;
  const puffs: [number, number, number][] = [[70, 88, 50], [120, 70, 62], [180, 64, 58], [235, 84, 48], [150, 96, 52], [95, 100, 40], [210, 100, 42]];
  for (const [x, y, r] of puffs) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,.55)'); rg.addColorStop(.6, 'rgba(255,255,255,.22)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return (sprite = c);
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function seed() {
  if (!W || !H) return;
  const n: Record<Kind, number> = { clear: 3, partly: 5, cloudy: 7, fog: 5, rain: 7, storm: 8 };
  const al: Record<Kind, number> = { clear: .42, partly: .55, cloudy: .62, fog: .45, rain: .5, storm: .5 };
  const night = phase === 'night' ? .3 : phase === 'evening' ? .7 : 1;
  const skyH = Math.max(80, (anchor || H * .5) - 40);
  clouds = Array.from({ length: n[kind] }, (_, i) => ({ x: rnd(-.3, 1) * W, y: (.04 + (i / n[kind]) * .7) * skyH + rnd(-12, 12), s: rnd(.32, .7), v: rnd(12, 26), a: al[kind] * night * rnd(.75, 1.1) }));
  const nd = kind === 'storm' ? 130 : kind === 'rain' ? 90 : 0;
  drops = Array.from({ length: nd }, () => ({ x: rnd(0, W), y: rnd(0, H), l: rnd(9, 18), v: rnd(620, 900) }));
  const showStars = phase === 'night' && (kind === 'clear' || kind === 'partly');
  stars = showStars ? Array.from({ length: 70 }, () => ({ x: rnd(0, W), y: rnd(0, Math.max(60, (anchor || H * .5) - 30)), r: rnd(.4, 1.3), f: rnd(.6, 2.2), o: rnd(0, 6.28) })) : [];
  nextShoot = performance.now() + rnd(4000, 9000); shoot = null;
  nextFlash = performance.now() + rnd(3000, 7000);
}

function start() {
  if (raf || !el?.isConnected || document.hidden) return;
  if (still()) { frame(performance.now(), true); return; }
  const loop = (t: number) => {
    if (!el?.isConnected) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (t - last < 33) return; // ~30 fps is plenty and saves battery
    frame(t, false);
  };
  raf = requestAnimationFrame(loop);
}

function frame(t: number, once: boolean) {
  if (!fx || !W || !H) return;
  const dt = once ? 0 : Math.min(0.1, (t - (last || t)) / 1000);
  last = t;
  const g = fx.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  // Stars twinkle; a shooting star now and then.
  for (const s of stars) {
    g.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t / 1000 * s.f + s.o));
    g.fillStyle = '#fff'; g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill();
  }
  if (stars.length && !once) {
    if (!shoot && t > nextShoot) shoot = { x: rnd(.15, .7) * W, y: rnd(.05, .25) * H, t };
    if (shoot) {
      const k = (t - shoot.t) / 900;
      if (k >= 1) { shoot = null; nextShoot = t + rnd(9000, 16000); } else {
        const x = shoot.x + k * 180, y = shoot.y + k * 70;
        const lg = g.createLinearGradient(x - 70, y - 27, x, y);
        lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(1, `rgba(255,255,255,${.9 * (1 - k)})`);
        g.globalAlpha = 1; g.strokeStyle = lg; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x - 70, y - 27); g.lineTo(x, y); g.stroke();
      }
    }
  }
  // Clouds drift right and wrap round.
  const sp = cloudSrc(), cw = sp === sprite ? 320 : 736, ch = sp === sprite ? 140 : sp.height * 736 / sp.width;
  for (const c of clouds) {
    c.x += c.v * dt; if (c.x > W + 20) c.x = -cw * c.s - rnd(0, 80);
    g.globalAlpha = c.a; g.drawImage(sp, c.x, c.y, cw * c.s, ch * c.s);
  }
  // Mist over the fields.
  if (kind === 'fog' || (phase === 'morning' && kind !== 'rain' && kind !== 'storm')) {
    const a = kind === 'fog' ? .32 : .12;
    const off = (t / 1000 * 8) % W;
    for (let i = 0; i < 2; i++) {
      const y = (anchor || H * .56) - 10 + i * 26;
      const lg = g.createLinearGradient(0, y - 30, 0, y + 30);
      lg.addColorStop(0, 'rgba(225,230,240,0)'); lg.addColorStop(.5, `rgba(225,230,240,${a})`); lg.addColorStop(1, 'rgba(225,230,240,0)');
      g.globalAlpha = 1; g.fillStyle = lg;
      g.fillRect(-W + off * (i ? -1 : 1) % W, y - 30, W * 3, 60);
    }
  }
  // Rain.
  if (drops.length) {
    g.globalAlpha = kind === 'storm' ? .42 : .34; g.strokeStyle = '#cfe0ff'; g.lineWidth = 1; g.beginPath();
    for (const d of drops) {
      d.y += d.v * dt; d.x += d.v * .18 * dt;
      if (d.y > H * .9) { d.y = rnd(-40, 0); d.x = rnd(-40, W); }
      g.moveTo(d.x, d.y); g.lineTo(d.x + d.l * .18, d.y + d.l);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  // Lightning flash.
  if (kind === 'storm' && !once && t > nextFlash) {
    const f = el?.querySelector<HTMLElement>('.sflash');
    if (f) { f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
    nextFlash = t + rnd(6000, 12000);
  }
}
