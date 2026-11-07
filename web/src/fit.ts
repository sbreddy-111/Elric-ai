// Fit the app to every phone: real visible height (old browsers without dvh,
// iOS keyboard, Android bottom bars), Home Screen mode flag, small/short screens.
const root = document.documentElement;

export const standalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

function setH() {
  const vv = window.visualViewport;
  // Pinch-zoom (a table, the diagram viewer) also shrinks the visual viewport: not a keyboard, not a new height.
  if (vv && Math.abs(vv.scale - 1) > 0.01) return;
  // In Home Screen mode on iOS, visualViewport shrinks with the keyboard; innerHeight does not.
  const h = Math.round(vv ? vv.height : window.innerHeight);
  root.style.setProperty('--app-h', h + 'px');
  const w = window.innerWidth;
  root.classList.toggle('narrow', w < 360);
  root.classList.toggle('short', h < 600);
  root.classList.toggle('kb', !!vv && window.innerHeight - vv.height > 120);
  // Keep the page from scrolling behind the app when the iOS keyboard opens.
  if (vv && vv.offsetTop > 0 && standalone()) window.scrollTo(0, 0);
}

export function initFit() {
  root.classList.toggle('pwa', standalone());
  root.classList.toggle('ios', /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1));
  setH();
  let raf = 0;
  const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(setH); };
  window.addEventListener('resize', on);
  window.addEventListener('orientationchange', () => setTimeout(setH, 250));
  window.visualViewport?.addEventListener('resize', on);
  window.visualViewport?.addEventListener('scroll', on);
  matchMedia('(display-mode: standalone)').addEventListener?.('change', () => root.classList.toggle('pwa', standalone()));
}
