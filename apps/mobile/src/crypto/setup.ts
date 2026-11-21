// Must be imported before anything that touches crypto (index.ts). Hermes has neither
// crypto.getRandomValues nor crypto.subtle; web and Node have both.
import * as ExpoCrypto from 'expo-crypto';
import { installSubtle } from './subtleShim';

const g = globalThis as unknown as { crypto?: { getRandomValues?: unknown } };
if (!g.crypto) (g as { crypto: object }).crypto = {};
if (!g.crypto!.getRandomValues) g.crypto!.getRandomValues = ExpoCrypto.getRandomValues;
installSubtle();
