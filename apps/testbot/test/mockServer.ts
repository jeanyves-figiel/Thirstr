// Minimal stand-in for the Thirstr API (server/lib/thirstr/*.ex) for e2e.test.ts: bot sessions,
// key packages, per-device ciphertext queues, blobs, photos, location, Now, plans, parties,
// activities, taps, share links. Ciphertext and blobs are opaque here too.
import http from 'node:http';

type Kp = { id: number; device: string; kp: string; lr: boolean };
type Msg = { id: number; to_profile_id: string; from_profile_id: string; group_id: string; kind: string; ciphertext: string; at: string };

export function start(key: string) {
  // token → user. Bots get "bot-<handle>", the test peer uses "peer".
  const users: Record<string, { profile: string; device: string; name: string }> = {};
  // devices that exist server-side; a new peer run replaces the earlier peer device (a reinstall)
  const devices = new Set<string>();
  const kps: Record<string, Kp[]> = {};
  const queues: Record<string, Msg[]> = {};
  const blobs: Record<string, Buffer> = {};
  const calls: { route: string; who: string; body: any }[] = [];
  const parties: Record<string, { host: string; title: string; requests: { profile: string; state: string }[] }> = {};
  let seq = 1;
  let url = '';

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const path = req.url!.split('?')[0];
    const send = (code: number, x: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(x));
    };
    // presigned storage
    if (path.startsWith('/s3/')) {
      if (req.method === 'PUT') {
        blobs[path] = raw;
        return send(200, {});
      }
      res.writeHead(blobs[path] ? 200 : 404);
      return res.end(blobs[path]);
    }
    const body = raw.length ? JSON.parse(raw.toString()) : {};
    const route = `${req.method} ${path}`;
    if (route === 'POST /v1/testbot/session') {
      if (req.headers['x-testbot-key'] !== key) return send(404, {});
      const h = body.handle as string;
      const profile = 'BOT-' + h.toUpperCase();
      calls.push({ route, who: profile, body });
      if (body.new_session === false) return send(200, { profile_id: profile });
      // resume keeps the device (same D-<profile> here either way), new token each time
      const token = `bot-${h}-${seq++}`;
      users[token] = { profile, device: 'D-' + profile, name: body.name };
      devices.add('D-' + profile);
      return send(200, { access_token: token, refresh_token: 'r', expires_in: 900, profile_id: profile });
    }
    // refresh tokens are never valid here: a bot whose access token is gone must resume
    if (route === 'POST /v1/auth/refresh') return send(401, {});
    const tok = (req.headers.authorization ?? '').replace('Bearer ', '');
    // test peer: "peer-<run>" signs in as a new device of PEER, earlier peer devices are deleted
    if (tok.startsWith('peer-') && !users[tok]) {
      for (const t of Object.keys(users)) if (users[t].profile === 'PEER') (devices.delete(users[t].device), delete users[t]);
      users[tok] = { profile: 'PEER', device: 'D-' + tok, name: 'Peer' };
      devices.add('D-' + tok);
    }
    const u = users[tok];
    if (!u) return send(401, {});
    calls.push({ route, who: u.profile, body });
    let m: RegExpMatchArray | null;
    switch (true) {
      case route === 'GET /v1/mls/keypackages': {
        const l = kps[u.profile] ?? [];
        return send(200, { device_id: u.device, counts: { [u.profile]: { count: l.filter((k) => !k.lr).length, last_resort: l.some((k) => k.lr) } } });
      }
      case route === 'POST /v1/mls/keypackages': {
        if (body.reset) kps[body.profile_id] = []; // test peer: each run is a fresh device
        const l = (kps[body.profile_id] ??= []);
        for (const kp of body.key_packages) l.push({ id: seq++, device: u.device, kp, lr: false });
        if (body.last_resort) l.push({ id: seq++, device: u.device, kp: body.last_resort, lr: true });
        return send(200, {});
      }
      case route === 'POST /v1/mls/keypackages/claim': {
        const l = kps[body.to_profile_id] ?? [];
        const single = l.findIndex((k) => !k.lr);
        const i = single >= 0 ? single : l.findIndex((k) => k.lr);
        if (i < 0) return send(422, {});
        const k = l[i];
        if (!k.lr) l.splice(i, 1);
        return send(200, { key_packages: [{ id: k.id, device_id: k.device, key_package: k.kp }] });
      }
      case route === 'POST /v1/mls/messages': {
        if (body.envelopes.some((e: { to_device_id: string }) => !devices.has(e.to_device_id))) return send(422, { error: { code: 'validation', fields: { to_device_id: ['unknown device'] } } });
        for (const e of body.envelopes) {
          (queues[e.to_device_id] ??= []).push({ id: seq++, to_profile_id: e.to_profile_id, from_profile_id: body.from_profile_id, group_id: body.group_id, kind: e.kind, ciphertext: e.ciphertext, at: new Date().toISOString() });
        }
        return send(200, { delivered: [...new Set(body.envelopes.map((e: { to_profile_id: string }) => e.to_profile_id))], undelivered: [] });
      }
      case route === 'GET /v1/mls/messages':
        return send(200, { messages: (queues[u.device] ?? []).slice(0, 200) });
      case route === 'POST /v1/mls/messages/ack':
        queues[u.device] = (queues[u.device] ?? []).filter((x) => !body.ids.includes(x.id));
        return send(200, {});
      case route === 'POST /v1/media/upload': {
        const id = 'b' + seq++;
        return send(200, { blob_id: id, put_url: `${url}/s3/blob/${id}` });
      }
      case !!(m = route.match(/^GET \/v1\/media\/(\w+)$/)):
        return send(200, { url: `${url}/s3/blob/${m![1]}` });
      case !!(m = route.match(/^POST \/v1\/me\/profiles\/[\w-]+\/photos$/)): {
        const id = 'ph' + seq++;
        return send(201, { photo_id: id, put_url: `${url}/s3/public/${id}`, thumb_put_url: `${url}/s3/public/${id}-t` });
      }
      case !!(m = route.match(/^POST \/v1\/me\/profiles\/[\w-]+\/photos\/(\w+)\/check$/)):
        return send(200, { status: blobs[`/s3/public/${m![1]}`] ? 'ok_main' : 'missing' });
      case !!(m = route.match(/^POST \/v1\/me\/profiles\/([\w-]+)\/share$/)):
        return send(200, { slug: 'abc', url: 'https://staging.thirstr.fun/p/' + String(m![1]).toLowerCase() });
      case route === 'POST /v1/parties': {
        const id = 'party' + seq++;
        parties[id] = { host: u.profile, title: body.title, requests: [] };
        return send(201, { id });
      }
      case !!(m = route.match(/^GET \/v1\/parties\/(\w+)$/)): {
        const p = parties[m![1]];
        return send(200, {
          title: p.title,
          my_state: p.host === u.profile ? 'host' : 'guest',
          requests: p.requests.map((r) => ({ profile: { id: r.profile, display_name: r.profile }, state: r.state })),
        });
      }
      case !!(m = route.match(/^POST \/v1\/parties\/(\w+)\/request$/)):
        parties[m![1]].requests.push({ profile: u.profile, state: 'pending' });
        return send(200, {});
      case !!(m = route.match(/^POST \/v1\/parties\/(\w+)\/requests\/([\w-]+)\/accept$/)):
        parties[m![1]].requests.find((r) => r.profile === m![2])!.state = 'accepted';
        return send(200, {});
      case route === 'POST /v1/activities':
        return send(201, { id: 'act' + seq++ });
      case !!route.match(/^GET \/v1\/activities\/\w+\/members$/):
        return send(200, { members: [] });
      case route === 'POST /v1/tonight':
        return send(201, { id: 't' + seq++, expires_at: new Date(Date.now() + 4 * 3600_000).toISOString() });
      case route === 'GET /v1/cities':
        return send(200, { cities: [{ id: 7, name: 'Zurich' }] });
      case route === 'POST /v1/trips':
        return send(201, { id: 'trip' + seq++ });
      case route === 'GET /v1/taps':
        return send(200, { taps: [] });
      case ['PUT /v1/me/location', 'PUT /v1/me/pin', 'PUT /v1/me/now', 'POST /v1/taps/seen'].includes(route):
        return send(200, {});
      default:
        return send(404, { route });
    }
  });
  return new Promise<{ url: string; close: () => void; calls: typeof calls; parties: typeof parties; blobs: typeof blobs; expire: (profile: string) => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const a = server.address() as { port: number };
      url = `http://127.0.0.1:${a.port}`;
      // drop a bot's access tokens, as if they expired and the refresh token was lost
      const expire = (profile: string) => Object.keys(users).forEach((t) => users[t].profile === profile && delete users[t]);
      resolve({ url, close: () => server.close(), calls, parties, blobs, expire });
    }),
  );
}
