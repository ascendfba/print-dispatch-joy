# Dispatch Console — Desktop build

The app runs in this preview as a normal web app, but for full functionality
(silent printing to a specific Windows printer + direct Mintsoft calls
without CORS) it is packaged as an Electron desktop app.

## One-time setup on your machine

```bash
npm install --save-dev electron @electron/packager
```

(The `electron/main.cjs` and `electron/preload.cjs` files in this repo
are the desktop entry points; nothing else needs to change.)

Make sure `vite.config.ts` sets `base: './'` for Electron builds — paths
must be relative because Electron loads via `file://`.

## Run in dev (after building once)

```bash
npm run build
npx electron electron/main.cjs
```

## Package a Windows installer

```bash
npm run build && \
npx @electron/packager . "DispatchConsole" \
  --platform=win32 --arch=x64 \
  --out=electron-release --overwrite \
  --ignore='^/src' --ignore='^/public' --ignore='^/electron-release'
```

The output folder under `electron-release/` is a portable Windows app —
copy it to the dispatch PC and run `DispatchConsole.exe`.

## What lives where

- `electron/main.cjs` — Node side: lists installed printers, silent-prints
  PDFs to a chosen printer, proxies Mintsoft API calls (no CORS).
- `electron/preload.cjs` — exposes `window.dispatchAPI` to the renderer.
- React app — same code as the web preview. It detects `window.dispatchAPI`
  and uses native printer / API access in Electron, otherwise falls back to
  the in-app browser flow.