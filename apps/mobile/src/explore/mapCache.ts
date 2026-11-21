// SR-16 (#156): MapLibre's ambient tile cache is plain files outside our encrypted store. Tiles
// are public, but the cached area hints where you were: cap it, clear it on sign-out / wipe
// and when Safe Mode turns on. No tiles are prefetched.
import { OfflineManager } from '@maplibre/maplibre-react-native';

export const MAP_CACHE_BYTES = 100 * 1024 * 1024;

export async function capMapCache() {
  await OfflineManager.setMaximumAmbientCacheSize(MAP_CACHE_BYTES).catch(() => {});
}

export async function clearMapCache() {
  await OfflineManager.clearAmbientCache().catch(() => {});
}
