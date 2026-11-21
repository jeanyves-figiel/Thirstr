// Date safety quick access (#112, F-13 R-13.14–R-13.18). Everything here runs on the device.
import * as E from '../chat/engine';
import { kv } from '../chat/kv';
import * as S from './safety';

// R-13.18: meetup cues, en/fr/de. Kept loose on purpose: a false prompt costs one "Not now".
const CUES: RegExp[] = [
  /\bon my way\b/i,
  /\bomw\b/i,
  /\bsee you (at|there|soon|in)\b/i,
  /\bcome over\b/i,
  /\bbe there in\b/i,
  /\bi'?m outside\b/i,
  /\bi’m outside\b/i,
  /\bat (the|your) door\b/i,
  /\bj['’]arrive\b/i,
  /\ben route\b/i,
  /\bje suis devant\b/i,
  /\bviens chez moi\b/i,
  /\bà tout de suite\b/i,
  /\bbin unterwegs\b/i,
  /\bbin gleich da\b/i,
  /\bkomm vorbei\b/i,
  /\bbis gleich\b/i,
  /\bstehe vor\b/i,
  // street address: "Langstrasse 120", "Rotbuchstr. 8", "12 rue de Rivoli", "5 Baker Street"
  /\p{L}+(strasse|straße|str\.|gasse|weg|platz|allee)\s*\d{1,4}\b/iu,
  /\b(strasse|straße|gasse|weg|platz|allee)\s+\d{1,4}\b/iu,
  /\b\d{1,4}\s*,?\s*(rue|avenue|av\.|boulevard|bd|chemin|place)\s+\p{L}/iu,
  /\b\d{1,4}\s+\p{L}+(\s\p{L}+)?\s+(street|st\.?|road|rd\.?|avenue|ave\.?|lane)\b/iu,
];

export const hasCue = (text: string) => CUES.some((r) => r.test(text));

type Line = { text: string; at: number };
/** Last 6 text messages of the last 3 h, either side (R-13.18). */
export function meetupCue(lines: Line[], now = Date.now()): boolean {
  return lines
    .filter((l) => now - l.at <= 3 * 3600_000)
    .slice(-6)
    .some((l) => hasCue(l.text));
}

export function chatLines(list: E.Msg[]): Line[] {
  return list.filter((m) => m.p.t === 'text').map((m) => ({ text: String((m.p as { text?: string }).text ?? ''), at: m.at }));
}

const K_DISMISS = (cid: string) => `safety:cue:${cid}`;
export const DISMISS_MS = 12 * 3600_000;
export async function cueDismissed(cid: string, now = Date.now()) {
  const t = await kv.get<number>(K_DISMISS(cid));
  return !!t && now - t < DISMISS_MS;
}
export const dismissCue = (cid: string) => kv.set(K_DISMISS(cid), Date.now());

export const hhmm = (d: Date | string | number) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Time left as h:mm (never negative). */
export function leftParts(due: string, now = Date.now()) {
  const ms = Math.max(0, new Date(due).getTime() - now);
  const mins = Math.ceil(ms / 60_000);
  return { h: Math.floor(mins / 60), m: mins % 60, ms };
}

/** "Léa and Sam", "Léa", or the fallback when no contact is named. */
export function whoText(names: string[], and: (a: string, b: string) => string, fallback: string) {
  if (!names.length) return fallback;
  if (names.length === 1) return names[0];
  return and(names.slice(0, -1).join(', '), names[names.length - 1]);
}

/** Start from a chat (S-51 / R-13.18): profile + last 20 messages when asked. */
export async function startForChat(o: { cid?: string; minutes: number; include: boolean; live: boolean; name: string }) {
  const conv = o.cid ? E.getConv(o.cid) : undefined;
  let who: S.Who | undefined;
  let msgs: S.ChatLine[] | undefined;
  if (conv && o.include) {
    who = { name: conv.name, age: conv.age };
    msgs = (await E.messages(conv.id))
      .filter((x) => (x.p as { t: string }).t === 'text')
      .slice(-20)
      .map((x) => ({ me: x.from === 'me', text: String((x.p as { text?: string }).text ?? '').slice(0, 500), at: new Date(x.at).toISOString() }));
  }
  // Chat id and name stay on the phone (labels for the bar and quick sheet); alerts carry them only when included.
  const a = await S.startCheckin({ minutes: o.minutes, name: o.name, who, msgs, live: o.live, cid: conv?.id, peer: conv?.name });
  // A check-in for this chat already happened: don't prompt again for 12 h (R-13.18).
  if (conv) await dismissCue(conv.id).catch(() => {});
  return a;
}
