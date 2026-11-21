// R-07.3: first message to a new contact: text only, ≤ 500 chars, no links/handles/phone/email.
import type { Conv, Payload } from './engine';

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|fun|app|me|co|fr|de|ch|uk)\b)/i;
const HANDLE = /(^|\s)@[a-z0-9_.]{2,}/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE = /(\+?\d[\d\s().-]{7,}\d)/;

export function firstMessageProblem(c: Pick<Conv, 'theyWrote'>, p: Payload): string | null {
  if (c.theyWrote) return null;
  if (p.t !== 'text' && p.t !== 'quick_reply') return 'first_text_only';
  if (p.text.length > 500) return 'first_too_long';
  if (LINK.test(p.text) || HANDLE.test(p.text) || EMAIL.test(p.text) || PHONE.test(p.text)) return 'first_no_contacts';
  return null;
}

