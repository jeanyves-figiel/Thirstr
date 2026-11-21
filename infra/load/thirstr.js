// SR-12 (#152): k6 load test. Run against a dedicated load env only (dev routes on), never prod.
//   k6 run -e BASE=https://load.example -e GRID_RPS=200 -e MSG_RPS=200 -e SOCKETS=2000 thirstr.js   (users.json: see README.md)
// Targets (testing.md, ops.md): grid p95 < 300 ms, message send p95 < 500 ms, 0.1 % errors.
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import encoding from 'k6/encoding';
import crypto from 'k6/crypto';

const BASE = __ENV.BASE || 'http://localhost:4000';
const GRID_RPS = +(__ENV.GRID_RPS || 50);
const MSG_RPS = +(__ENV.MSG_RPS || 50);
const SOCKETS = +(__ENV.SOCKETS || 100);
const DURATION = __ENV.DURATION || '5m';
// Accounts from `Thirstr.LoadTest.users(n)` (verified, located near the seeded city centres).
// Access tokens live 15 min: generate the file right before a run.
const USERS = JSON.parse(open(__ENV.USERS_FILE || './users.json'));
const sendLatency = new Trend('msg_send_ms', true);
const e2eLatency = new Trend('msg_send_to_pull_ms', true);
const delivered = new Counter('msg_delivered');

export const options = {
  scenarios: {
    grid: { executor: 'constant-arrival-rate', exec: 'grid', rate: GRID_RPS, timeUnit: '1s', duration: DURATION, preAllocatedVUs: Math.max(10, GRID_RPS), maxVUs: GRID_RPS * 4 },
    chat: { executor: 'constant-arrival-rate', exec: 'chat', rate: MSG_RPS, timeUnit: '1s', duration: DURATION, preAllocatedVUs: Math.max(10, MSG_RPS), maxVUs: MSG_RPS * 4 },
    sockets: { executor: 'per-vu-iterations', exec: 'socket', vus: SOCKETS, iterations: 1, maxDuration: DURATION },
  },
  thresholds: {
    'http_req_duration{name:grid}': ['p(95)<300'],
    'http_req_duration{name:grid_page2}': ['p(95)<300'],
    'http_req_duration{name:send}': ['p(95)<500'],
    http_req_failed: ['rate<0.001'],
  },
};

const json = (r) => {
  try {
    return r.json();
  } catch (_) {
    return {};
  }
};
const hdr = (u) => ({ headers: { authorization: `Bearer ${u.token}`, 'content-type': 'application/json', 'x-thirstr-install': `k6-install-${u.i}-0000000000` } });
const b64 = (n) => encoding.b64encode(crypto.randomBytes(n), 'std');

export function setup() {
  if (USERS.length < 2 || USERS.length % 2) throw new Error('users.json: need an even number of users (i chats with i ^ 1)');
  return { users: USERS };
}

const pick = (d) => d.users[Math.floor(Math.random() * d.users.length)];

export function grid(d) {
  const u = pick(d);
  const r = http.get(`${BASE}/v1/explore/grid?mode=hookup`, Object.assign(hdr(u), { tags: { name: 'grid' } }));
  check(r, { 'grid 200': (x) => x.status === 200 });
  const next = json(r).next;
  if (next) {
    const r2 = http.get(`${BASE}/v1/explore/grid?mode=hookup&cursor=${next}`, Object.assign(hdr(u), { tags: { name: 'grid_page2' } }));
    check(r2, { 'grid page 2 200': (x) => x.status === 200 });
  }
}

export function chat(d) {
  const a = pick(d);
  const b = d.users[a.i ^ 1];
  const body = {
    from_profile_id: a.pid,
    client_id: `k6${Date.now()}${Math.floor(Math.random() * 1e9)}`,
    group_id: b64(32),
    envelopes: [{ to_profile_id: b.pid, to_device_id: b.device, kind: 'app', ciphertext: b64(256) }],
  };
  const t0 = Date.now();
  const r = http.post(`${BASE}/v1/mls/messages`, JSON.stringify(body), Object.assign(hdr(a), { tags: { name: 'send' } }));
  sendLatency.add(Date.now() - t0);
  check(r, { 'send 200': (x) => x.status === 200 });
  // recipient side: pull + ack (what the app does after the content-free socket event)
  const p = http.get(`${BASE}/v1/mls/messages?after=0`, Object.assign(hdr(b), { tags: { name: 'pull' } }));
  const ids = (json(p).messages || []).map((m) => m.id);
  if (ids.length) {
    e2eLatency.add(Date.now() - t0);
    delivered.add(ids.length);
    http.post(`${BASE}/v1/mls/messages/ack`, JSON.stringify({ ids }), Object.assign(hdr(b), { tags: { name: 'ack' } }));
  }
}

export function socket(d) {
  const u = d.users[__VU % d.users.length];
  const url = `${BASE.replace(/^http/, 'ws')}/socket/websocket?vsn=2.0.0&token=${u.token}`;
  let ref = 1;
  ws.connect(url, {}, (s) => {
    s.on('open', () => {
      s.send(JSON.stringify(['1', String(ref++), 'user:me', 'phx_join', {}]));
      s.setInterval(() => s.send(JSON.stringify([null, String(ref++), 'phoenix', 'heartbeat', {}])), 30000);
    });
    s.setTimeout(() => s.close(), 1000 * (+(__ENV.SOCKET_HOLD_S) || 240));
  });
  sleep(1);
}
