import { Platform } from 'react-native';

/**
 * KeyboardAvoidingView behavior. iOS always pads. Android 15+ (API 35) draws edge to edge and no longer
 * resizes the window for the keyboard, so we pad there too; older Android still resizes (adjustResize),
 * and padding on top of that would push the content off screen.
 */
export const kavBehavior: 'padding' | undefined =
  Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 35) ? 'padding' : undefined;
