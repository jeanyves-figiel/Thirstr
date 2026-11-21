/* eslint-disable @typescript-eslint/no-require-imports */
// F-07 R-07.16–R-07.24: chat delivery on bad networks (AC-07.5 – AC-07.10).
// Alice runs the real engine against an in-memory delivery service; Bob is a raw MLS client.
// Each "device" loads its own module copies (jest.isolateModules), so a relaunch after a kill
// is a fresh engine reading the same on-device store.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type G = typeof globalThis & { __dev?: string; __stores?: Map<string, Map<string, unknown>>; __srv?: Srv };
const g = globalThis as G;

jest.mock('../src/chat/kv', () => {
  // One store per simulated device (globalThis.__dev); the data outlives the module (relaunch).
  const st = () => {
    const all = ((globalThis as G).__stores ??= new Map());
    const dev = (globalThis as G).__dev ?? 'x';
    if (!all.has(dev)) all.set(dev, new Map());
    return all.get(dev)!;
  };
  const clone = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const keys = (p: string) => [...st().keys()].filter((k) => k.startsWith(p));
  return {
    kv: {
      get: async (k: string) => (st().has(k) ? clone(st().get(k)) : null),
      set: async (k: string, v: unknown) => void st().set(k, clone(v)),
      del: async (k: string) => void st().delete(k),
      keys: async (p: string) => keys(p),
      getPrefix: async (p: string) => keys(p).map((k) => clone(st().get(k))),
      delPrefix: async (p: string) => keys(p).forEach((k) => st().delete(k)),
      wipe: async () => st().clear(),
    },
  };
});

jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    status: number;
    code: string;
    fields?: Record<string, string[]>;
    constructor(st: number, cd: string, _m?: string, f?: Record<string, string[]>) {
      super(cd);
      this.status = st;
      this.code = cd;
      this.fields = f;
    }
  }
  class TimeoutError extends Error {}
  return {
    ApiError,
    TimeoutError,
    API_BASE: 'http://test/v1',
    accessToken: async () => 't',
    api: (method: string, path: string, body?: unknown) => (globalThis as G).__srv!.call(method, path, body, ApiError, TimeoutError),
  };
});

jest.mock('../src/me/localFields', () => ({ getLocal: async () => ({}) }));

jest.mock('phoenix', () => ({
  Socket: class {
    onError() {}
    onOpen() {}
    onClose() {}
    connect() {}
    disconnect() {}
    channel() {
      return { on() {}, push() {}, join: () => ({ receive() {} }) };
    }
  },
}));

// ------------------------------------------------------------------ fake delivery service

type Env = { to_profile_id: string; to_device_id: string; kind: string; ciphertext: string; key_package_id?: number };
type Queued = { id: number; to_profile_id: string; from_profile_id: string; group_id: string; kind: string; ciphertext: string; at: string };

class Srv {
  kps = new Map<string, { id: number; device_id: string; key_package: string }[]>();
  queue: Queued[] = [];
  keys = new Map<string, unknown>();
  posts: { client_id?: string; envelopes: Env[] }[] = [];
  offline = false;
  dropResponses = 0;
  /** #206: the next app send to a 1:1 group is refused, as if a member device was deleted. */
  staleOnce = false;
  failAck = false;
  expired: { group_id: string; count: number }[] = [];
  private seq = 1;

  enqueue(from: string, group_id: string, e: Env) {
    this.queue.push({ id: this.seq++, from_profile_id: from, to_profile_id: e.to_profile_id, group_id, kind: e.kind, ciphertext: e.ciphertext, at: new Date().toISOString() });
  }

  inbox(device: string) {
    return this.queue.filter((q) => devOf(q.to_profile_id) === device);
  }

