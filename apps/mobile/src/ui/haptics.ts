// F-19 R-19.8 (#187): the app's only haptics. Four feelings, used the same way on every screen.
// Off when Settings › Haptics is off and on web. Never per frame or on scroll.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { prefs } from '../me/prefs';

export type Feel = 'tick' | 'tap' | 'success' | 'warning';

export function feel(f: Feel) {
  if (Platform.OS === 'web' || !prefs().haptics) return;
  const p =
    f === 'tick'
      ? Haptics.selectionAsync()
      : f === 'tap'
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : Haptics.notificationAsync(f === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  p.catch(() => {});
}
