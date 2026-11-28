import { getLocales } from 'expo-localization';
import { native, type Engine } from '../../modules/thirstr-ask';
import type { Mode } from '../api/types';
import { parseAsk, sanitize, type AskResult } from './ask';

// F-24 R-24.3 (#346): engines in order, first available wins: (1) Apple Foundation Models,
// (2) Gemini Nano, (3) the phrase grammar. All on the phone. The grammar always runs first:
// its refusals win (a refused ask never reaches a model), and every model answer goes through
// `sanitize` so nothing outside the Filters schema can come out (AC-24.2).

const TIMEOUT = 2500;
const LISTS = ['position', 'hosting', 'tribes', 'build', 'looking_for', 'sports', 'schedule', 'interests'] as const;

let engineP: Promise<Engine | null> | null = null;
/** The on-device model, checked once per launch (cheap; never downloads). */
export function engine(): Promise<Engine | null> {
  if (!native) return Promise.resolve(null);
  engineP ??= native.engine().catch(() => null);
  return engineP;
}

export function instructions(known?: Record<string, string[]>): string {
  const lines = LISTS.map((k) => `${k}: ${(known?.[k] ?? []).join(', ')}`);
  return [
    'You turn a search on a dating app into filters. Use only the allowed values below, exactly as written.',
    'Leave a field empty when the search does not say it. Never guess. Never invent values.',
    'Never output health, HIV, ethnicity, race, language or body-shaming filters.',
    'intents: hookup, friends, sport.',
    'JSON keys: filters {age_min, age_max, distance_max (metres), online_now, verified_only, new_members, ' + LISTS.join(', ') + '}, intents.',
    ...lines,
  ].join('\n');
}

/** Pulls the first JSON object out of a model answer (Nano may wrap it in a code fence). */
export function readJson(s: string): Partial<AskResult> | null {
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(s.slice(a, b + 1)) as { filters?: Record<string, unknown>; intents?: unknown };
    if (!v || typeof v !== 'object') return null;
    const intents = Array.isArray(v.intents) ? (v.intents.filter((x) => typeof x === 'string') as Mode[]) : null;
    return { filters: (v.filters ?? {}) as AskResult['filters'], intents };
  } catch {
    return null;
  }
}

/** Grammar result first; model fills what the grammar missed; grammar values win on conflict. */
export function merge(g: AskResult, m: Partial<AskResult> | null, known?: Record<string, string[]>): AskResult {
  if (!m) return g;
  const s = sanitize({ filters: m.filters ?? {}, intents: m.intents ?? null, refused: [], ignored: [] }, known);
  const f: Record<string, unknown> = { ...s.filters };
  for (const [k, v] of Object.entries(g.filters)) {
    const mv = f[k];
    f[k] = Array.isArray(v) && Array.isArray(mv) ? [...new Set([...v, ...mv])] : v;
  }
  const intents = [...new Set([...(g.intents ?? []), ...(s.intents ?? [])])];
  const added = Object.keys(s.filters).some((k) => !(k in g.filters)) || intents.length > (g.intents?.length ?? 0);
  return sanitize({ filters: f as AskResult['filters'], intents: intents.length ? intents : null, refused: [...new Set([...g.refused, ...s.refused])], ignored: added ? [] : g.ignored }, known);
}

/** R-24.2: parse an ask with the best engine on this phone. */
export async function askSmart(text: string, known?: Record<string, string[]>): Promise<AskResult> {
  const g = parseAsk(text, known);
  if (g.refused.length || !native) return g;
  const e = await engine();
  if (!e) return g;
  try {
    const out = await Promise.race([native.parse(text, instructions(known)), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT))]);
    return merge(g, readJson(out), known);
  } catch {
    return g;
  }
}

/** Language tag for dictation (en/fr/de, else the phone's own). */
export function speechLang(): string {
  const l = getLocales()[0];
  return l?.languageTag ?? 'en-US';
}

export const speech = {
  supported: () => !!native && (() => { try { return native.speechSupported(speechLang()); } catch { return false; } })(),
  listen: () => (native ? native.listen(speechLang()).catch(() => false) : Promise.resolve(false)),
  stop: () => native?.stop(),
  on: (cb: (text: string, final: boolean) => void, end: (error?: string) => void) => {
    if (!native) return () => {};
    const a = native.addListener('onSpeech', (e) => cb(e.text, e.final));
    const b = native.addListener('onSpeechEnd', (e) => end(e.error));
    return () => {
      a.remove();
      b.remove();
    };
  },
};
