// F-19 G13 (#187): full-screen photo viewer. Pinch or double-tap to zoom, swipe sideways for the next photo,
// swipe down to close. Only three photos are mounted at a time; zoom uses the image already in memory.
// View-once photos: `single` (no paging), nothing to save.
import React, { useCallback, useEffect, useState } from 'react';
import { Dimensions, Image, Modal, Pressable, Text, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView, useExclusiveGestures, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { gx } from '../i18n/gestures';
import { tx } from '../i18n/app';
import { color, radius, space, type } from '../theme/tokens';
import { clamp, commits, rubber, TAP_SLOP } from './gestureMath';
import { feel } from './haptics';
import { Icon } from './icons';
import { settle } from './motion';

export const MAX_ZOOM = 4;
export const TAP_ZOOM = 2.5;

/** Pan limit at a zoom level: the image may move until its edge reaches the screen edge. */
export function panLimit(size: number, scale: number): number {
  'worklet';
  return Math.max(0, (size * scale - size) / 2);
}

type Src = string | (() => Promise<string>);

type Props<T> = {
  items: T[] | null;
  index: number;
  src: (item: T) => Src;
  onClose: () => void;
  single?: boolean;
  /** Extra control at the bottom (album: Remove). */
  footer?: (item: T) => React.ReactNode;
};

export function PhotoViewer<T>({ items, index, src, onClose, single, footer }: Props<T>) {
  const open = !!items && items.length > 0;
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>{open ? <Stage items={items} start={index} src={src} onClose={onClose} single={single} footer={footer} /> : null}</GestureHandlerRootView>
    </Modal>
  );
}