  async call(method: string, path: string, body: any, ApiError: any, TimeoutError: any): Promise<any> {
    if (this.offline) throw new TypeError('Network request failed');
    const key = `${method} ${path}`;
    if (key === 'GET /mls/keypackages') return { counts: { pa: { count: 30, last_resort: true } }, device_id: 'da' };
    if (key === 'POST /mls/keypackages') return { counts: {}, device_id: 'da' };
    if (key === 'GET /profiles/pb') return { display_name: 'Bob', age: 30, photos: [], verified: true };
    if (key === 'POST /mls/keypackages/claim') {
      const k = this.kps.get(body.to_profile_id)?.shift();
      if (!k) throw new ApiError(409, 'unavailable');
      return { key_packages: [k] };
    }
    if (key === 'POST /mls/messages') {
      this.posts.push(body);
      if (this.staleOnce && (body.envelopes as Env[]).some((e) => e.kind === 'app')) {
        this.staleOnce = false;
        throw new ApiError(422, 'validation', 'Check the highlighted fields', { to_device_id: ['unknown device'] });
      }
      if (body.client_id && this.keys.has(body.client_id)) return this.keys.get(body.client_id);
      for (const e of body.envelopes as Env[]) this.enqueue(body.from_profile_id, body.group_id, e);
      const res = { delivered: [...new Set((body.envelopes as Env[]).map((e) => e.to_profile_id))], undelivered: [] };
      if (body.client_id) this.keys.set(body.client_id, res);
      if (this.dropResponses > 0) {
        this.dropResponses--;
        throw new TimeoutError();
      }
      return res;
    }
    if (key === 'GET /mls/messages') {
      const expired = this.expired;
      this.expired = [];
      return { messages: this.inbox('da'), expired };
    }
    if (key === 'POST /mls/messages/ack') {
      if (this.failAck) throw new TypeError('Network request failed');
      this.queue = this.queue.filter((q) => !(body.ids as number[]).includes(q.id) || devOf(q.to_profile_id) !== 'da');
      return { deleted: body.ids.length };
    }
    throw new ApiError(404, 'not_found');
  }
}
const devOf = (p: string) => (p === 'pa' ? 'da' : 'db');

// ------------------------------------------------------------------ devices

type Engine = typeof import('../src/chat/engine');
type Mls = typeof import('../src/chat/mls');
type Bytes = typeof import('../src/chat/bytes');
type People = typeof import('../src/chat/people');
type FLoc = typeof import('../src/chat/friendLoc');

let run = 0;
const me = (receipts = true) => ({ id: 'acc-a', status: 'active', verified: true, profiles: [{ id: 'pa', kind: 'hookup', display_name: 'Alice' }], settings: { read_receipts: receipts } }) as never;

const alice = () => `alice${run}`;
/** Lets Alice's background work (receipts, timers) finish before another device acts. */
const settle = () => new Promise((r) => setTimeout(r, 30));

/** Loads a fresh engine for Alice (a relaunch keeps her store). */
async function launch(receipts = true): Promise<{ E: Engine; P: People; F: FLoc }> {
  g.__dev = alice();
  let E!: Engine;
  let P!: People;
  let F!: FLoc;
  jest.isolateModules(() => {
    E = require('../src/chat/engine');
    P = require('../src/chat/people');
    F = require('../src/chat/friendLoc');
  });
  await E.start(me(receipts));
  return { E, P, F };
}

/** Bob is a raw MLS client on his own store; each call runs as Bob, then hands back to Alice. */
function bobDevice() {
  const mls = require('../src/chat/mls') as Mls;
  const bytes = require('../src/chat/bytes') as Bytes;
  const as = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      await settle();
      g.__dev = `bob${run}`;
      try {
        return await fn(...a);
      } finally {
        g.__dev = alice();
      }
    };
  const self = { p: 'pb', d: 'db' };
  const got: { t: string; [k: string]: unknown }[] = [];
  return {
    got,
    /** Uploads one key package to the fake server. */
    publish: as(async () => {
      const kp = await mls.newKeyPackage(self);
      srv.kps.set('pb', [...(srv.kps.get('pb') ?? []), { id: srv.kps.size + 1, device_id: 'db', key_package: bytes.toB64(kp.wire) }]);
    }),
    /** Pulls and processes Bob's queue in server order; returns decrypted payloads. */
    pull: as(async () => {
      const mine = srv.queue.filter((q) => devOf(q.to_profile_id) === 'db');
      srv.queue = srv.queue.filter((q) => devOf(q.to_profile_id) !== 'db');
      for (const q of mine) {
        const wire = bytes.fromB64(q.ciphertext);
        const gid = bytes.hex(bytes.fromB64(q.group_id));
        if (q.kind === 'welcome') await mls.join(wire);
        else {
          const plain = await mls.open(gid, wire);
          if (plain) got.push(JSON.parse(bytes.fromUtf8(plain)));
        }
      }
      return got;
    }),
    /** Creates a 1:1 group with Alice's claimed key package and returns the welcome. */
    createWith: as(async (kp: string) => mls.createWith(self, [{ id: 1, device_id: 'da', key_package: kp, profile: 'pa' }])),
    say: as(async (gid: string, payload: object, opts: { enqueue?: boolean } = {}) => {
      const wire = { v: 1, id: bytes.hex(bytes.rand(12)), at: Date.now(), fk: bytes.toB64(bytes.rand(32)), ...payload };
      const sealed = await mls.seal(gid, bytes.utf8(JSON.stringify(wire)));
      const env = { to_profile_id: 'pa', to_device_id: 'da', kind: 'app', ciphertext: bytes.toB64(sealed.wire) };
      if (opts.enqueue !== false) srv.enqueue('pb', bytes.toB64(hexBytes(gid)), env);
      return { id: wire.id, env };
    }),
  };
}
const b64 = (b: Uint8Array) => (require('../src/chat/bytes') as Bytes).toB64(b);
const hexBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

