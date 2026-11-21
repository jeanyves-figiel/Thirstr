// One test bot (testing.md › Chat test bots). A real chat client: own MLS keys (the app's mls.ts,
// bundled), key packages on the server, ciphertext only on the wire. Everything else goes through
// the same public API the app uses: location, photos, Now, plans, parties, activities, taps.
import { gcm } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { latLngToCell } from 'h3-js';
import { EventEmitter } from 'node:events';
import { Socket } from 'phoenix';
import * as mls from '../../mobile/src/chat/mls';
import { fromB64, fromUtf8, hex, rand, toB64, utf8 } from '../../mobile/src/chat/bytes';
import { avatar } from './art';
import { kv } from './kv';
import type { Persona } from './personas';
import { initialState, nonText, plan, type Act, type ChatState, type Out } from './replies';

export const API = (process.env.API_URL ?? 'https://staging.thirstr.fun').replace(/\/$/, '');
const KEY = process.env.TESTBOT_KEY ?? '';
const POLL_MS = Number(process.env.BOT_POLL_MS ?? 20_000);
const KP_TARGET = 30;
const KP_MIN = 15;
const STUCK_MS = 10 * 60_000;
const H = 3600_000;
const SCENE_MS = Number(process.env.BOT_SCENE_MS ?? 60_000);

type Auth = { access: string; refresh: string; profile: string };
type Conv = { gids: string[]; s: ChatState };
type Incoming = { id: number; to_profile_id: string; from_profile_id: string; group_id: string; kind: string; ciphertext: string; at: string };
type Payload = Record<string, unknown> & { t: string };
type Claimed = { id: number; device_id: string; key_package: string; profile: string };
type AlbumItem = { blob: string; key: string; iv: string; mime: string };

export const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

/** Every bot's profile id (bots never chat with each other) and "someone chatted with a bot". */
export const bots = new Set<string>();
export const bus = new EventEmitter();

// One lock for all MLS state in the process (all bots share the store).
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const r = chain.then(fn, fn);
  chain = r.catch(() => {});
  return r;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`HTTP ${status} ${body.slice(0, 200)}`);
  }
}

async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(API + '/v1' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-thirstr-install': 'testbot-0000000000000000', 'x-thirstr-platform': 'web', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text);
  return text ? JSON.parse(text) : undefined;
}

/** 422 `to_device_id: unknown device` (server/lib/thirstr/chat.ex). */
const staleDevice = (e: unknown) => e instanceof HttpError && e.status === 422 && e.body.includes('to_device_id');

export class Bot {
  auth: Auth | null = null;
  device = '';
  chan: ReturnType<Socket['channel']> | null = null;
  pulling = false;
  again = false;
  busy = new Map<string, Promise<void>>();
  constructor(public p: Persona) {}

  // ---------------------------------------------------------------- store (prefixed per bot)

  k = (key: string) => `${this.p.handle}:${key}`;
  get = <T>(key: string) => kv.get<T>(this.k(key));
  set = (key: string, v: unknown) => kv.set(this.k(key), v);
  del = (key: string) => kv.del(this.k(key));
  say = (...a: unknown[]) => log(`[${this.p.handle}]`, ...a);

  // ---------------------------------------------------------------- session & API

  persona() {
    const p = this.p;
    return {
      handle: p.handle,
      name: p.name,
      age: p.age,
      gender: p.gender,
      here_for: p.here_for,
      show_in: p.show_in,
      fields: p.fields,
      settings: p.settings ?? {},
      seeded: p.seeded === true,
      server_location: p.location.level === 'server' ? { lat: p.location.lat, lng: p.location.lng } : undefined,
    };
  }

