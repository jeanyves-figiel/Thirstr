import React from 'react';
import { Image, Text, View } from 'react-native';
import { tr } from '../i18n/travel';
import { color, radius, type } from '../theme/tokens';
import { Plane } from './travel';

// F-20 R-20.11: sky "N visiting" bubble (stack of up to 3 faces, 22 pt) at the trip city centre.
export function VisitingBubble({ count, faces }: { count: number; faces: (string | null)[] }) {
  return (
    <View
      pointerEvents="none"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingLeft: 5,
        paddingRight: 10,
        paddingVertical: 5,
        borderRadius: radius.pill,
        backgroundColor: color.travel,
        shadowColor: color.travel,
        shadowOpacity: 0.6,
        shadowRadius: 9,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
      }}
    >
      {faces.length ? (
        <View style={{ flexDirection: 'row' }}>
          {faces.map((f, i) => (
            <View key={i} style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: color.travel, marginLeft: i ? -7 : 0, backgroundColor: color.bgOverlay, overflow: 'hidden' }}>
              {f ? <Image source={{ uri: f }} style={{ width: '100%', height: '100%' }} /> : null}
            </View>
          ))}
        </View>
      ) : (
        <Plane size={14} />
      )}
      <Text style={{ ...type.caption, fontSize: 12, color: color.onAccent }}>{tr.visitingBubble(count)}</Text>
    </View>
  );
}
