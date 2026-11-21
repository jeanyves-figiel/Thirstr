import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { Card, Place } from '../api/types';
import { distanceLabel, tx } from '../i18n/app';
import { pl } from '../i18n/places';
import { tr } from '../i18n/travel';
import { color } from '../theme/tokens';
import { cellLabels, initial, MapProps, pinLabel, ringSegments, START_ZOOM, STYLE_URL } from './mapShared';
import { partyTag } from './Places';

const ICON: Record<string, string> = {
  party: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
  gym: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
  sauna: '<path d="M8 3c-1.5 2 1.5 3 0 5M12 3c-1.5 2 1.5 3 0 5M16 3c-1.5 2 1.5 3 0 5"/><path d="M4 13h16v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/>',
  club: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
};
const esc = (t: string) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// R-04.20 square place marker (DOM).
function placeEl(p: Place, on: boolean): HTMLElement {
  const key = p.type !== 'venue' ? 'party' : p.kind === 'gym' ? 'gym' : p.kind === 'sauna' ? 'sauna' : 'club';
  const bg = p.type !== 'venue' ? color.personal : color.bgInverse;
  const el = document.createElement('button');
  el.setAttribute('aria-label', `${pl.kind[p.kind] ?? p.kind}: ${p.name}`);
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:0;padding:0;cursor:pointer';
  const tag = partyTag(p);
  el.innerHTML =
    `<span style="width:34px;height:34px;border-radius:11px;background:${bg};display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 ${on ? 3 : 0}px rgba(255,255,255,.45),0 3px 8px rgba(0,0,0,.45)">` +
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color.onAccent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON[key]}</svg></span>` +
    (tag ? `<span style="font:800 10px sans-serif;padding:2px 7px;border-radius:999px;background:${color.bgBase};color:${color.personal};white-space:nowrap">${esc(tag)}</span>` : '');
  return el;
}

// R-04.19 ring pin (DOM): segments as SVG circles, face inside.
function ringEl(c: Card, on: boolean): HTMLElement {
  const box = on ? 60 : 52;
  const face = on ? 40 : 36;
  const segs = ringSegments(c.intents ?? ['hookup'], 23)
    .map((sg) => `<circle cx="26" cy="26" r="23" fill="none" stroke="${sg.color}" stroke-width="4.5" stroke-dasharray="${sg.dash}" stroke-dashoffset="${sg.offset}"/>`)
    .join('');
  const el = document.createElement('button');
  el.setAttribute('aria-label', pinLabel(c, tx.modes, pl.and, distanceLabel(c.distance), pl.lookingFor));
  el.setAttribute('aria-pressed', String(on));
  el.style.cssText = `position:relative;width:${box}px;height:${box}px;padding:0;border:0;background:none;cursor:pointer;border-radius:50%;${c.exact ? `box-shadow:0 0 0 3px ${color.trust}` : ''}`;
  const faceStyle = `position:absolute;left:${(box - face) / 2}px;top:${(box - face) / 2}px;width:${face}px;height:${face}px;border-radius:50%;background:${color.bgOverlay} center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:${color.fgPrimary};font:800 16px sans-serif`;
  el.innerHTML =
    `<svg width="${box}" height="${box}" viewBox="0 0 52 52" style="position:absolute;left:0;top:0;transform:rotate(-90deg)"><circle cx="26" cy="26" r="23" fill="${color.bgBase}"/>${segs}</svg>` +
    `<span style="${faceStyle}">${c.photo ? '' : esc(initial(c.display_name))}</span>` +
    (c.now ? `<span style="position:absolute;right:1px;top:1px;width:14px;height:14px;box-sizing:border-box;border-radius:7px;background:#fff;border:3px solid ${color.bgMap}"></span>` : '');
  if (c.photo) (el.children[1] as HTMLElement).style.backgroundImage = `url("${c.photo}")`;
  return el;
}

// Worker copied by scripts/copy-maplibre-worker.js (Metro has no import.meta.url).
maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

// S-10 map on the web build (DEV tool). Same data, maplibre-gl.
export function ExploreMap({ center, me, data, accent, recenter, onRegion, onSelect, onHold, onClear, selected, places, onPlace, selectedPlace, visiting, onVisiting }: MapProps) {
  const clear = useRef(onClear);
  useEffect(() => {
    clear.current = onClear;
  }, [onClear]);
  const centred = useRef(!!center);
  const touched = useRef(false);
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!host.current || map.current) return;
    const m = new maplibregl.Map({
      container: host.current,
      style: STYLE_URL,
      center: center ? [center.lng, center.lat] : [8.54, 47.37],
      zoom: center ? (center.zoom ?? START_ZOOM) : 2,
      attributionControl: false,
      pitchWithRotate: false,
    });
    const emit = () => {
      const b = m.getBounds();
      onRegion([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    m.on('moveend', emit);
    m.on('click', () => clear.current?.());
    m.on('dragstart', () => (touched.current = true));
    m.on('zoomstart', (e) => e.originalEvent && (touched.current = true));
    m.on('load', () => {
      emit();
    });
    map.current = m;
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    const add = (lng: number, lat: number, el: HTMLElement) => markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(m));
    if (me) {
      const el = document.createElement('div');
      el.style.cssText = `width:24px;height:24px;border-radius:12px;background:${color.bgInverse};border:6px solid ${accent};box-sizing:border-box`;
      add(me.lng, me.lat, el);
    }
    const people = [...(data?.avatars ?? []), ...(data?.pins ?? [])];
    if (people.length === 0)
      for (const c of cellLabels(data)) {
        const el = document.createElement('div');
        el.textContent = c.label;
        el.style.cssText = `min-width:34px;height:26px;padding:0 8px;box-sizing:border-box;border-radius:13px;background:${color.bgInverse};color:${color.onAccent};font:700 12px/26px sans-serif;text-align:center;pointer-events:none`;
        add(c.lng, c.lat, el);
      }
    for (const p of places ?? []) {
      const el = placeEl(p, selectedPlace === p.id);
      el.onclick = (e) => {
        e.stopPropagation();
        onPlace?.(p);
      };
      add(p.lng, p.lat, el);
    }
    // F-20 R-20.11: one sky "N visiting" bubble at the city centre, never pins.
    if (visiting) {
      const el = document.createElement('button');
      el.setAttribute('aria-label', tr.visitingBubble(visiting.count));
      el.setAttribute('data-testid', 'visiting-bubble');
      el.style.cssText = `display:flex;align-items:center;gap:5px;padding:5px 10px 5px 5px;border:0;border-radius:999px;background:${color.travel};color:${color.onAccent};font:800 12px sans-serif;cursor:pointer;box-shadow:0 6px 18px -6px ${color.travel}`;
      const faces = visiting.faces
        .map((f, i) => `<span style="width:22px;height:22px;border-radius:11px;border:2px solid ${color.travel};margin-left:${i ? -7 : 0}px;background:${color.bgOverlay} ${f ? `url(&quot;${esc(f)}&quot;) center/cover` : ''}"></span>`)
        .join('');
      el.innerHTML = `${faces ? `<span style="display:flex">${faces}</span>` : `<svg width="14" height="14" viewBox="0 0 24 24"><path fill="${color.onAccent}" d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V8.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z"/></svg>`}<span>${esc(tr.visitingBubble(visiting.count))}</span>`;
      el.onclick = (e) => {
        e.stopPropagation();
        onVisiting?.();
      };
      add(visiting.lng, visiting.lat, el);
    }
    for (const c of people) {
      if (c.lat === undefined || c.lng === undefined) continue;
      const on = selected === c.id;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center';
      const el = ringEl(c, on);
      el.onclick = (e) => {
        e.stopPropagation();
        onSelect(c);
      };
      el.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onHold?.(c);
      };
      wrap.appendChild(el);
      if (on) {
        const chip = document.createElement('div');
        chip.textContent = `${c.display_name}, ${c.age} · ${distanceLabel(c.distance)}`;
        chip.style.cssText = `margin-top:6px;padding:5px 10px;border-radius:999px;background:${color.bgInverse};color:${color.onAccent};font:800 13px sans-serif;white-space:nowrap`;
        wrap.appendChild(chip);
      }
      add(c.lng, c.lat, wrap);
    }
  }, [data, me, accent, onSelect, onHold, selected, places, onPlace, selectedPlace, visiting, onVisiting]);

  // R-04.13: centre once when the first position arrives (unless the user moved), and on Locate me.
  useEffect(() => {
    if (!center || !map.current || centred.current || touched.current) return;
    centred.current = true;
    map.current.jumpTo({ center: [center.lng, center.lat], zoom: center.zoom ?? START_ZOOM });
  }, [center?.lat, center?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!recenter || !center || !map.current) return;
    centred.current = true;
    map.current.easeTo({ center: [center.lng, center.lat], zoom: center.zoom ?? START_ZOOM, duration: 600 });
  }, [recenter]); // eslint-disable-line react-hooks/exhaustive-deps

  return <View style={{ flex: 1 }}>{React.createElement('div', { ref: host, style: { position: 'absolute', inset: 0 } })}</View>;
}
