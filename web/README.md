# Elric AI — web app (PWA)

Chat-first, offline-first Elric AI for the browser. Vite + vanilla TypeScript, static output in `dist/`.

- On-device model: **Elric Lite** (open model, Apache-2.0, ~2.0 GB, text-only on web), run with the MediaPipe LLM Inference web runtime on WebGPU. Downloaded once on user request and stored in OPFS (Cache API fallback).
- Honest device check: no WebGPU / no adapter → "This device can't run Elric offline yet". A crash during model start (common on iPhone memory limits) is detected on next launch and explained.
- Snap (photo) and mic are "coming soon" sheets on web. Shopping mode never states prices.
- English + Hindi (EN/हिं toggle). Installable (manifest + service worker; iOS Add to Home Screen).

```bash
cd web && npm install && npm run build   # output: web/dist
```
