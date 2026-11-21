// Web build: maplibre-gl locates its worker via import.meta.url, which Metro does not provide.
// Copy the worker next to the app (public/ → served at /maplibre/) and point setWorkerUrl at it.
const fs = require('fs');
const path = require('path');
const src = path.resolve('.', 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl-worker.mjs');
const dir = path.resolve('.', 'public', 'maplibre');
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(src, path.join(dir, 'maplibre-gl-worker.mjs'));
