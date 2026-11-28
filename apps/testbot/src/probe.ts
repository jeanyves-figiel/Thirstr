// EN-23 OB-2 (#343): synthetic end-to-end chat probe. Two hidden probe accounts (probe_a,
// probe_b) act as real MLS clients (the app's mls.ts) against one environment:
//   send      A posts one encrypted 16-byte nonce (POST time)
//   socket    B's live device receives it on the socket and decrypts it (since A started sending)
//   ack       B acks over the channel (reply time)
//   reply     B answers, A pulls until it has decrypted the answer (round trip)
//   duplicate A repeats the send with the same client_id: same answer, nothing new reaches B
//   pull      B's offline device pulls over REST, decrypts the nonce, acks
// Fresh devices every run, nothing kept. Reports to POST /v1/probe/report and writes the result
// as JSON to PROBE_OUT (read by the on-call runner, rule type "probe").
//   API_URL=https://staging.thirstr.fun PROBE_KEY=… PROBE_OUT=probe-staging.json node dist/probe.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Socket } from 'phoenix';
import * as mls from '../../mobile/src/chat/mls';
import { fromB64, fromUtf8, hex, rand, toB64, utf8 } from '../../mobile/src/chat/bytes';

const API = (process.env.API_URL ?? 'https://staging.thirstr.fun').replace(/\/$/, '');
const KEY = process.env.PROBE_KEY ?? '';
const OUT = process.env.PROBE_OUT ?? '';
const STEP_MS = Number(process.env.PROBE_STEP_MS ?? 15_000);

type Step = 'send' | 'socket' | 'ack' | 'reply' | 'duplicate' | 'pull' | 'total';
type Sess = { access_token: string; device_id: string };
type Incoming = { id: number; from_profile_id: string; group_id: string; kind: string; ciphertext: string };
type Push = { event: string; payload: { messages?: Incoming[] } };

const steps: Partial<Record<Step, number | null>> = {};
const now = () => performance.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class StepError extends Error {
  constructor(
    public step: Step,
    msg: string,
  ) {
    super(`${step}: ${msg}`);
  }
}

// Each device keeps its MLS state in its own store (the shared kv reads BOT_DATA_DIR per call).
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
for (const r of ['a', 'b1', 'b2']) fs.mkdirSync(path.join(base, r, 'kv'), { recursive: true });
const as = (role: string) => (process.env.BOT_DATA_DIR = path.join(base, role));