function Stage<T>({ items, start, src, onClose, single, footer }: { items: T[]; start: number; src: (item: T) => Src; onClose: () => void; single?: boolean; footer?: (item: T) => React.ReactNode }) {
  const { width: W, height: H } = Dimensions.get('window');
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const n = single ? 1 : items.length;
  const [i, setI] = useState(Math.min(Math.max(0, start), items.length - 1));
  // One source per photo for the life of the viewer, so a decrypt never runs twice.
  const [srcs] = useState(() => items.map(src));

  const scale = useSharedValue(1);
  const base = useSharedValue(1);
  const tx_ = useSharedValue(0);
  const ty = useSharedValue(0);
  const page = useSharedValue(0);
  const down = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const axis = useSharedValue(0); // 0 none, 1 page, 2 close, 3 move
  // Current photo for the worklets (a captured `i` could be stale on the UI thread).
  const at = useSharedValue(i);

  const go = useCallback(
    (d: number) => {
      feel('tick');
      setI((k) => k + d);
    },
    [],
  );
  useEffect(() => {
    // New photo: reset zoom and offsets after React has swapped the images.
    scale.set(1);
    base.set(1);
    tx_.set(0);
    ty.set(0);
    page.set(0);
    at.set(i);
  }, [i, scale, base, tx_, ty, page, at]);

  const pinch = usePinchGesture({
    onBegin: () => {
      'worklet';
      base.set(scale.get());
    },
    onUpdate: (e) => {
      'worklet';
      const s = base.get() * e.scale;
      scale.set(s < 1 ? 1 - rubber(1 - s, 1) : s > MAX_ZOOM ? MAX_ZOOM + rubber(s - MAX_ZOOM, 1) : s);
    },
    onDeactivate: () => {
      'worklet';
      const s = clamp(scale.get(), 1, MAX_ZOOM);
      scale.set(settle(s, reduce));
      tx_.set(settle(clamp(tx_.get(), -panLimit(W, s), panLimit(W, s)), reduce));
      ty.set(settle(clamp(ty.get(), -panLimit(H, s), panLimit(H, s)), reduce));
    },
  });

  const pan = usePanGesture({
    maxPointers: 1,
    onBegin: () => {
      'worklet';
      startX.set(tx_.get());
      startY.set(ty.get());
      axis.set(0);
    },
    onUpdate: (e) => {
      'worklet';
      const s = scale.get();
      if (axis.get() === 0) axis.set(s > 1.01 ? 3 : Math.abs(e.translationX) > Math.abs(e.translationY) ? 1 : 2);
      const a = axis.get();
      if (a === 3) {
        tx_.set(startX.get() + e.translationX);
        ty.set(startY.get() + e.translationY);
      } else if (a === 1) {
        const t = e.translationX;
        const k = at.get();
        const edge = (t > 0 && k === 0) || (t < 0 && k >= n - 1);
        page.set(edge ? rubber(t, 60) : t);
      } else down.set(Math.max(0, e.translationY));
    },
    onDeactivate: (e) => {
      'worklet';
      const a = axis.get();
      if (a === 3) {
        const s = scale.get();
        tx_.set(settle(clamp(tx_.get(), -panLimit(W, s), panLimit(W, s)), reduce));
        ty.set(settle(clamp(ty.get(), -panLimit(H, s), panLimit(H, s)), reduce));
      } else if (a === 1) {
        const t = page.get();
        const d = commits(t, e.velocityX, W, 0.25) ? (t < 0 ? 1 : -1) : 0;
        const k = at.get();
        if (d !== 0 && k + d >= 0 && k + d < n) {
          page.set(withTiming(-d * W, { duration: 180 }, (done) => {
            if (done) scheduleOnRN(go, d);
          }));
        } else page.set(settle(0, reduce));
      } else if (a === 2) {
        if (commits(down.get(), e.velocityY, 260, 0.38)) {
          down.set(withTiming(H, { duration: 180 }, (done) => {
            if (done) scheduleOnRN(onClose);
          }));
        } else down.set(settle(0, reduce));
      }
    },
  });

  // maxDistance: a finger that moves is a swipe, so the tap fails at once and the pan can take over.
  // Without it the pan waited for the double-tap to fail and swipes between photos never ran.
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    maxDistance: TAP_SLOP,
    maxDelay: 250,
    onActivate: (e) => {
      'worklet';
      if (scale.get() > 1.01) {
        scale.set(settle(1, reduce));
        tx_.set(settle(0, reduce));
        ty.set(settle(0, reduce));
      } else {
        const z = TAP_ZOOM;
        scale.set(settle(z, reduce));
        tx_.set(settle(clamp((W / 2 - e.x) * (z - 1), -panLimit(W, z), panLimit(W, z)), reduce));
        ty.set(settle(clamp((H / 2 - e.y) * (z - 1), -panLimit(H, z), panLimit(H, z)), reduce));
      }
    },
  });
  const both = useSimultaneousGestures(pinch, pan);
  const gesture = useExclusiveGestures(doubleTap, both);

  const imgStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx_.get() }, { translateY: ty.get() }, { scale: scale.get() }] }));
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: page.get() }, { translateY: down.get() }, { scale: 1 - Math.min(0.25, down.get() / H / 2) }] }));
  const bgStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(0.9, down.get() / (H * 0.6)) }));

  const show = single ? [0] : [-1, 0, 1].filter((d) => i + d >= 0 && i + d < n);
  const item = items[i];

  return (
    <View
      style={{ flex: 1 }}
      accessibilityViewIsModal
      onAccessibilityEscape={onClose}
      accessibilityActions={[
        ...(i < n - 1 ? [{ name: 'next', label: gx.nextPhoto }] : []),
        ...(i > 0 ? [{ name: 'prev', label: gx.prevPhoto }] : []),
      ]}
      onAccessibilityAction={(e) => go(e.nativeEvent.actionName === 'next' ? 1 : -1)}
    >
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'black' }, bgStyle]} />
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ flex: 1 }, rowStyle]}>
          {show.map((d) => (
            <View key={i + d} style={{ position: 'absolute', top: 0, bottom: 0, width: W, left: d * W, overflow: 'hidden' }}>
              <Animated.View style={[{ flex: 1 }, d === 0 ? imgStyle : null]}>
                <Pic src={srcs[i + d]} label={gx.photoOf(i + d + 1, n)} />
              </Animated.View>
            </View>
          ))}
        </Animated.View>
      </GestureDetector>
      <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + space.s, left: space.l, right: space.l, flexDirection: 'row', alignItems: 'center' }}>
        {n > 1 ? <Text style={{ ...type.meta, color: color.fgPrimary }}>{`${i + 1} / ${n}`}</Text> : null}
        <Pressable testID="viewer-close" accessibilityRole="button" accessibilityLabel={tx.common.close} onPress={onClose} hitSlop={8} style={{ marginLeft: 'auto', width: 44, height: 44, borderRadius: 22, backgroundColor: color.bgInverse, alignItems: 'center', justifyContent: 'center' }}>
          <Icon.Close c={color.onAccent} />
        </Pressable>
      </View>
      {n > 1 ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: space.l, right: space.l, bottom: insets.bottom + space.xl, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Arrow label={gx.prevPhoto} d="M15 18l-6-6 6-6" off={i === 0} on={() => go(-1)} />
          <Arrow label={gx.nextPhoto} d="M9 6l6 6-6 6" off={i >= n - 1} on={() => go(1)} />
        </View>
      ) : null}
      {footer ? <View style={{ position: 'absolute', alignSelf: 'center', bottom: insets.bottom + space.huge + 44 }}>{footer(item)}</View> : null}
    </View>
  );
}

function Arrow({ label, d, off, on }: { label: string; d: string; off: boolean; on: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: off }} onPress={off ? undefined : on} style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: color.scrim, alignItems: 'center', justifyContent: 'center', opacity: off ? 0.3 : 1 }}>
      <Icon.Chevron d={d} />
    </Pressable>
  );
}

function Pic({ src, label }: { src: Src; label: string }) {
  const [uri, setUri] = useState<string | null>(typeof src === 'string' ? src : null);
  useEffect(() => {
    if (typeof src === 'string') return;
    let live = true;
    src().then((u) => live && setUri(u), () => {});
    return () => {
      live = false;
    };
  }, [src]);
  return uri ? <Image source={{ uri }} style={{ flex: 1 }} resizeMode="contain" accessibilityLabel={label} /> : null;
}
