// Test peer for e2e.test.ts: a second MLS client (the app's mls.ts) that chats with a bot through
// the mock server and prints every decrypted payload as JSON lines. Opens shared photos/albums.
// PARTY=<id>: asks to join the bot's party, waits for the group chat and writes in it.
import { gcm } from '@noble/ciphers/aes.js';
import * as mls from '../../mobile/src/chat/mls';
import { fromB64, fromUtf8, hex, rand, toB64, utf8 } from '../../mobile/src/chat/bytes';

const API = process.env.API_URL!;
const BOT = process.env.BOT_PROFILE!;
const texts = (process.env.TEXTS ?? '').split('|').filter(Boolean);
const waitMs = Number(process.env.WAIT_MS ?? 12_000);
const ME = 'PEER';
// each run is a fresh install: a new device of the same person (mockServer replaces the old one)
const TOKEN = 'peer-' + hex(rand(6));

const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(API + '/v1' + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}`);
  return r.json();
};
const out = (x: unknown) => console.log(JSON.stringify(x));

async function opens(ref: { blob: string; key: string; iv: string }) {
  const { url } = await api('GET', '/media/' + ref.blob);
  const ct = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const png = gcm(fromB64(ref.key), fromB64(ref.iv)).decrypt(ct);
  return png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47; // "PNG"
}

const { device_id: dev } = await api('GET', '/mls/keypackages');
// own key packages so a host can add us to a group chat
const fresh: string[] = [];
for (let i = 0; i < 3; i++) fresh.push(toB64((await mls.newKeyPackage({ p: ME, d: dev })).wire));
await api('POST', '/mls/keypackages', { profile_id: ME, key_packages: fresh, reset: true });

let groupCtx: { gid: string; ctx: string } | null = null;

async function drain(stop: (p: any) => boolean) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const r = await api('GET', '/mls/messages');
    let done = false;
    for (const m of r.messages) {
      // Shared device queue: a bot may still write to an earlier peer run (Ghost's icebreaker,
      // late replies). Those welcomes / ciphertexts are not for this run's keys: skip them.
      if (m.kind === 'welcome') {
        const j = await mls.join(fromB64(m.ciphertext)).catch(() => null);
        if (j?.ctx) {
          groupCtx = { gid: j.groupId, ctx: j.ctx };
          out({ got: 'welcome', ctx: j.ctx });
          if (stop({ t: 'welcome' })) done = true;
        }
        continue;
      }
      const pt = await mls.open(hex(fromB64(m.group_id)), fromB64(m.ciphertext)).catch(() => null);
      if (!pt) continue;
      const p = JSON.parse(fromUtf8(pt));
      const line: Record<string, unknown> = { got: p.t, text: p.text, k: p.k, n: p.n, group: !!p.n };
      if (p.t === 'media') Object.assign(line, { opens: await opens(p.media), once: !!p.media.once });
      if (p.t === 'album.grant') Object.assign(line, { items: p.items.length, opens: await opens(p.items[0]) });
      if (p.t === 'location.share') Object.assign(line, { lat: p.lat });
      out(line);
      if (stop(p)) done = true;
    }
    if (r.messages.length) await api('POST', '/mls/messages/ack', { ids: r.messages.map((m: { id: number }) => m.id) });
    if (done) return;
    await new Promise((res) => setTimeout(res, 300));
  }
}

async function sealAndSend(gid: string, gidBytes: Uint8Array, p: object, ctx?: string) {
  const plain = utf8(JSON.stringify({ ...p, v: 1, id: hex(rand(12)), at: Date.now(), fk: toB64(rand(32)) }));
  const s = await mls.seal(gid, plain);
  const to = s.members.filter((m) => m.p !== ME);
  await api('POST', '/mls/messages', { from_profile_id: ME, group_id: toB64(gidBytes), context: ctx, envelopes: to.map((m) => ({ to_profile_id: m.p, to_device_id: m.d, kind: 'app', ciphertext: toB64(s.wire) })) });
}

if (texts.length) {
  const claimed = await api('POST', '/mls/keypackages/claim', { from_profile_id: ME, to_profile_id: BOT });
  const g = await mls.createWith({ p: ME, d: dev }, claimed.key_packages.map((k: object) => ({ ...k, profile: BOT })));
  await api('POST', '/mls/messages', { from_profile_id: ME, group_id: toB64(g.gid), envelopes: g.envelopes });
  for (const text of texts) {
    await sealAndSend(g.groupId, g.gid, { t: 'text', text });
    out({ sent: text });
    await drain((p) => ['text', 'quick_reply', 'media', 'album.grant', 'location.share'].includes(p.t) && !(p.t === 'text' && /^🔓/.test(p.text)));
  }
}

if (process.env.PARTY) {
  await api('POST', `/parties/${process.env.PARTY}/request`, {});
  out({ requested: process.env.PARTY });
  await drain((p) => p.t === 'welcome');
  if (groupCtx) {
    const { gid, ctx } = groupCtx as { gid: string; ctx: string };
    await sealAndSend(gid, Uint8Array.from(gid.match(/../g)!.map((x) => parseInt(x, 16))), { t: 'text', text: 'Salut tout le monde', n: 'Peer', g: 'x' }, ctx);
    out({ sent: 'group' });
    await drain((p) => p.t === 'text' && !!p.n);
  }
}
process.exit(0);