let srv: Srv;
const engines: Engine[] = [];
beforeEach(() => {
  run++;
  srv = g.__srv = new Srv();
  g.__dev = alice();
});
afterEach(() => {
  for (const E of engines.splice(0)) E.stop();
});

async function open1to1(receipts = true) {
  const bob = bobDevice();
  await bob.publish();
  const a = await launch(receipts);
  engines.push(a.E);
  const c = await a.E.openConv('pa', 'pb');
  return { ...a, bob, cid: c.id };
}

const texts = (list: { p: { t: string; text?: string } }[]) => list.filter((m) => m.p.t === 'text').map((m) => m.p.text);

describe('R-07.17 outbox', () => {
  it('backoff: 1 s, 2 s, 4 s … capped at 60 s, ± 20 %', () => {
    const E = require('../src/chat/engine') as Engine;
    expect(E.backoff(1, 0.5)).toBe(1000);
    expect(E.backoff(3, 0.5)).toBe(4000);
    expect(E.backoff(20, 0.5)).toBe(60_000);
    expect(E.backoff(1, 0)).toBe(800);
    expect(E.backoff(1, 1)).toBeCloseTo(1200);
  });

  it('AC-07.5: written offline, app killed, relaunched online → all arrive once, in order', async () => {
    const { E, cid, bob } = await open1to1();
    srv.offline = true;
    for (const n of [1, 2, 3, 4, 5]) await E.send(cid, { t: 'text', text: `m${n}` });
    expect((await E.messages(cid)).map((m) => m.status)).toEqual(['sending', 'sending', 'sending', 'sending', 'sending']);
    expect(srv.queue).toHaveLength(0);

    E.stop(); // kill
    srv.offline = false;
    const again = await launch();
    engines.push(again.E);
    await again.E.drain();

    const got = await bob.pull();
    expect(got.map((p) => p.text)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect((await again.E.messages(cid)).map((m) => m.status)).toEqual(['sent', 'sent', 'sent', 'sent', 'sent']);
  }, 60000);
});

describe('#206 stale device in a 1:1 group', () => {
  it('rebuilds the group with current devices and sends, instead of "Not sent"', async () => {
    const { E, cid, bob } = await open1to1();
    await E.send(cid, { t: 'text', text: 'hello' }); // creates group 1
    await bob.pull();
    await bob.publish(); // a fresh key package for the new group
    srv.staleOnce = true;
    await E.send(cid, { t: 'text', text: 'after reinstall' });
    const mine = (await E.messages(cid)).find((m) => (m.p as { text?: string }).text === 'after reinstall');
    expect(mine?.status).toBe('sent');
    const welcomes = srv.posts.filter((p) => p.envelopes.some((e) => e.kind === 'welcome'));
    expect(welcomes).toHaveLength(2);
    const got = await bob.pull();
    expect(texts(got.map((p) => ({ p: p as { t: string; text?: string } })))).toContain('after reinstall');
  }, 60000);
});

describe('R-07.18 idempotent send', () => {
  it('AC-07.6: response lost → retried with the same id and ciphertext, received once', async () => {
    const { E, cid, bob } = await open1to1();
    await E.send(cid, { t: 'text', text: 'hello' }); // creates the group
    srv.dropResponses = 1;
    await E.send(cid, { t: 'text', text: 'only once' });
    expect((await E.messages(cid)).find((m) => (m.p as { text?: string }).text === 'only once')?.status).toBe('sending');

    await new Promise((r) => setTimeout(r, 1300)); // first backoff step
    await E.drain();

    const appPosts = srv.posts.filter((p) => p.client_id && p.envelopes[0].kind === 'app');
    expect(appPosts).toHaveLength(3);
    expect(appPosts[1].client_id).toBe(appPosts[2].client_id);
    expect(appPosts[1].envelopes[0].ciphertext).toBe(appPosts[2].envelopes[0].ciphertext);
    expect(texts((await bob.pull()).map((p) => ({ p })) as never)).toEqual(['hello', 'only once']);
    expect((await E.messages(cid)).map((m) => m.status)).toEqual(['sent', 'sent']);
  }, 60000);
});

describe('R-07.20 receive integrity', () => {
  it('SR-13: envelopes pushed on the socket are stored, acked, and a later pull adds nothing twice', async () => {
    const { E, cid, bob } = await open1to1();
    await E.send(cid, { t: 'text', text: 'hi' });
    await bob.pull();
    const gid = E.getConv(cid)!.groups[0];
    await bob.say(gid, { t: 'text', text: 'pushed' });
    const pushed = srv.queue.filter((q) => q.to_profile_id === 'pa').map((q) => ({ ...q }));
    expect(pushed).toHaveLength(1);
    let gets = 0;
    const call = srv.call.bind(srv);
    srv.call = (m: string, p: string, ...rest: [any, any, any]) => {
      if (m === 'GET' && p === '/mls/messages') gets++;
      return call(m, p, ...rest);
    };
    await E.receivePushed(pushed as never);
    expect(gets).toBe(0);
    expect(texts(await E.messages(cid))).toEqual(['hi', 'pushed']);
    expect(srv.queue.filter((q) => q.to_profile_id === 'pa')).toHaveLength(0);
    // the same envelope again (socket + pull race): nothing doubled
    await E.receivePushed(pushed as never);
    await E.pull();
    expect(texts(await E.messages(cid))).toEqual(['hi', 'pushed']);
    srv.call = call;
    await new Promise((r) => setTimeout(r, 300)); // let the Delivered receipt send finish on Alice's store
  }, 60000);


  it('AC-07.7: killed before the ack → after relaunch nothing missing, nothing doubled', async () => {
    const { E, cid, bob } = await open1to1();
    await E.send(cid, { t: 'text', text: 'hi' });
    await bob.pull();
    const gid = (E.getConv(cid)!.groups[0]);
    for (const t of ['a', 'b', 'c']) await bob.say(gid, { t: 'text', text: t });
    srv.failAck = true;
    await E.pull();
    expect(texts(await E.messages(cid))).toEqual(['hi', 'a', 'b', 'c']);

    E.stop(); // kill: the server still has a, b, c
    srv.failAck = false;
    const again = await launch();
    engines.push(again.E);
    await again.E.pull();
    expect(texts(await again.E.messages(cid))).toEqual(['hi', 'a', 'b', 'c']);
    expect(srv.queue.filter((q) => q.to_profile_id === 'pa')).toHaveLength(0);
  }, 60000);

  it('AC-07.10: a message that arrives before its welcome decrypts once the welcome comes', async () => {
    const bob = bobDevice();
    const a = await launch();
    engines.push(a.E);
    // Alice's key package, claimed by Bob.
    const mls = require('../src/chat/mls') as Mls;
    const kp = await mls.newKeyPackage({ p: 'pa', d: 'da' });
    const { toB64 } = require('../src/chat/bytes') as Bytes;
    const grp = await bob.createWith(toB64(kp.wire));
    const early = await bob.say(grp.groupId, { t: 'text', text: 'early bird' }, { enqueue: false });

    srv.enqueue('pb', toB64(grp.gid), early.env); // app first …
    await a.E.pull();
    expect(a.E.getConvs()).toHaveLength(0);

    srv.enqueue('pb', toB64(grp.gid), { ...grp.envelopes[0], to_profile_id: 'pa', to_device_id: 'da' }); // … welcome later
    await a.E.pull();
    expect(texts(await a.E.messages('pa:pb'))).toEqual(['early bird']);
  }, 60000);

  it('undecryptable after 24 h → visible notice instead of a silent drop; expired counts shown', async () => {
    const { E, cid } = await open1to1();
    await E.send(cid, { t: 'text', text: 'hi' });
    const gid = E.getConv(cid)!.groups[0];
    srv.enqueue('pb', b64(hexBytes(gid)), { to_profile_id: 'pa', to_device_id: 'da', kind: 'app', ciphertext: b64(new TextEncoder().encode('garbage')) });
    await E.pull();
    expect(texts(await E.messages(cid))).toEqual(['hi']);

    // A day later.
    const kvMod = g.__stores!.get(`alice${run}`)!;
    const pending = kvMod.get('pending') as { first: number }[];
    expect(pending).toHaveLength(1);
    kvMod.set('pending', pending.map((p) => ({ ...p, first: Date.now() - 25 * 3600_000 })));
    srv.kps.set('pb', []); // re-sync can't reach Bob right now: stays queued, notice still shown
    srv.expired = [{ group_id: b64(hexBytes(gid)), count: 3 }];
    await E.pull();
    const notices = (await E.messages(cid)).filter((m) => m.p.t === 'notice').map((m) => m.p as { kind: string; n?: number });
    expect(notices).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'undecryptable' }), expect.objectContaining({ kind: 'expired', n: 3 })]));
    expect(kvMod.get('pending')).toEqual([]);
  }, 60000);
});

