import { requireOptionalNativeModule } from 'expo';

/**
 * F-24 Ask engines 1–2 and dictation (#346, R-24.1, R-24.3). Everything runs on the phone:
 * iOS 26+ Apple Foundation Models (guided generation), Android ML Kit GenAI Prompt API (Gemini
 * Nano, AICore). Dictation: iOS SFSpeechRecognizer with requiresOnDeviceRecognition, Android
 * on-device SpeechRecognizer (API 31+). No text or audio leaves the device; when on-device is not
 * possible the feature reports unsupported instead of falling back to a server.
 */
export type Engine = 'apple' | 'nano';

export type SpeechEvent = { text: string; final: boolean };
export type SpeechEnd = { error?: string };

type Sub = { remove(): void };

type Native = {
  /** The on-device model ready to use now, else null (never starts a download). */
  engine(): Promise<Engine | null>;
  /** JSON object text (schema in the instructions). Rejects on any error. */
  parse(text: string, instructions: string): Promise<string>;
  speechSupported(lang: string): boolean;
  /** Asks for mic + speech permission when needed; resolves false if refused. */
  listen(lang: string): Promise<boolean>;
  stop(): void;
  addListener(name: 'onSpeech', cb: (e: SpeechEvent) => void): Sub;
  addListener(name: 'onSpeechEnd', cb: (e: SpeechEnd) => void): Sub;
};

export const native = requireOptionalNativeModule<Native>('ThirstrAsk');
