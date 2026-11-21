import { requireOptionalNativeModule } from 'expo';

/** F-13 R-13.20 (#119): check-in Live Activity (iOS 16.2+) and app-icon quick actions. iOS only; null elsewhere. */
export type LivePayload = {
  started: number;
  due: number;
  title: string;
  sub: string;
  lateTitle: string;
  lateSub: string;
  ok: string;
  more: string;
  sos: string;
  late: string;
  canExtend: boolean;
};

export type QuickAction = 'start' | 'ok' | 'more' | 'sos';
export type Shortcut = { type: QuickAction; title: string; subtitle?: string; symbol: string };

type Native = {
  liveSupported(): boolean;
  liveRunning(): boolean;
  liveSync(p: LivePayload): Promise<boolean>;
  liveEnd(): Promise<void>;
  setShortcuts(items: Shortcut[]): void;
  takeShortcut(): QuickAction | null;
  addListener(event: 'onShortcut', cb: (e: { type: QuickAction }) => void): { remove: () => void };
};

export const native = requireOptionalNativeModule<Native>('ThirstrSafety');