describe('R-07.16 / R-07.23 receipts', () => {
  it('on: Delivered then Read flow back; ticks only move forward', async () => {
    const { E, cid, bob } = await open1to1();
    const mine = await E.send(cid, { t: 'text', text: 'hey' });
    await bob.pull();
    const gid = E.getConv(cid)!.groups[0];
    await bob.say(gid, { t: 'text', text: 'yo' });
    await E.pull();
    await E.markRead(cid);
    await new Promise((r) => setTimeout(r, 50));
    const types = (await bob.pull()).map((p) => p.t);
    expect(types).toEqual(expect.arrayContaining(['delivered', 'read']));

    await bob.say(gid, { t: 'read', upTo: mine!.id });
    await E.pull();
    expect((await E.messages(cid)).find((m) => m.id === mine!.id)?.status).toBe('read');
    await bob.say(gid, { t: 'delivered', upTo: mine!.id });
    await E.pull();
    expect((await E.messages(cid)).find((m) => m.id === mine!.id)?.status).toBe('read');
  }, 60000);

  it('AC-07.8: off (global or this chat) → none sent, none shown', async () => {
    for (const mode of ['global', 'chat'] as const) {
      run++;
      srv = g.__srv = new Srv();
      g.__dev = alice();
      const { E, cid, bob } = await open1to1(mode !== 'global');
      if (mode === 'chat') await E.setConv(cid, { receipts: 'off' });
      const mine = await E.send(cid, { t: 'text', text: 'hey' });
      await bob.pull();
      const gid = E.getConv(cid)!.groups[0];
      await bob.say(gid, { t: 'text', text: 'yo' });
      await bob.say(gid, { t: 'read', upTo: mine!.id });
      await E.pull();
      await E.markRead(cid);
      await new Promise((r) => setTimeout(r, 50));
      expect((await bob.pull()).map((p) => p.t)).toEqual(['text']);
      expect((await E.messages(cid)).find((m) => m.id === mine!.id)?.status).toBe('sent');
      E.stop();
    }
  }, 60000);
});

