// R-07.5: up to 3 custom quick replies (Settings › Chat), kept on the device.
import { kv } from './kv';

export const customQuickReplies = async () => (await kv.get<string[]>('quick:custom')) ?? [];
export const setCustomQuickReplies = (list: string[]) =>
  kv.set(
    'quick:custom',
    list
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((s) => s.slice(0, 40)),
  );
