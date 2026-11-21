import { requireOptionalNativeModule, requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

/** F-18 R-18.13 (#159): capture-protected clip playback (iOS). Absent on web / Android for now. */
type Native = {
  isCaptured(): Promise<boolean>;
  stripMetadata(uri: string): Promise<string>;
  addListener(event: 'onScreenshot' | 'onCapture', fn: (e: { captured?: boolean }) => void): { remove(): void };
};

export const native = requireOptionalNativeModule<Native>('ThirstrSecureVideo');

export type SecureVideoProps = ViewProps & {
  uri: string | null;
  playing: boolean;
  loop?: boolean;
  onProgress?: (e: { nativeEvent: { t: number; d: number } }) => void;
  onEnd?: () => void;
  onReady?: (e: { nativeEvent: { duration: number } }) => void;
  onError?: (e: { nativeEvent: { message: string } }) => void;
};

export const SecureVideo: ComponentType<SecureVideoProps> | null = native ? requireNativeView<SecureVideoProps>('ThirstrSecureVideo') : null;