describe('R-07.21 local store', () => {
  it('AC-07.9: keeps 2,000 messages, migrates the old capped blob, orders by time', async () => {
    g.__dev = `store${run}`;
    const store = require('../src/chat/store') as typeof import('../src/chat/store');
    const { kv } = require('../src/chat/kv') as typeof import('../src/chat/kv');
    store.reset();
    await kv.set(
      'msgs:c1',
      Array.from({ length: 500 }, (_, i) => ({ id: `old${i}`, at: i })),
    );
    for (let i = 0; i < 2000; i++) await store.put('c1', { id: `n${i}`, at: 1000 + i });
    const all = await store.all('c1');
    expect(all).toHaveLength(2500);
    expect(all[0].id).toBe('old0');
    expect(all[2499].id).toBe('n1999');
    expect(await kv.get('msgs:c1')).toBeNull();
    // Concurrent writers to one chat don't lose each other's rows.
    await Promise.all(Array.from({ length: 50 }, (_, i) => store.lock('c:c2', () => store.put('c2', { id: `x${i}`, at: i }))));
    expect(await store.all('c2')).toHaveLength(50);
  }, 60000);
});

describe('#115 friends travel only inside the E2EE chat (R-07.36)', () => {
  it('AC-07.17: request → accept makes both friends; the server only sees ciphertext', async () => {
    const { E, P, cid, bob } = await open1to1();
    await E.send(cid, { t: 'text', text: 'hey' });
    await bob.pull();
    await E.requestFriend(cid);
    expect(P.friendOf('pb')).toBe('out');
    const got = await bob.pull();
    expect(got.filter((x) => x.t === 'friend').map((x) => x.op)).toEqual(['request']);
    for (const q of srv.queue) expect(JSON.stringify(q)).not.toMatch(/friend/);

    const gid = E.getConv(cid)!.groups[0];
    await bob.say(gid, { t: 'friend', op: 'accept' });
    await E.pull();
    expect(P.friendOf('pb')).toBe('yes');
    const rows = (await E.messages(cid)).filter((m) => m.p.t === 'friend').map((m) => (m.p as { op: string }).op);
    expect(rows).toEqual(['request', 'accept']);

    // Remove is quiet: no row on either side, state gone.
    await bob.say(gid, { t: 'friend', op: 'remove' });
    await E.pull();
    expect(P.friendOf('pb')).toBeNull();
    expect((await E.messages(cid)).filter((m) => m.p.t === 'friend')).toHaveLength(2);
  }, 60000);

  it('incoming request: Not now sends a quiet decline; the asker can ask again after 7 days', async () => {
    const { E, P, cid, bob } = await open1to1();
    await E.send(cid, { t: 'text', text: 'hi' });
    await bob.pull();
    const gid = E.getConv(cid)!.groups[0];
    await bob.say(gid, { t: 'friend', op: 'request' });
    await E.pull();
    expect(P.friendOf('pb')).toBe('in');
    await E.answerFriend(cid, false);
    expect(P.friendOf('pb')).toBeNull();
    const got = await bob.pull();
    expect(got.filter((x) => x.t === 'friend').map((x) => x.op)).toEqual(['decline']);
    // The decline is not a visible row for Alice.
    expect((await E.messages(cid)).filter((m) => m.p.t === 'friend').map((m) => (m.p as { op: string }).op)).toEqual(['request']);
  }, 60000);

  it('#247 friend location is silent, kept only for friends, and stop forgets it', async () => {
    const { E, P, F, cid, bob } = await open1to1();
    await E.send(cid, { t: 'text', text: 'hey' });
    await bob.pull();
    const gid = E.getConv(cid)!.groups[0];
    const until = Date.now() + 3600_000;
    // Not a friend yet: ignored.
    await bob.say(gid, { t: 'friend.loc', lat: 47.37694, lng: 8.54172, until });
    await E.pull();
    expect(F.shown()).toHaveLength(0);
    await bob.say(gid, { t: 'friend', op: 'request' });
    await E.pull();
    await E.answerFriend(cid, true);
    expect(P.friendOf('pb')).toBe('yes');
    await bob.say(gid, { t: 'friend.loc', lat: 47.37694, lng: 8.54172, until });
    await E.pull();
    expect(F.shown()).toEqual([{ peer: 'pb', lat: 47.377, lng: 8.542, until, at: expect.any(Number) }]);
    expect((await E.messages(cid)).some((m) => m.p.t === 'friend.loc')).toBe(false);
    for (const q of srv.queue) expect(JSON.stringify(q)).not.toMatch(/47\.37|friend/);
    await bob.say(gid, { t: 'friend.loc', stop: true });
    await E.pull();
    expect(F.shown()).toHaveLength(0);
  }, 60000);

  it('a starred 1:1 chat migrates to a favorite of its peer', async () => {
    const { E, cid } = await open1to1();
    await E.send(cid, { t: 'text', text: 'hey' });
    await E.setConv(cid, { starred: true });
    E.stop();
    const again = await launch();
    engines.push(again.E);
    expect(again.P.isFav('pb')).toBe(true);
    expect(again.E.getConv(cid)!.starred).toBeUndefined();
  }, 60000);
});
