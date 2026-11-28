// F-25 Refill (#339): glue between what the app already loads and the device-only rules in
// refill.ts. Explore cards carry `resurface`; party guests, venue "here now" and Tonight plans
// don't, so for the one or two people who could get a card the app reads his profile view
// (`purpose=refill`: never counted as a profile view, R-25.1). At most one card a day.
import { api, type Me } from '../api/client';
import type { Card as ExploreCard, ProfileView } from '../api/types';
import { getConvs } from '../chat/engine';
import * as P from '../chat/people';
import { isPlus } from '../plus/plus';
import * as R from './refill';

export function chats(): Map<string, R.ChatFacts> {
  const m = new Map<string, R.ChatFacts>();
  for (const c of getConvs()) {
    if (c.ctx || !c.peer || c.gone) continue;
    m.set(c.peer, { peer: c.peer, iWrote: c.iWrote, theyWrote: c.theyWrote, lastAt: c.lastAt, name: c.name, photo: c.photo, fav: P.isFav(c.peer) });
  }
  return m;
}

export function viewer(me: Me): R.Viewer {
  const at = me.created_at ? Date.parse(me.created_at) : NaN;
  return { plus: isPlus(me), safeMode: me.safe_mode === 'on' || !!me.safe_mode_active, createdAt: Number.isFinite(at) ? at : null, prefs: R.prefs() };
}

/** Explore grid / tray / visitors: cards carry `resurface` and `online`. */
export function fromExplore(me: Me, items: ExploreCard[], lookingAround: boolean) {
  const seen = (c: ExploreCard): R.Seen => ({ id: c.id, resurface: c.resurface, online: c.online, name: c.display_name, photo: c.photo });
  const local = lookingAround ? [] : items.filter((c) => !c.visitor);
  const away = lookingAround ? items : items.filter((c) => c.visitor);
  const v = viewer(me);
  const cs = chats();
  // Cheap: nothing to do unless someone here is a past contact.
  if (![...local, ...away].some((c) => cs.has(c.id) || R.rec(c.id))) return;
  (async () => {
    if (away.length) await R.observe('trip', away.map(seen), cs, v);
    if (local.length) await R.observe('nearby', local.map(seen), cs, v);
  })().catch(() => {});
}

/** Party guests, venue "here now", Tonight plans: no flag on the card, so check the few that could matter. */
export function fromPeople(me: Me, source: 'place' | 'tonight', people: { id: string; display_name?: string; photo?: string | null }[], where?: string) {
  const v = viewer(me);
  const now = Date.now();
  if (!R.viewerReady(v, now) || !R.cardDue(R.prefs(), R.currentCard(), now)) return;
  const cs = chats();
  const maybe = people.filter((p) => R.eligible(cs.get(p.id) ?? null, R.rec(p.id), true, now)).slice(0, 2);
  if (!maybe.length) return;
  (async () => {
    const seen: R.Seen[] = [];
    for (const p of maybe) {
      const r = await api<ProfileView>('GET', `/profiles/${p.id}?purpose=refill`).catch(() => null);
      if (r) seen.push({ id: p.id, resurface: r.resurface === true, online: r.online, name: p.display_name, photo: p.photo ?? null, where });
    }
    await R.observe(source, seen, cs, v);
  })().catch(() => {});
}

/** Settings and the intro card: my two switches. `resurface_ok` is the only one the server keeps. */
export async function setSwitches(me: Me, show: boolean | null, findMe: boolean | null): Promise<Partial<Me['settings']>> {
  if (show !== null) await R.setPrefs({ show });
  if (findMe === null) return {};
  await api('PATCH', '/me/settings', { resurface_ok: findMe });
  return { resurface_ok: findMe };
}