  /**
   * New tokens from the test bot endpoint. `resume`: the bot still holds its MLS state, so the
   * server keeps its device (queue, key packages, chats); without it the device is replaced
   * and the local state is dropped.
   */
  async newSession(resume = false) {
    if (!KEY) throw new Error('TESTBOT_KEY missing');
    const s = await http('POST', '/testbot/session', { ...this.persona(), resume }, { 'x-testbot-key': KEY });
    if (!resume) await kv.delPrefix(this.k(''));
    this.auth = { access: s.access_token, refresh: s.refresh_token, profile: s.profile_id };
    await this.set('auth', this.auth);
    this.say(resume ? 'resumed session, profile' : 'new session, profile', this.auth.profile);
  }

  private refreshing?: Promise<void>;

  /** One refresh at a time: parallel 401s share it (a spent refresh token is a theft signal). */
  refresh() {
    return (this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = undefined)));
  }

  private async doRefresh() {
    try {
      const s = await http('POST', '/auth/refresh', { refresh: this.auth!.refresh });
      this.auth = { ...this.auth!, access: s.access_token, refresh: s.refresh_token };
      await this.set('auth', this.auth);
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) await this.newSession(true);
      else throw e;
    }
  }

  async api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await http(method, path, body, { authorization: 'Bearer ' + this.auth!.access });
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 401) throw e;
      await this.refresh();
      return http(method, path, body, { authorization: 'Bearer ' + this.auth!.access });
    }
  }

  get me() {
    return this.auth!.profile;
  }

  // ---------------------------------------------------------------- start

  async start() {
    this.auth = await this.get<Auth>('auth');
    if (!this.auth) await this.newSession();
    else await http('POST', '/testbot/session', { ...this.persona(), new_session: false }, { 'x-testbot-key': KEY });
    bots.add(this.me);
    await this.ensureKeyPackages();
    this.connect();
    await this.pull();
    const every = (ms: number, fn: () => Promise<unknown>, what: string) => {
      const run = () => fn().catch((e) => this.say(what, 'failed', (e as Error).message));
      void run();
      setInterval(run, ms);
    };
    setInterval(() => void this.pull(), POLL_MS);
    every(10 * 60_000, () => this.ensureKeyPackages(), 'key packages');
    every(3 * H, () => this.location(), 'location');
    every(5 * H, () => this.setNow(), 'now');
    every(6 * H, () => this.photos(), 'photos');
    every(30 * 60_000, () => this.planTonight(), 'plan');
    every(6 * H, () => this.trip(), 'trip');
    every(SCENE_MS, () => this.party(), 'party');
    every(SCENE_MS, () => this.activity(), 'activity');
    every(5 * 60_000, () => this.tapBack(), 'taps');
    if (this.p.icebreaker) bus.on('peer', (peer: string) => void this.icebreak(peer).catch(() => {}));
    this.say('up as', this.me, 'on', API);
  }

  // ---------------------------------------------------------------- profile, location, extras

  async location() {
    const { level, lat, lng } = this.p.location;
    if (level === 'server') return;
    const r9 = latLngToCell(lat, lng, 9);
    if (level === 'city') await this.api('PUT', '/me/location', { level: 'city', cell_r5: latLngToCell(lat, lng, 5) });
    else if (level === 'hidden') await this.api('PUT', '/me/location', { level: 'hidden', cell_r9: r9 });
    else await this.api('PUT', '/me/location', { level: level === 'exact' ? 'exact' : 'area', cell_r9: r9 });
    if (level === 'exact') await this.api('PUT', '/me/pin', { lat, lng, ttl_s: 14_400, confirm: true, audience: 'verified' });
  }

  async setNow() {
    if (this.p.now) await this.api('PUT', '/me/now', { ...this.p.now, ttl_s: 21_600 });
  }

  /** Public photos, generated once (slot 0 = main). */
  async photos() {
    const ver = `v1:${this.p.photos.n}:${this.p.photos.hue}`;
    if ((await this.get<string>('photos')) === ver) return;
    for (let slot = 0; slot < this.p.photos.n; slot++) {
      const png = avatar({ hue: this.p.photos.hue + slot * 25, seed: hash(this.p.handle) + slot, label: `TEST BOT ${slot + 1}` });
      const up = await this.api<{ photo_id: string; put_url: string }>('POST', `/me/profiles/${this.me}/photos`, { slot, content_type: 'image/png' });
      const put = await fetch(up.put_url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: Buffer.from(png) });
      if (!put.ok) throw new Error('photo upload ' + put.status);
      const ck = await this.api<{ status?: string; photo?: { status: string } }>('POST', `/me/profiles/${this.me}/photos/${up.photo_id}/check`, {});
      this.say('photo', slot, ck.status ?? ck.photo?.status);
    }
    await this.set('photos', ver);
  }

  /** Tonight plan (R-09.9), re-posted after it expires. */
  async planTonight() {
    if (!this.p.plan) return;
    const exp = (await this.get<string>('plan_exp')) ?? '';
    if (exp && Date.parse(exp) > Date.now()) return;
    const now = Date.now();
    const r = await this.api<{ expires_at: string }>('POST', '/tonight?mode=hookup', {
      ...this.p.plan,
      audience: 'verified',
      window_start: new Date(now).toISOString(),
      window_end: new Date(now + 3 * H).toISOString(),
      tz_offset_min: tzZurich(),
    });
    await this.set('plan_exp', r.expires_at);
    this.say('tonight plan until', r.expires_at);
  }

  /** Trip (F-20): visiting another city from today, re-planned when it ends. */
  async trip() {
    const cfg = this.p.trip;
    if (!cfg) return;
    const last = (await this.get<string>('trip_last')) ?? '';
    const today = localDay(0);
    if (last && last >= today) return;
    const r = await this.api<{ cities: { id: number; name: string }[] }>('GET', '/cities?q=' + encodeURIComponent(cfg.city));
    const city = r.cities.find((c) => c.name === cfg.city) ?? r.cities[0];
    if (!city) throw new Error('no city ' + cfg.city);
    const lastDay = localDay(cfg.days - 1);
    await this.api('POST', '/trips', { city_id: city.id, first_day: today, last_day: lastDay, show_days: 0, say_from: true, tz_offset_min: tzZurich() });
    await this.set('trip_last', lastDay);
    this.say('trip to', cfg.city, 'until', lastDay);
  }

  /** Hosts a party (R-10.1), accepts every request and keeps the guest group chat in step. */
  async party() {
    const cfg = this.p.party;
    if (!cfg) return;
    let cur = await this.get<{ id: string; title: string; ends: string }>('party');
    if (!cur || Date.parse(cur.ends) < Date.now()) {
      const s = Date.now() + 10 * 60_000;
      const e = s + 8 * H;
      try {
        const r = await this.api<{ id: string }>('POST', '/parties', {
          title: cfg.title,
          starts_at: new Date(s).toISOString(),
          ends_at: new Date(e).toISOString(),
          capacity: cfg.capacity,
          rules: cfg.rules,
          audience: 'verified',
        });
        cur = { id: r.id, title: cfg.title, ends: new Date(e).toISOString() };
        await this.set('party', cur);
        this.say('party', cur.id);
      } catch (err) {
        if (!cur) throw err;
      }
    }
    const p = await this.api<{ my_state?: string; title: string; requests?: { profile: { id: string; display_name: string }; state: string }[] }>('GET', `/parties/${cur.id}`);
    for (const r of p.requests ?? []) {
      if (r.state !== 'pending') continue;
      await this.api('POST', `/parties/${cur.id}/requests/${r.profile.id}/accept`, {});
      r.state = 'accepted';
      this.say('accepted', r.profile.id);
    }
    const guests = (p.requests ?? []).filter((r) => r.state === 'accepted').map((r) => r.profile.id);
    await this.syncGroup('party:' + cur.id, p.title, guests);
  }

  /** Posts a sport activity (R-11.3) and keeps its group chat in step with who joined. */
  async activity() {
    const cfg = this.p.activity;
    if (!cfg) return;
    let cur = await this.get<{ id: string; title: string; exp: number }>('activity');
    if (!cur || cur.exp < Date.now()) {
      const start = new Date(Date.now() + 2 * H);
      start.setUTCMinutes(0, 0, 0);
      const r = await this.api<{ id: string }>('POST', '/activities?mode=sport', {
        sport: cfg.sport,
        title: cfg.title,
        place_text: cfg.place,
        starts_at: start.toISOString(),
        capacity: 8,
        intent: 'just_sport',
        audience: 'verified',
      });
      cur = { id: r.id, title: cfg.title, exp: start.getTime() + 2 * H };
      await this.set('activity', cur);
      this.say('activity', cur.id);
    }
    const m = await this.api<{ members: { id: string }[] }>('GET', `/activities/${cur.id}/members`);
    await this.syncGroup('activity:' + cur.id, cur.title, m.members.map((x) => x.id).filter((x) => x !== this.me));
  }

  /** Taps back everyone who tapped (R-07.15). */
  async tapBack() {
    const r = await this.api<{ taps: { profile: { id: string }; seen: boolean; mutual: boolean }[] }>('GET', '/taps');
    for (const t of r.taps.filter((x) => !x.mutual && !bots.has(x.profile.id))) {
      await this.api('POST', `/profiles/${t.profile.id}/tap`, {}).catch(() => {});
      this.say('tapped back', t.profile.id);
    }
    if (r.taps.some((t) => !t.seen)) await this.api('POST', '/taps/seen', {}).catch(() => {});
  }

  /** Ghost: first message to people who chatted with another bot (once each, after a minute). */
  async icebreak(peer: string) {
    if (bots.has(peer) || (await this.get('ice:' + peer))) return;
    await this.set('ice:' + peer, true);
    await sleep(60_000);
    const c = await this.getConv(peer);
    if (c.gids.length) return;
    await this.send(peer, { t: 'text', text: "Hey 👻 I'm hidden, so you won't find me on the map. I saw you testing the bots. Write help to see what I can do." });
    this.say('icebreaker to', peer);
  }

  // ---------------------------------------------------------------- keys & groups

  async ensureKeyPackages() {
    const r = await this.api<{ counts: Record<string, { count: number; last_resort: boolean }>; device_id: string }>('GET', '/mls/keypackages');
    this.device = r.device_id;
    const counts = r.counts[this.me] ?? { count: 0, last_resort: false };
    if (counts.count >= KP_MIN && counts.last_resort) return;
    const me = { p: this.me, d: this.device };
    const fresh: string[] = [];
    for (let i = counts.count; i < KP_TARGET; i++) fresh.push(toB64((await locked(() => mls.newKeyPackage(me))).wire));
    let lastResort: string | undefined;
    if (!counts.last_resort) {
      const lr = await locked(() => mls.newKeyPackage(me));
      await kv.set('kp:lastresort:' + this.me, lr.ref);
      lastResort = toB64(lr.wire);
    }
    await this.api('POST', '/mls/keypackages', { profile_id: this.me, key_packages: fresh, last_resort: lastResort });
    this.say('key packages topped up', fresh.length);
  }

  getConv = async (peer: string): Promise<Conv> => (await this.get<Conv>('conv:' + peer)) ?? { gids: [], s: initialState(this.p.lang, this.p.settings?.read_receipts !== false) };
  putConv = (peer: string, c: Conv) => this.set('conv:' + peer, c);

  async claim(peer: string, ctx?: string): Promise<Claimed[]> {
    const r = await this.api<{ key_packages: { id: number; device_id: string; key_package: string }[] }>('POST', '/mls/keypackages/claim', {
      from_profile_id: this.me,
      to_profile_id: peer,
      context: ctx,
    });
    return r.key_packages.map((k) => ({ ...k, profile: peer }));
  }

  async ensureGroup(peer: string): Promise<string> {
    const c = await this.getConv(peer);
    for (const g of c.gids) if (await mls.load(g)) return g;
    const claimed = await this.claim(peer);
    const g = await mls.createWith({ p: this.me, d: this.device }, claimed);
    await this.api('POST', '/mls/messages', { from_profile_id: this.me, group_id: toB64(g.gid), envelopes: g.envelopes });
    c.gids = [g.groupId, ...c.gids].sort();
    await this.set('g2p:' + g.groupId, peer);
    await this.putConv(peer, c);
    return c.gids[0];
  }

  /** Host side of a party / activity chat: welcome new members, commit to the others. */
  syncGroup(ctx: string, title: string, want: string[]) {
    return locked(async () => {
      const g = await this.get<{ gid: string; title: string }>('grp:' + ctx);
      if (!g) {
        const claimed = (await Promise.all(want.map((p) => this.claim(p, ctx).catch(() => [] as Claimed[])))).flat();
        if (!claimed.length) return;
        const r = await mls.createWith({ p: this.me, d: this.device }, claimed, ctx);
        await this.api('POST', '/mls/messages', { from_profile_id: this.me, group_id: toB64(r.gid), context: ctx, envelopes: r.envelopes });
        await this.set('grp:' + ctx, { gid: r.groupId, title });
        await this.set('g2ctx:' + r.groupId, ctx);
        this.say('group chat', ctx, claimed.length);
        return;
      }
      const state = await mls.load(g.gid);
      if (!state) return;
      const inGroup = new Set(mls.members(state).map((m) => m.p));
      const fresh = want.filter((p) => !inGroup.has(p));
      if (!fresh.length) return;
      const claimed = (await Promise.all(fresh.map((p) => this.claim(p, ctx).catch(() => [] as Claimed[])))).flat();
      if (!claimed.length) return;
      const r = await mls.addMembers(g.gid, claimed, ctx);
      const commits = r.before
        .filter((m) => !(m.p === this.me && m.d === this.device))
        .map((m) => ({ to_profile_id: m.p, to_device_id: m.d, kind: 'commit', ciphertext: toB64(r.commit) }));
      await this.api('POST', '/mls/messages', { from_profile_id: this.me, group_id: toB64(fromHex(g.gid)), context: ctx, envelopes: [...commits, ...r.welcomes] });
      this.say('group chat', ctx, '+', claimed.length);
    });
  }

  // ---------------------------------------------------------------- send

  /** Seals and sends one payload to a 1:1 peer or a group (`ctx`); retries the same ciphertext. */
  send(peer: string, p: Payload, ctx?: string) {
    return locked(() => this.sealAndPost(peer, p, ctx, false));
  }

  private async sealAndPost(peer: string, p: Payload, ctx: string | undefined, rebuilt: boolean): Promise<string> {
    const id = hex(rand(12));
    const fk = rand(32);
    const g = ctx ? await this.get<{ gid: string; title: string }>('grp:' + ctx) : null;
    const extra = ctx ? { n: this.p.name, g: g?.title } : {};
    const plain = utf8(JSON.stringify({ ...p, v: 1, id, at: Date.now(), fk: toB64(fk), ...extra }));
    const tag = hmac(sha256, fk, plain);
    const gid = ctx ? (g?.gid ?? (await this.get<string>('ingrp:' + ctx))) : await this.ensureGroup(peer);
    if (!gid) throw new Error('no group');
    const sealed = await mls.seal(gid, plain);
    const to = sealed.members.filter((m) => !(m.p === this.me && m.d === this.device));
    const body = {
      client_id: id,
      from_profile_id: this.me,
      group_id: toB64(fromHex(gid)),
      franking_tag: toB64(tag),
      context: ctx,
      envelopes: to.map((m) => ({ to_profile_id: m.p, to_device_id: m.d, kind: 'app', ciphertext: toB64(sealed.wire) })),
    };
    for (let i = 0; ; i++) {
      try {
        if (to.length) await this.api('POST', '/mls/messages', body);
        return id;
      } catch (e) {
        // #208 (as the app, #206 R-07.20): a device in the 1:1 group is gone (the person
        // reinstalled or signed out). Drop that group once and send on a new / other one.
        if (!ctx && !rebuilt && staleDevice(e)) {
          this.say('stale device, rebuilding chat with', peer);
          await this.dropGroup(peer, gid);
          return this.sealAndPost(peer, p, ctx, true);
        }
        if (i >= 4 || (e instanceof HttpError && e.status < 500 && e.status !== 429)) throw e;
        await sleep(1000 * 2 ** i);
      }
    }
  }

  // ---------------------------------------------------------------- receive

  async pull() {
    if (this.pulling) {
      this.again = true;
      return;
    }
    this.pulling = true;
    try {
      do {
        this.again = false;
        const r = await this.api<{ messages: Incoming[] }>('GET', '/mls/messages');
        if (!r.messages.length) break;
        const seen = new Set((await this.get<number[]>('seen')) ?? []);
        for (const m of r.messages) {
          if (seen.has(m.id)) continue;
          const res = await locked(() => this.handle(m));
          if (res === 'pending') await this.addPending(m);
          seen.add(m.id);
          await this.set('seen', [...seen].slice(-2000));
        }
        await this.api('POST', '/mls/messages/ack', { ids: r.messages.map((m) => m.id) });
        if (r.messages.length === 200) this.again = true;
      } while (this.again);
      await this.retryPending();
    } catch (e) {
      this.say('pull failed', (e as Error).message);
    } finally {
      this.pulling = false;
    }
  }

  async addPending(m: Incoming) {
    const list = (await this.get<{ m: Incoming; first: number }[]>('pending')) ?? [];
    if (!list.some((x) => x.m.id === m.id)) list.push({ m, first: Date.now() });
    await this.set('pending', list.slice(-200));
  }

  async retryPending() {
    const list = (await this.get<{ m: Incoming; first: number }[]>('pending')) ?? [];
    if (!list.length) return;
    const keep: typeof list = [];
    for (const x of list.sort((a, b) => a.m.id - b.m.id)) {
      const res = await locked(() => this.handle(x.m));
      if (res !== 'pending') continue;
      if (Date.now() - x.first < STUCK_MS) keep.push(x);
      else if (x.m.kind === 'app' && !(await this.get('g2ctx:' + hex(fromB64(x.m.group_id))))) {
        // R-07.20: give up on the broken 1:1 group, start a fresh one and tell the app to drop it.
        const bad = hex(fromB64(x.m.group_id));
        this.say('resync with', x.m.from_profile_id);
        await locked(() => this.dropGroup(x.m.from_profile_id, bad));
        await this.send(x.m.from_profile_id, { t: 'resync', drop: bad }).catch(() => {});
      }
    }
    await this.set('pending', keep);
  }

  async dropGroup(peer: string, gid: string) {
    if (!/^[0-9a-f]+$/.test(gid)) return;
    const c = await this.getConv(peer);
    await mls.forget(gid);
    await this.del('g2p:' + gid);
    c.gids = c.gids.filter((g) => g !== gid);
    await this.putConv(peer, c);
  }

  /** Returns 'pending' when it can't be opened yet. */
  async handle(m: Incoming): Promise<'pending' | null> {
    const wire = fromB64(m.ciphertext);
    const gid = hex(fromB64(m.group_id));
    if (m.kind === 'welcome') {
      const j = await mls.join(wire).catch(() => null);
      if (!j) return null;
      if (j.ctx) {
        // someone else's party / activity chat the bot was added to
        await this.set('g2ctx:' + j.groupId, j.ctx);
        await this.set('ingrp:' + j.ctx, j.groupId);
        return null;
      }
      const peer = j.members.find((x) => x.p !== this.me)?.p ?? m.from_profile_id;
      const c = await this.getConv(peer);
      if (!c.gids.includes(j.groupId)) c.gids = [...c.gids, j.groupId].sort();
      await this.set('g2p:' + j.groupId, peer);
      await this.putConv(peer, c);
      this.say('joined chat with', peer);
      return null;
    }
    if (m.kind !== 'app' && m.kind !== 'commit') return null;
    let plain: Uint8Array | null;
    try {
      plain = await mls.open(gid, wire);
    } catch {
      return 'pending';
    }
    if (!plain || m.kind !== 'app') return null;
    if (bots.has(m.from_profile_id)) return null;
    const w = JSON.parse(fromUtf8(plain)) as Payload & { id: string; text?: string; drop?: string; k?: number };
    const ctx = await this.get<string>('g2ctx:' + gid);
    if (ctx) {
      if (w.t === 'text' || w.t === 'quick_reply') setImmediate(() => void this.respondGroup(ctx, w).catch((e) => this.say('group reply failed', (e as Error).message)));
      return null;
    }
    const peer = (await this.get<string>('g2p:' + gid)) ?? m.from_profile_id;
    if (w.t === 'resync' && w.drop) {
      await this.dropGroup(peer, w.drop);
      return null;
    }
    if (['read', 'delivered', 'reaction', 'profile.private', 'disappearing', 'screenshot', 'album.revoke', 'album.grant', 'notice', 'friend', 'vc'].includes(w.t)) return null;
    if (!this.p.icebreaker) bus.emit('peer', peer);
    setImmediate(() => void this.respond(peer, w).catch((e) => this.say('respond failed', (e as Error).message)));
    return null;
  }

  async respondGroup(ctx: string, w: { text?: string }) {
    await sleep(2500);
    const r = plan(w.text ?? '', initialState(this.p.lang), Math.random);
    const first = r.out.find((o) => o.p);
    if (first?.p) await this.send('', first.p, ctx);
  }

  /** Receipts, typing and the planned replies, one chat at a time. */
  respond(peer: string, w: { t: string; id: string; text?: string; k?: number }) {
    const prev = this.busy.get(peer) ?? Promise.resolve();
    const next = prev.then(async () => {
      const c = await this.getConv(peer);
      if (c.s.delivered) await this.send(peer, { t: 'delivered', upTo: w.id }).catch(() => {});
      await sleep(900);
      if (c.s.read) await this.send(peer, { t: 'read', upTo: w.id }).catch(() => {});
      let out: Out[];
      if (w.t === 'quick_reply' && w.k === 3) out = [{ delayMs: 1500, act: this.p.album ? 'album' : 'photo' }];
      else if (w.t === 'text' || w.t === 'quick_reply') {
        const r = plan(w.text ?? '', c.s);
        c.s = r.state;
        await this.putConv(peer, c);
        out = r.out;
      } else out = [{ delayMs: 1500, p: { t: 'text', text: nonText(c.s) } }];
      const start = Date.now();
      for (const o of out.sort((a, b) => a.delayMs - b.delayMs)) {
        const wait = start + o.delayMs - Date.now();
        if (wait > 1500) {
          await sleep(wait - 1500);
          this.typing(peer);
          await sleep(1500);
        } else if (wait > 0) {
          this.typing(peer);
          await sleep(wait);
        }
        if (o.act) await this.act(peer, o.act, c.s);
        else if (o.p) await this.send(peer, o.p);
      }
    });
    const tail = next.catch(() => {});
    this.busy.set(peer, tail);
    return next;
  }

  // ---------------------------------------------------------------- sharing

  /** Encrypts bytes with a fresh key and uploads them (F-08, same as the app's uploadEncrypted). */
  async upload(bytes: Uint8Array, opts: { album?: boolean; once?: boolean } = {}) {
    const key = rand(32);
    const iv = rand(12);
    const ct = gcm(key, iv).encrypt(bytes);
    const r = await this.api<{ blob_id: string; put_url: string }>('POST', '/media/upload', { size: ct.length, ...opts });
    const put = await fetch(r.put_url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from(ct) });
    if (!put.ok) throw new Error('upload failed ' + put.status);
    return { blob: r.blob_id, key: toB64(key), iv: toB64(iv) };
  }

  async albumItems(): Promise<AlbumItem[]> {
    const a = this.p.album!;
    const have = await this.get<AlbumItem[]>('album');
    if (have?.length === a.n) return have;
    const items: AlbumItem[] = [];
    for (let i = 0; i < a.n; i++) {
      const png = avatar({ hue: a.hue + i * 20, seed: hash(this.p.handle) + 100 + i, label: `PRIVATE ${i + 1}`, dark: true });
      items.push({ ...(await this.upload(png, { album: true })), mime: 'image/png' });
    }
    await this.set('album', items);
    return items;
  }

  async act(peer: string, a: Act, s: ChatState) {
    const n = Math.floor(Math.random() * 9) + 1;
    switch (a) {
      case 'photo':
      case 'once': {
        const once = a === 'once';
        const png = avatar({ hue: this.p.photos.hue + n * 30, seed: Date.now() & 0xffff, label: `TEST BOT ${n}`, w: 600, h: 800 });
        const ref = await this.upload(png, once ? { once: true } : {});
        await this.send(peer, { t: 'media', media: { ...ref, mime: 'image/png', w: 600, h: 800, once: once || undefined } });
        return;
      }
      case 'album': {
        if (!this.p.album) return void (await this.send(peer, { t: 'text', text: '🔒 No private album here. Try Luca 🤖.' }));
        const items = await this.albumItems();
        await this.send(peer, { t: 'album.grant', album: this.p.handle, name: this.p.album.name, items });
        await this.send(peer, { t: 'text', text: `🔓 ${this.p.album.name}: ${items.length} photos (write revoke to take it back)` });
        return;
      }
      case 'revoke':
        await this.send(peer, { t: 'album.revoke', album: this.p.handle });
        await this.send(peer, { t: 'text', text: '🔒 Album revoked' });
        return;
      case 'location': {
        const { lat, lng } = this.p.location;
        await this.send(peer, { t: 'location.share', lat, lng, until: Date.now() + H });
        return;
      }
      case 'link': {
        const r = await this.api<{ url: string }>('POST', `/me/profiles/${this.me}/share`, {});
        await this.send(peer, { t: 'text', text: r.url });
        return;
      }
    }
  }

  // ---------------------------------------------------------------- realtime

  typing(peer: string) {
    this.chan?.push('typing', { from_profile_id: this.me, to_profile_id: peer });
  }

  connect() {
    const url = API.replace(/^http/, 'ws') + '/socket';
    const s = new Socket(url, {
      transport: globalThis.WebSocket,
      params: () => ({ token: this.auth!.access }),
      reconnectAfterMs: (n: number) => Math.min(30_000, 1000 * n),
    });
    s.onError(() => {
      this.api('GET', '/mls/keypackages').catch(() => {});
    });
    s.connect();
    const ch = s.channel('user:me', {});
    ch.on('message.new', () => void this.pull());
    ch.on('tap.new', () => void this.tapBack().catch(() => {}));
    ch.on('party.request', () => void this.party().catch(() => {}));
    ch.on('activity.join', () => void this.activity().catch(() => {}));
    ch.join().receive('ok', () => void this.pull());
    this.chan = ch;
  }
}

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Local (Zurich) date + n days, YYYY-MM-DD. */
function localDay(n: number) {
  return new Date(Date.now() + n * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
}

/** Europe/Zurich offset in minutes (+60 winter, +120 summer). */
function tzZurich() {
  const d = new Date();
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Zurich' }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local.getTime() - utc.getTime()) / 60_000);
}
