import { requireOptionalNativeModule } from 'expo';

/** On-device translation (F-07 R-07.25). iOS: Apple Translation (iOS 18+) + NaturalLanguage. Android (#107): ML Kit Translation + Language ID. Text never leaves the phone. */
export type PackStatus = 'installed' | 'supported' | 'unsupported';

type Native = {
  supported(): boolean;
  detect(text: string): Promise<{ lang?: string; p?: number }>;
  status(from: string, to: string): Promise<PackStatus>;
  translate(texts: string[], from: string, to: string): Promise<string[]>;
};

export const native = requireOptionalNativeModule<Native>('ThirstrTranslate');
