// End to end (testing.md › Chat test bots): the built bots and a second client (the app's MLS
// code) talk through a mock API. Checks E2EE join, receipts, replies, language switch, generated
// photos, encrypted photos and albums the peer can open, and the party guest group chat.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from './mockServer.ts';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const KEY = 'k'.repeat(32);
let srv: Awaited<ReturnType<typeof start>>;
let bot: ChildProcess;
let botLog = '';

before(async () => {
  if (!fs.existsSync(path.join(root, 'dist/peer.mjs'))) execFileSync('node', ['build.mjs'], { cwd: root });
  srv = await start(KEY);
  const botDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-'));
  bot = spawn('node', ['dist/bot.mjs'], {
    cwd: root,
    env: { ...process.env, API_URL: srv.url, TESTBOT_KEY: KEY, BOT_DATA_DIR: botDir, BOT_POLL_MS: '300', BOT_SCENE_MS: '500', BOTS: 'testbot,luca,tiago,remi,ghost' },
  });
  bot.stdout!.on('data', (d) => (botLog += d));
  bot.stderr!.on('data', (d) => (botLog += d));
  for (let i = 0; i < 300 && !botLog.includes('test bots up'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(botLog, /test bots up: testbot, luca, tiago, remi, ghost/, botLog);
});

after(() => {
  bot.kill();
  srv.close();
});

async function peer(env: Record<string, string>) {
  // async: the mock server runs in this process, so a sync child would block it
  const p = spawn('node', [path.join(root, 'dist/peer.mjs')], { env: { ...process.env, API_URL: srv.url, BOT_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'peer-')), WAIT_MS: '15000', ...env } });
  let out = '';
  let err = '';
  p.stdout!.on('data', (d) => (out += d));
  p.stderr!.on('data', (d) => (err += d));
  await new Promise((r) => p.on('exit', r));
  assert.ok(out.trim(), err);
  return out.trim().split('\n').map((l) => JSON.parse(l));
}

test('setup through the public API: persona, location modes, photos, Now, party', async () => {
  // setup jobs run in the background after start: give them a moment
  for (let i = 0; i < 100; i++) {
    const done = srv.calls.filter((c) => /photos\/\w+\/check/.test(c.route)).length >= 2 + 5 + 3 + 3 + 1 && Object.keys(srv.parties).length;
    if (done && srv.calls.some((c) => c.who === 'BOT-GHOST' && c.route === 'PUT /v1/me/location') && srv.calls.some((c) => c.route === 'POST /v1/trips')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const who = (p: string) => srv.calls.filter((c) => c.who === p);
  const session = srv.calls.find((c) => c.route === 'POST /v1/testbot/session' && c.body.handle === 'luca')!;
  assert.equal(session.body.name, 'Luca 🤖');
  // Testbot keeps the server-side area cell, the others set their own location
  assert.ok(srv.calls.some((c) => c.body.handle === 'testbot' && c.body.server_location));
  const luca = who('BOT-LUCA').map((c) => c.route);
  assert.ok(luca.includes('PUT /v1/me/pin'), 'exact pin');
  assert.equal(luca.filter((r) => /photos\/\w+\/check/.test(r)).length, 5, '5 photos');
  assert.ok(luca.includes('PUT /v1/me/now'));
  const ghostLoc = who('BOT-GHOST').find((c) => c.route === 'PUT /v1/me/location')!;
  assert.equal(ghostLoc.body.level, 'hidden');
  const png = srv.blobs[Object.keys(srv.blobs).find((k) => k.startsWith('/s3/public/'))!];
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(Object.keys(srv.parties).length, 1);
  const trip = srv.calls.find((c) => c.who === 'BOT-TIAGO' && c.route === 'POST /v1/trips')!;
  assert.equal(trip.body.city_id, 7);
  assert.equal(who('BOT-TIAGO').find((c) => c.route === 'PUT /v1/me/location')!.body.level, 'city');
});

test('Testbot: Delivered + Read, German, then Portuguese, quick reply with k', async () => {
  const lines = await peer({ BOT_PROFILE: 'BOT-TESTBOT', TEXTS: 'hallo|lang pt|quick' });
  const texts = lines.filter((l) => l.got === 'text').map((l) => l.text as string);
  assert.ok(lines.some((l) => l.got === 'delivered'), 'Delivered receipt');
  assert.ok(lines.some((l) => l.got === 'read'), 'Read receipt');
  assert.match(texts[0], /Hey!|Schön|Altstetten|Klingt|Lust|Testbot|Wetter/);
  assert.match(texts[1], /Oi!|você/);
  assert.ok(lines.some((l) => l.got === 'quick_reply' && Number.isInteger(l.k)), 'quick reply with k');
});

test('lost tokens: the bot resumes the same device and the chat keeps working', async () => {
  srv.expire('BOT-TESTBOT');
  const lines = await peer({ BOT_PROFILE: 'BOT-TESTBOT', TEXTS: 'status' });
  assert.ok(lines.some((l) => l.got === 'text'), JSON.stringify(lines));
  const s = srv.calls.filter((c) => c.route === 'POST /v1/testbot/session' && c.body.handle === 'testbot');
  assert.equal(s.at(-1)!.body.resume, true, 'resumed, not a new device');
});

test('Luca: Italian, photo, view-once photo, private album and live location the peer can open', async () => {
  const lines = await peer({ BOT_PROFILE: 'BOT-LUCA', TEXTS: 'ciao|photo|once|album|location' });
  assert.match(lines.find((l) => l.got === 'text')!.text, /Ciao|Altstetten|bello|bere|bot|Zurigo/);
  const media = lines.filter((l) => l.got === 'media');
  assert.equal(media.length, 2);
  assert.ok(media.every((m) => m.opens), 'photos decrypt to PNG');
  assert.deepEqual(
    media.map((m) => m.once),
    [false, true],
  );
  const album = lines.find((l) => l.got === 'album.grant')!;
  assert.equal(album.items, 4);
  assert.ok(album.opens, 'album item decrypts');
  assert.ok(lines.some((l) => l.got === 'location.share'));
});

test('Rémi: accepts the party request and answers in the guest group chat', async () => {
  const id = Object.keys(srv.parties)[0];
  const lines = await peer({ BOT_PROFILE: 'BOT-REMI', PARTY: id });
  assert.ok(lines.some((l) => l.got === 'welcome' && l.ctx === 'party:' + id), JSON.stringify(lines));
  assert.ok(lines.some((l) => l.got === 'text' && l.n === 'Rémi 🤖'), JSON.stringify(lines));
});
