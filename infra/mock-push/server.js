// DEV stand-in for APNs/FCM (I-03). Accepts pushes and keeps the last 100 in memory.
// Asserts the content-free payload rule (api.md › Push payloads): generic alert + opaque t, nothing else.
const http = require('http');
const log = [];

http
  .createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let ok = false;
        try {
          const p = JSON.parse(body);
          const keys = Object.keys(p).sort().join(',');
          const generic = ['{"title":"Thirstr","body":"New activity"}', '{"title":"Reminder","body":"You have a reminder"}'];
          ok =
            keys === 'aps,t' &&
            typeof p.t === 'string' &&
            Object.keys(p.aps).sort().join(',') === 'alert,mutable-content,sound' &&
            generic.includes(JSON.stringify(p.aps.alert));
        } catch {}
        log.unshift({ at: new Date().toISOString(), contentFree: ok, bytes: body.length });
        log.length = Math.min(log.length, 100);
        res.writeHead(ok ? 200 : 422, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok }));
      });
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(log));
    }
  })
  .listen(4100, () => console.log('mock-push on :4100'));
