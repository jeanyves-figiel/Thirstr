// On-device chat translation (F-07 R-07.25–R-07.31, #106). Text is detected and translated on the
// phone (modules/thirstr-translate: Apple Translation + NaturalLanguage on iOS, ML Kit on Android). Nothing here
// talks to our server or any translation service; results are cached in the encrypted store.
import { getLocales } from 'expo-localization';
import { native } from '../../modules/thirstr-translate';
import { LANGUAGE_NAMES } from '../i18n/options';
import { prefs, TranslateMode } from '../me/prefs';
import { kv } from './kv';
import { trKey } from './store';

export type Tr = { from: string; to: string; text: string };
/** What a bubble shows: nothing, a translation, or a chip offering one (`download` = pack missing). */
export type TrState = { kind: 'none' } | { kind: 'done'; tr: Tr } | { kind: 'offer'; from: string; download: boolean };

const NONE: TrState = { kind: 'none' };
const MIN_LETTERS = 8;
const MIN_CONFIDENCE = 0.6;
const TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;

/** Translation works on this device (iOS 18+, or Android with the ML Kit module). */
export const translateAvailable = (): boolean => {
  try {
    return !!native?.supported();
  } catch {
    return false;
  }
};

const base = (l: string) => l.split(/[-_]/)[0].toLowerCase();

/** R-07.26: the phone's first preferred language, not only the app's en/fr/de. */
export const targetLang = (): string => base(getLocales()[0]?.languageCode ?? 'en');

export const langName = (l: string): string => LANGUAGE_NAMES[base(l)] ?? base(l).toUpperCase();

/** R-07.26: long enough to detect reliably (letters only; emoji, digits and links don't count). */
export function worthTranslating(text: string): boolean {
  const plain = text.replace(/https?:\/\/\S+/g, '');
  return (plain.match(/\p{L}/gu)?.length ?? 0) >= MIN_LETTERS;
}

/** Mode for one chat: global setting, then the per-chat switch. */
export function modeFor(conv: { translate?: 'off' }): TranslateMode {
  if (conv.translate === 'off') return 'off';
  return prefs().translate ?? 'auto';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// In-memory results per message (null = nothing to translate), backed by the encrypted store.
const mem = new Map<string, Tr | null>();
const memKey = (cid: string, id: string) => cid + '\u0001' + id;

export async function detect(text: string): Promise<string | null> {
  if (!native) return null;
  try {
    const r = await native.detect(text);
    return r.lang && (r.p ?? 0) >= MIN_CONFIDENCE ? r.lang : null;
  } catch {
    return null;
  }
}

async function cached(cid: string, id: string, to: string): Promise<Tr | null | undefined> {
  const k = memKey(cid, id);
  if (mem.has(k)) return mem.get(k);
  const v = await kv.get<Tr>(trKey(cid, id)).catch(() => null);
  if (v && v.to === to) {
    mem.set(k, v);
    return v;
  }
  return undefined;
}

/** Translates one message now (may show the system language-pack sheet) and caches it. */
export async function translateMessage(cid: string, id: string, text: string, from: string, download = false): Promise<Tr | null> {
  if (!native) return null;
  const to = targetLang();
  const [out] = await withTimeout(native.translate([text], from, to), download ? DOWNLOAD_TIMEOUT_MS : TIMEOUT_MS);
  if (!out || out.trim() === text.trim()) {
    mem.set(memKey(cid, id), null);
    return null;
  }
  const tr: Tr = { from: base(from), to, text: out };
  mem.set(memKey(cid, id), tr);
  await kv.set(trKey(cid, id), tr).catch(() => {});
  return tr;
}

/**
 * What to show under an incoming message (R-07.26–R-07.29). Automatic mode translates at once
 * only when the language pack is already on the phone; it never downloads silently.
 */
export async function plan(cid: string, id: string, text: string, mode: TranslateMode): Promise<TrState> {
  if (mode === 'off' || !translateAvailable() || !worthTranslating(text)) return NONE;
  const to = targetLang();
  const hit = await cached(cid, id, to);
  if (hit) return { kind: 'done', tr: hit };
  if (hit === null) return NONE;
  const from = await detect(text);
  if (!from || base(from) === to) {
    mem.set(memKey(cid, id), null);
    return NONE;
  }
  let status: 'installed' | 'supported' | 'unsupported';
  try {
    status = await native!.status(from, to);
  } catch {
    return NONE;
  }
  if (status === 'unsupported') return NONE;
  if (status === 'installed' && mode === 'auto') {
    try {
      const tr = await translateMessage(cid, id, text, from);
      return tr ? { kind: 'done', tr } : NONE;
    } catch {
      return { kind: 'offer', from, download: false };
    }
  }
  return { kind: 'offer', from, download: status === 'supported' };
}

/** Test hook. */
export const _reset = () => mem.clear();
