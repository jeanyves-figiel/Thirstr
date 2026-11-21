import type { Me } from '../api/client';

// F-02 flow (S-01…S-06). Pure logic, unit tested.
export type Screen = 'welcome' | 'create' | 'inbox' | 'basics' | 'underage' | 'location' | 'photo' | 'verify' | 'done' | 'explore' | 'link';

export function screenFor(me: Me | null): Screen {
  if (!me) return 'welcome';
  switch (me.onboarding_step) {
    case 'basics':
      return 'basics';
    case 'location':
      return 'location';
    case 'photo':
      return 'photo';
    case 'verify':
      return 'verify';
    default:
      return 'explore';
  }
}

// R-02.1 (v2): 7 steps. Basics is split into 4 screens (name, birthday, identity, here for).
export type BasicsStep = 'name' | 'birthday' | 'identity' | 'herefor';
export const BASICS_STEPS: BasicsStep[] = ['name', 'birthday', 'identity', 'herefor'];
export const STEP_OF: Record<BasicsStep | 'location' | 'photo' | 'verify', number> = { name: 1, birthday: 2, identity: 3, herefor: 4, location: 5, photo: 6, verify: 7 };

export function daysIn(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Wheel parts → YYYY-MM-DD; day clamped to the month length (31 Feb → 28/29 Feb). */
export function isoBirthday(year: number, month0: number, day: number): string {
  const d = Math.min(day, daysIn(year, month0));
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** RF-1 (required-fields.md): display name 1–20. */
export const NAME_MAX = 20;

export function nameValid(name: string): boolean {
  const n = name.trim();
  return n.length >= 1 && n.length <= NAME_MAX;
}

export function ageOn(birthdate: Date, today: Date): number {
  let age = today.getFullYear() - birthdate.getFullYear();
  const m = today.getMonth() - birthdate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthdate.getDate())) age--;
  return age;
}

export function parseBirthday(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 ? d : null;
}

// Birthday typed on a number pad (iOS has no "-" key): keep digits only and insert the dashes.
export function maskBirthday(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

export type BasicsInput = { display_name: string; birthdate: string; gender: string; gender_other: string; here_for: string[] };

// Mirrors server validation (R-02.4/R-02.5) so Continue only enables when valid.
export function basicsValid(b: BasicsInput): boolean {
  const name = b.display_name.trim();
  if (name.length < 1 || name.length > 30) return false;
  if (!parseBirthday(b.birthdate)) return false;
  if (!['man', 'trans_man', 'non_binary', 'other', 'unspecified'].includes(b.gender)) return false;
  if (b.gender === 'other' && (b.gender_other.trim().length < 1 || b.gender_other.length > 20)) return false;
  return b.here_for.length > 0;
}

// R-02.2: rounded down to nearest 10 below 100 (server already rounds; kept for display safety).
export function displayCount(n: number | null): number | null {
  if (n === null || n < 10) return null;
  return n < 100 ? Math.floor(n / 10) * 10 : n;
}
