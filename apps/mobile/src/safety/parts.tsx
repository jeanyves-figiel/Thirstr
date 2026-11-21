import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { color, radius, space, type } from '../theme/tokens';

/** 6-digit PIN pad (S-55). Calls onDone with the full PIN, then clears. */
export function PinPad({ title, error, onDone, extra }: { title: string; error?: string | null; onDone: (pin: string) => void; extra?: React.ReactNode }) {
  const [pin, setPin] = useState('');
  const press = (d: string) => {
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length === 6) {
      setTimeout(() => setPin(''), 150);
      onDone(next);
    }
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  return (
    <View style={{ alignItems: 'center', gap: space.l }}>
      <Text style={{ ...type.title, color: color.fgPrimary, textAlign: 'center' }}>{title}</Text>
      <View style={{ flexDirection: 'row', gap: space.m }} accessibilityLabel={`${pin.length} of 6`}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View key={i} style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: color.trust, backgroundColor: i < pin.length ? color.trust : 'transparent' }} />
        ))}
      </View>
      <Text style={{ ...type.meta, color: color.danger, minHeight: 18 }}>{error ?? ''}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: 264, gap: 12, justifyContent: 'center' }}>
        {keys.map((k, i) =>
          k === '' ? (
            <View key={i} style={{ width: 80, height: 64 }} />
          ) : (
            <Pressable
              key={i}
              testID={`pin-${k === '⌫' ? 'del' : k}`}
              accessibilityRole="button"
              accessibilityLabel={k === '⌫' ? 'Delete' : k}
              onPress={() => (k === '⌫' ? setPin(pin.slice(0, -1)) : press(k))}
              style={({ pressed }) => ({ width: 80, height: 64, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? color.bgOverlay : color.bgRaised })}
            >
              <Text style={{ ...type.title, color: color.fgPrimary }}>{k}</Text>
            </Pressable>
          ),
        )}
      </View>
      {extra}
    </View>
  );
}

/** Press-and-hold action (SOS 2 s, wipe 3 s): a fill grows while held; release early cancels. */
export function HoldButton({ label, ms, onDone, testID, tone = color.danger, badge, sub }: { label: string; ms: number; onDone: () => void; testID?: string; tone?: string; badge?: string; sub?: string }) {
  const [p] = useState(() => new Animated.Value(0));
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => () => anim.current?.stop(), []);
  const start = () => {
    anim.current = Animated.timing(p, { toValue: 1, duration: ms, useNativeDriver: false });
    anim.current.start(({ finished }) => {
      if (finished) {
        p.setValue(0);
        onDone();
      }
    });
  };
  const stop = () => {
    anim.current?.stop();
    Animated.timing(p, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  };
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={`Hold for ${ms / 1000} seconds`}
      onPressIn={start}
      onPressOut={stop}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ minHeight: badge ? 76 : 64, borderRadius: badge ? 26 : radius.pill, borderWidth: 2, borderColor: tone, overflow: 'hidden', justifyContent: 'center' }}
    >
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: p.interpolate({ inputRange: [0, 1], outputRange: [0, w] }), backgroundColor: tone }} />
      {badge ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tone, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ ...type.caption, fontSize: 14, color: color.onAccent }}>{badge}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.headline, fontSize: 17, color: color.fgPrimary }}>{label}</Text>
            {sub ? <Text style={{ ...type.meta, color: color.fgSecondary }}>{sub}</Text> : null}
          </View>
        </View>
      ) : (
        <Text style={{ ...type.headline, color: color.fgPrimary, textAlign: 'center' }}>{label}</Text>
      )}
    </Pressable>
  );
}
