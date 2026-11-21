// #189 Time window logic for the timeline scrubber (Post your plan R-09.9, Host a party R-10.1). Pure: times are epoch ms.
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const STEP = 15 * MIN;

export type Domain = { min: number; max: number };
export type Win = { s: number; e: number };
export type Limits = Domain & { minLen: number; maxLen: number };

/** Next local 06:00 at least 1 h after `now` (end of "tonight", R-09.11). */
export function nightEnd(now: number): number {
  const d = new Date(now);
  d.setHours(6, 0, 0, 0);
  while (d.getTime() < now + HOUR) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Round up to the next clock quarter (xx:00, :15, :30, :45). */
export const ceilStep = (t: number) => Math.ceil(t / STEP) * STEP;

/**
 * Snap a dragged time: the domain start ("Now") is kept as is; anything else lands on a clock quarter.
 * Within half a step of the start snaps to the start, so "Now" is always reachable.
 */
export function snap(t: number, d: Domain): number {
  if (t - d.min < STEP / 2) return d.min;
  return Math.min(d.max, Math.max(d.min, Math.round(t / STEP) * STEP));
}

/** Move one end of the window, keeping min/max length and the domain. */
export function setEnd(w: Win, which: 's' | 'e', t: number, l: Limits): Win {
  if (which === 's') {
    let s = snap(t, l);
    s = Math.min(s, w.e - l.minLen);
    s = Math.max(s, w.e - l.maxLen, l.min);
    return { s, e: w.e };
  }
  let e = snap(t, l);
  e = Math.max(e, w.s + l.minLen);
  e = Math.min(e, w.s + l.maxLen, l.max);
  return { s: w.s, e };
}

/** Slide the whole window (same length), clamped to the domain. */
export function slide(w: Win, newStart: number, l: Limits): Win {
  const len = w.e - w.s;
  const s = Math.max(l.min, Math.min(l.max - len, snap(newStart, l)));
  return { s, e: s + len };
}

/** Bring a window back inside limits (domain changed, e.g. Tonight ↔ Tomorrow or time passed). */
export function fit(w: Win, l: Limits): Win {
  let len = Math.max(l.minLen, Math.min(l.maxLen, w.e - w.s, l.max - l.min));
  const s = Math.max(l.min, Math.min(l.max - len, w.s));
  len = Math.min(len, l.max - s);
  return { s, e: s + len };
}

// ---- Post your plan (R-09.9): now → 06:00, 30 min to 12 h, default now → +4 h.
export function planLimits(now: number): Limits {
  return { min: now, max: nightEnd(now), minLen: 30 * MIN, maxLen: 12 * HOUR };
}
export function planDefault(now: number): Win {
  const l = planLimits(now);
  return fit({ s: now, e: ceilStep(now + 4 * HOUR) }, l);
}

// ---- Host a party (R-10.1): Tonight = now → 12:00 after the night (max 18 h shown); Tomorrow = 06:00 → 06:00 next day. 1–12 h, default 22:00 → 4 h.
/** "Today" before 17:00, "Tonight" after. */
export const dayWord = (now: number, day: PartyDay): 'today' | 'tonight' | 'tomorrow' => (day === 'tomorrow' ? 'tomorrow' : new Date(now).getHours() >= 6 && new Date(now).getHours() < 17 ? 'today' : 'tonight');
export type PartyDay = 'tonight' | 'tomorrow';
export function partyLimits(now: number, day: PartyDay): Limits {
  const b = nightEnd(now);
  return day === 'tonight'
    ? { min: ceilStep(now), max: Math.min(b + 6 * HOUR, ceilStep(now) + 18 * HOUR), minLen: HOUR, maxLen: 12 * HOUR }
    : { min: b, max: b + 24 * HOUR, minLen: HOUR, maxLen: 12 * HOUR };
}
export function partyDefault(now: number, day: PartyDay): Win {
  const l = partyLimits(now, day);
  // Smart default: 22:00 unless that's already close or past, then the next half hour + 30 min.
  const at22 = new Date(now);
  at22.setHours(22, 0, 0, 0);
  const soon = Math.ceil((now + 30 * MIN) / (30 * MIN)) * 30 * MIN;
  const s = day === 'tonight' ? (new Date(now).getHours() >= 6 && at22.getTime() > soon ? at22.getTime() : soon) : l.min + 16 * HOUR; // tomorrow 22:00
  return fit({ s, e: s + 4 * HOUR }, l);
}

/** Hour ticks and labels for the track: a label every 2 h (every 4 h when the domain is over 16 h). */
export function ticks(d: Domain): { t: number; major: boolean; label: boolean }[] {
  const out: { t: number; major: boolean; label: boolean }[] = [];
  const every = d.max - d.min > 16 * HOUR ? 4 : 2;
  for (let t = Math.ceil(d.min / (30 * MIN)) * 30 * MIN; t <= d.max; t += 30 * MIN) {
    const h = new Date(t).getHours();
    const major = new Date(t).getMinutes() === 0;
    out.push({ t, major, label: major && h % every === 0 && t - d.min >= 75 * MIN });
  }
  return out;
}

export const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** "4 h", "1 h 30", "45 min". */
export function lenLabel(ms: number, hUnit = 'h', minUnit = 'min'): string {
  const m = Math.round(ms / MIN);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} ${minUnit}`;
  return r ? `${h} ${hUnit} ${String(r).padStart(2, '0')}` : `${h} ${hUnit}`;
}

/** Guest count (R-10.1 capacity 2–50). */
export const clampCap = (n: number) => Math.max(2, Math.min(50, Math.round(n)));
