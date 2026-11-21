// F-19 (#187): native gesture + animation modules in tests (no UI thread in Jest).
// Reanimated 4's own mock boots its native initializer under jest-expo and throws, so a small stand-in is used.
/* global jest */
/* eslint-disable react/display-name */
require('react-native-gesture-handler/jestSetup');
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn, ...args) => fn(...args),
  scheduleOnUI: (fn, ...args) => fn(...args),
  runOnJS: (fn) => fn,
  runOnUI: (fn) => fn,
}));
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const React = require('react');
  const id = (v) => v;
  const animated = (C) => React.forwardRef((p, ref) => React.createElement(C, { ...p, ref, style: [].concat(p.style ?? []).map((s) => (typeof s === 'function' ? s() : s)) }));
  const Animated = { View: animated(RN.View), Text: animated(RN.Text), Image: animated(RN.Image), ScrollView: animated(RN.ScrollView), FlatList: RN.FlatList, createAnimatedComponent: animated };
  return {
    __esModule: true,
    default: Animated,
    ...Animated,
    useSharedValue: (v) =>
      React.useRef({
        value: v,
        get() {
          return this.value;
        },
        set(n) {
          this.value = n;
        },
      }).current,
    useAnimatedStyle: (fn) => fn(),
    useDerivedValue: (fn) => ({ value: fn() }),
    useAnimatedReaction: () => {},
    useReducedMotion: () => false,
    withSpring: id,
    withTiming: id,
    withDelay: (_d, v) => v,
    withSequence: (...v) => v[v.length - 1],
    withRepeat: id,
    Easing: { linear: id, quad: id, out: id, in: id, inOut: id },
    cancelAnimation: () => {},
    interpolate: (v, i, o) => o[0] + ((v - i[0]) / (i[1] - i[0] || 1)) * (o[1] - o[0]),
    Extrapolation: { CLAMP: 'clamp' },
    FadeIn: { duration: () => ({}) },
    FadeOut: { duration: () => ({}) },
  };
});
// #177 Data saver: NetInfo has no native module in Jest.
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// #221: Skia (Moment Blur tool) has no native side in Jest; the pure blur logic is tested on its own.
jest.mock('@shopify/react-native-skia', () => ({
  Blur: () => null,
  Canvas: () => null,
  Group: () => null,
  Image: () => null,
  ClipOp: { Intersect: 1 },
  ImageFormat: { JPEG: 3 },
  TileMode: { Clamp: 0 },
  Skia: {},
  useImage: () => null,
}));
