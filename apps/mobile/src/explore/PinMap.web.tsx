import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { color } from '../theme/tokens';
import { STYLE_URL } from './mapShared';

// #191 Add a place header (web): still map on the exact fix with an accuracy halo.
export function PinMap({ lat, lng, accuracy }: { lat: number; lng: number; accuracy: number }) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const map = new maplibregl.Map({
      container: el,
      style: STYLE_URL,
      center: [lng, lat],
      zoom: 17,
      interactive: false,
      attributionControl: false,
    });
    const halo = Math.max(28, Math.min(120, accuracy * 2));
    const dot = document.createElement('div');
    dot.style.cssText = `width:${halo}px;height:${halo}px;border-radius:50%;background:${color.hookup}24;border:1.5px solid ${color.hookup}80;display:flex;align-items:center;justify-content:center`;
    dot.innerHTML = `<span style="width:14px;height:14px;border-radius:50%;background:${color.hookup};border:3px solid ${color.fgPrimary};box-sizing:border-box"></span>`;
    new maplibregl.Marker({ element: dot }).setLngLat([lng, lat]).addTo(map);
    return () => map.remove();
  }, [lat, lng, accuracy]);
  return (
    <View style={{ flex: 1 }}>
      {React.createElement('div', {
        ref: box,
        style: { position: 'absolute', inset: 0 },
      })}
    </View>
  );
}
