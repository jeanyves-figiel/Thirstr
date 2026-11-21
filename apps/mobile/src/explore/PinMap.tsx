import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
import React from 'react';
import { View } from 'react-native';
import { color } from '../theme/tokens';
import { STYLE_URL } from './mapShared';

// #191 Add a place header: a still map centred on the member's exact fix, with an accuracy halo.
export function PinMap({ lat, lng, accuracy }: { lat: number; lng: number; accuracy: number }) {
  const halo = Math.max(28, Math.min(120, accuracy * 2));
  return (
    <Map style={{ flex: 1 }} mapStyle={STYLE_URL} attribution={false} logo={false} compass={false} dragPan={false} touchZoom={false} doubleTapZoom={false} touchRotate={false} touchPitch={false}>
      <Camera initialViewState={{ center: [lng, lat], zoom: 17 }} />
      <Marker lngLat={[lng, lat]} anchor="center">
        <View
          pointerEvents="none"
          style={{
            width: halo,
            height: halo,
            borderRadius: halo / 2,
            backgroundColor: `${color.hookup}24`,
            borderWidth: 1.5,
            borderColor: `${color.hookup}80`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: color.hookup,
              borderWidth: 3,
              borderColor: color.fgPrimary,
            }}
          />
        </View>
      </Marker>
    </Map>
  );
}
