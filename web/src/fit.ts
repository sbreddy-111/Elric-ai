// Fit the app to every phone: real visible height (old browsers without dvh,
// iOS keyboard, Android bottom bars), Home Screen mode flag, small/short screens.
const root = document.documentElement;

export const standalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

// Tallest visible height seen with no text box focused (per orientation): the "no keyboard" baseline.
let full = 0;
const editing = () => { const a = document.activeElement as HTMLElement | null; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(button|checkbox|radio|range|file|submit)$/i.test((a as HTMLInputElement).type)) || a.isContentEditable); };

function setH() {
  const vv = window.visualViewport;
  // Pinch-zoom (a table, the diagram viewer) also shrinks the visual viewport: not a keyboard, not a new height.
  if (vv && Math.abs(vv.scale - 1) > 0.01) return;
  const h = Math.round(vv ? vv.height : window.innerHeight);
  const ed = editing();
  if (!ed) full = h;
  else if (!full) full = Math.max(h, window.innerHeight, screen.height - 120);
  root.style.setProperty('--app-h', h + 'px');
  const w = window.innerWidth;
  root.classList.toggle('narrow', w < 360);
  root.classList.toggle('short', h < 600);
  // Keyboard open: a text box is focused and the visible area shrank. Compared with our own baseline,
  // not innerHeight: on newer iOS (Home Screen app) innerHeight shrinks too, so the old check missed it
  // and the composer sat behind the keyboard (2026-11-08).
  const kb = !!vv && ed && (full - h > 120 || window.innerHeight - h > 120);
  const was = root.classList.contains('kb');
  root.classList.toggle('kb', kb);
  // Keyboard just opened: keep the newest message in view above the composer.
  if (kb && !was) requestAnimationFrame(() => { const m = document.querySelector('main'); if (m) m.scrollTop = m.scrollHeight; });
  // iOS may still scroll the visual viewport down; follow it so the app stays in the visible area.
  root.style.setProperty('--app-top', (kb && vv ? Math.max(0, Math.round(vv.offsetTop)) : 0) + 'px');
  if (vv && vv.offsetTop > 0 && !root.classList.contains('pwa')) window.scrollTo(0, 0);
}

export function initFit() {
  root.classList.toggle('pwa', standalone());
  root.classList.toggle('ios', /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1));
  setH();
  let raf = 0;
  const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(setH); };
  window.addEventListener('resize', on);
  window.addEventListener('orientationchange', () => { full = 0; setTimeout(setH, 250); });
  window.visualViewport?.addEventListener('resize', on);
  window.visualViewport?.addEventListener('scroll', on);
  // Focus changes come before the keyboard finishes opening/closing: check now and again after it settles.
  const later = () => { on(); setTimeout(setH, 300); setTimeout(setH, 700); };
  document.addEventListener('focusin', later);
  document.addEventListener('focusout', later);
  matchMedia('(display-mode: standalone)').addEventListener?.('change', () => root.classList.toggle('pwa', standalone()));
}
