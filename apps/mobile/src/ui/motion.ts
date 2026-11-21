// F-19 R-19.5 (#187): one spring for gestures; Reduce Motion turns it into a short timing curve.
import { withSpring, withTiming } from 'react-native-reanimated';

export function settle(to: number, reduce: boolean, velocity = 0) {
  'worklet';
  return reduce ? withTiming(to, { duration: 150 }) : withSpring(to, { damping: 22, stiffness: 220, mass: 1, velocity });
}
