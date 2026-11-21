import { cellToLatLng, latLngToCell } from 'h3-js';

// Client computes H3 cells; the server never receives coordinates for City/Area (F-05).
// Native builds move this into the Rust core (UniFFI); same outputs.
export function areaCell(lat: number, lng: number): string {
  return latLngToCell(lat, lng, 9);
}

/** #197 R-05.13 "Show closer distance": the r10 cell (~65 m edge), still a cell, never coordinates. */
export function preciseCell(lat: number, lng: number): string {
  return latLngToCell(lat, lng, 10);
}

/** Body for PUT /me/location at Area / Exact: r9 always, r10 too when the member chose closer distance. */
export function areaBody(lat: number, lng: number, precise: boolean | undefined) {
  return precise ? { cell_r9: areaCell(lat, lng), cell_r10: preciseCell(lat, lng) } : { cell_r9: areaCell(lat, lng) };
}

export function cellCenter(cell: string): [number, number] {
  return cellToLatLng(cell);
}