async function http(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(API + '/v1' + p, {
    method,
    headers: { 'content-type': 'application/json', 'x-thirstr-platform': 'web', 'user-agent': 'thirstr-probe/1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(STEP_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → HTTP ${res.status}`);
  return text ? JSON.parse(text) : undefined;
}
const api = (s: Sess, method: string, p: string, body?: unknown) => http(method, p, body, { authorization: 'Bearer ' + s.access_token });

async function keyPackages(role: string, s: Sess, profile: string) {
  as(role);
  const kp = toB64((await mls.newKeyPackage({ p: profile, d: s.device_id })).wire);
  await api(s, 'POST', '/mls/keypackages', { profile_id: profile, key_packages: [kp], reset: true });
}

/** Socket for B's live device: resolves with a queue of pushes (`message.env` / `message.pull`). */
function connect(s: Sess): Promise<{ next: (ms: number) => Promise<Push | null>; ack: (ids: number[]) => Promise<void>; close: () => void }> {
  const sock = new Socket(API.replace(/^http/, 'ws') + '/socket', { transport: globalThis.WebSocket, params: { token: s.access_token }, reconnectAfterMs: () => 60_000 });
  const queue: Push[] = [];
  let wake: (() => void) | null = null;
  sock.connect();
  const ch = sock.channel('user:me', { env: true });
  for (const event of ['message.env', 'message.pull']) ch.on(event, (payload) => (queue.push({ event, payload }), wake?.()));
  const next = async (ms: number) => {
    const until = Date.now() + ms;
    while (!queue.length && Date.now() < until) await new Promise<void>((r) => ((wake = r), setTimeout(r, Math.min(250, until - Date.now()))));
    return queue.shift() ?? null;
  };
  const ack = (ids: number[]) =>
    new Promise<void>((ok, ko) => {
      ch.push('ack', { ids }, STEP_MS)
        .receive('ok', () => ok())
        .receive('error', () => ko(new Error('ack error')))
        .receive('timeout', () => ko(new Error('ack timeout')));
    });
  return new Promise((ok, ko) => {
    ch.join(STEP_MS)
      .receive('ok', () => ok({ next, ack, close: () => sock.disconnect() }))
      .receive('error', () => ko(new Error('join error')))
      .receive('timeout', () => ko(new Error('join timeout')));
  });
}

/** Decrypts one incoming envelope as `role`: welcome → joins, app → payload. */
async function openAs(role: string, m: Incoming): Promise<Record<string, unknown> | 'welcome' | null> {
  as(role);
  if (m.kind === 'welcome') return (await mls.join(fromB64(m.ciphertext))) ? 'welcome' : null;
  const pt = await mls.open(hex(fromB64(m.group_id)), fromB64(m.ciphertext)).catch(() => null);
  return pt ? JSON.parse(fromUtf8(pt)) : null;
}

const payload = (nonce: string) => utf8(JSON.stringify({ t: 'probe', nonce, v: 1, id: hex(rand(12)), at: Date.now() }));

async function run() {
  const t0 = now();
  if (KEY.length < 32) throw new StepError('send', 'PROBE_KEY missing');
  const A = await http('POST', '/probe/session', { handle: 'probe_a' }, { 'x-probe-key': KEY });
  const B = await http('POST', '/probe/session', { handle: 'probe_b', devices: 2 }, { 'x-probe-key': KEY });
  const a: Sess = A.sessions[0];
  const [b1, b2]: Sess[] = B.sessions;
  await keyPackages('b1', b1, B.profile_id);
  await keyPackages('b2', b2, B.profile_id);
  await keyPackages('a', a, A.profile_id);
  const live = await connect(b1);

  try {
    // A starts the chat: claim B's two devices, welcome both.
    as('a');
    const claimed = await api(a, 'POST', '/mls/keypackages/claim', { from_profile_id: A.profile_id, to_profile_id: B.profile_id });
    const g = await mls.createWith({ p: A.profile_id, d: a.device_id }, claimed.key_packages.map((k: object) => ({ ...k, profile: B.profile_id })));
    await api(a, 'POST', '/mls/messages', { from_profile_id: A.profile_id, group_id: toB64(g.gid), envelopes: g.envelopes });

    // B1 joins from the welcome it gets on the socket.
    const w = await live.next(STEP_MS);
    if (!w) throw new StepError('socket', 'no welcome on the socket');
    const wm = w.event === 'message.env' ? (w.payload.messages ?? []) : (await api(b1, 'GET', '/mls/messages')).messages;
    for (const m of wm) await openAs('b1', m);
    await live.ack(wm.map((m: Incoming) => m.id));

    // send → socket → ack
    const nonce = hex(rand(16));
    as('a');
    const sealed = await mls.seal(g.groupId, payload(nonce));
    const body = {
      client_id: 'probe' + hex(rand(10)),
      from_profile_id: A.profile_id,
      group_id: toB64(g.gid),
      envelopes: sealed.members.filter((m) => m.p !== A.profile_id).map((m) => ({ to_profile_id: m.p, to_device_id: m.d, kind: 'app', ciphertext: toB64(sealed.wire) })),
    };
    const ts = now();
    const first = await api(a, 'POST', '/mls/messages', body).catch((e) => {
      throw new StepError('send', String(e.message));
    });
    steps.send = Math.round(now() - ts);
    if (!first.delivered?.includes(B.profile_id)) throw new StepError('send', 'not delivered to probe_b');

    let got: Incoming | null = null;
    while (!got) {
      const p = await live.next(Math.max(0, STEP_MS - (now() - ts)));
      if (!p) throw new StepError('socket', `nonce not received on the socket in ${STEP_MS} ms`);
      const msgs = p.event === 'message.env' ? (p.payload.messages ?? []) : (await api(b1, 'GET', '/mls/messages')).messages;
      for (const m of msgs) {
        const o = await openAs('b1', m);
        if (o && o !== 'welcome' && o.nonce === nonce) got = m;
      }
    }
    steps.socket = Math.round(now() - ts);
    const ta = now();
    await live.ack([got.id]).catch((e) => {
      throw new StepError('ack', String(e.message));
    });
    steps.ack = Math.round(now() - ta);

    // B replies, A pulls it (REST) and decrypts.
    const reply = hex(rand(16));
    as('b1');
    const rs = await mls.seal(g.groupId, payload(reply));
    const tr = now();
    await api(b1, 'POST', '/mls/messages', {
      from_profile_id: B.profile_id,
      group_id: toB64(g.gid),
      envelopes: rs.members.filter((m) => m.p !== B.profile_id).map((m) => ({ to_profile_id: m.p, to_device_id: m.d, kind: 'app', ciphertext: toB64(rs.wire) })),
    });
    let back = false;
    while (!back) {
      if (now() - tr > STEP_MS) throw new StepError('reply', 'reply not pulled by probe_a');
      const r = await api(a, 'GET', '/mls/messages');
      for (const m of r.messages as Incoming[]) {
        const o = await openAs('a', m);
        if (o && o !== 'welcome' && o.nonce === reply) back = true;
      }
      if (r.messages.length) await api(a, 'POST', '/mls/messages/ack', { ids: r.messages.map((m: Incoming) => m.id) });
      if (!back) await sleep(200);
    }
    steps.reply = Math.round(now() - tr);

    // Duplicate: same client_id → same answer, nothing new on B's socket.
    const td = now();
    const again = await api(a, 'POST', '/mls/messages', body);
    steps.duplicate = Math.round(now() - td); // repeat answer time; then 3 s quiet on B's socket
    if (JSON.stringify(again) !== JSON.stringify(first)) throw new StepError('duplicate', 'repeat answered differently');
    const extra = await live.next(3000);
    if (extra?.event === 'message.env' && extra.payload.messages?.length) throw new StepError('duplicate', 'repeat delivered twice');

    // Offline device: REST pull has the welcome and the nonce.
    const tp = now();
    const pulled = (await api(b2, 'GET', '/mls/messages')).messages as Incoming[];
    let found = false;
    for (const m of pulled) {
      const o = await openAs('b2', m);
      if (o && o !== 'welcome' && o.nonce === nonce) found = true;
    }
    if (!found) throw new StepError('pull', 'nonce missing on the offline device');
    await api(b2, 'POST', '/mls/messages/ack', { ids: pulled.map((m) => m.id) });
    steps.pull = Math.round(now() - tp);
    steps.total = Math.round(now() - t0);
  } finally {
    live.close();
  }
}

let ok = true;
let failed: Step | null = null;
let error = '';
try {
  await run();
} catch (e) {
  ok = false;
  failed = e instanceof StepError ? e.step : (['send', 'socket', 'ack', 'reply', 'duplicate', 'pull'] as Step[]).find((s) => !(s in steps)) ?? 'send';
  error = e instanceof Error ? e.message : String(e);
}
const result = { env: API, at: new Date().toISOString(), ok, failed, error, steps };
console.log(JSON.stringify(result));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(result));
await http('POST', '/probe/report', { ok, failed, steps }, { 'x-probe-key': KEY }).catch((e) => console.error('report failed:', e.message));
fs.rmSync(base, { recursive: true, force: true });
process.exit(0);
