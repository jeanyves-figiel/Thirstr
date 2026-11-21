# DEV map tiles

`docker compose` serves `*.pmtiles` files from this folder at `https://localhost:7443/tiles/` (Protomaps, ADR-0001).
Files are git-ignored. Extract a seed-city area once, e.g.:

```sh
pmtiles extract https://build.protomaps.com/<date>.pmtiles infra/tiles/dev.pmtiles --bbox=2.2,48.8,13.5,52.6 --maxzoom=14
```
