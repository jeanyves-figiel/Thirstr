// SR-14 (#154): AsyncStorage-shaped store backed by the encrypted device store (SQLCipher kv).
// For anything personal: "Only me" profile fields, Safe Mode state, Explore filters.
// Values written by older builds to plain AsyncStorage move over on first read and are deleted.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { kv } from '../chat/kv';

const P = 'as:';

export const privateStore = {
  async getItem(k: string): Promise<string | null> {
    const v = await kv.get<string>(P + k);
    if (v !== null) return v;
    const old = await AsyncStorage.getItem(k).catch(() => null);
    if (old !== null) {
      await kv.set(P + k, old);
      await AsyncStorage.removeItem(k).catch(() => {});
    }
    return old;
  },
  async setItem(k: string, v: string): Promise<void> {
    await kv.set(P + k, v);
    await AsyncStorage.removeItem(k).catch(() => {});
  },
  async removeItem(k: string): Promise<void> {
    await kv.del(P + k);
    await AsyncStorage.removeItem(k).catch(() => {});
  },
};
