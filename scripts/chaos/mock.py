#!/usr/bin/env python3
"""Mock Fly Machines API + mock app for scripts/chaos/test.sh (tests only)."""
import json, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

M = {"api": "started", "db": "started", "valkey": "started"}
APPS = {"thirstr-api-staging": "api", "thirstr-db-staging": "db", "thirstr-valkey-staging": "valkey"}


def later(k, state, s):
    threading.Timer(s, lambda: M.__setitem__(k, state)).start()


class Fly(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(b)

    def parts(self):
        p = self.path.split("?")[0].strip("/").split("/")  # v1 apps <app> machines [id [action]]
        return p

    def do_GET(self):
        p = self.parts()
        if p[2] == "x" and p[3] == "state":
            return self.reply(M)
        k = APPS.get(p[2])
        if not k or "prod" in self.path:
            return self.reply({"error": "no"}, 404)
        if len(p) == 4:
            return self.reply([{"id": k + "1", "state": M[k], "config": {"metadata": {}}}])
        return self.reply({"id": p[4], "state": M[k]})

    def do_POST(self):
        p = self.parts()
        n = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        k = APPS.get(p[2])
        if not k or "prod" in self.path:
            return self.reply({"error": "no"}, 404)
        act = p[5]
        if act == "signal":
            M[k] = "stopped"; later(k, "started", 2)
        elif act == "stop":
            M[k] = "stopped"
        elif act == "start":
            M[k] = "started"
        elif act == "exec":
            return self.reply({"stdout": "Filesystem 1K 95%\n", "exit_code": 0})
        self.reply({"ok": True})


class App(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if M["api"] == "stopped":  # Fly proxy auto-start
            later("api", "started", 1)
            code = 503
        elif M["db"] != "started" and self.path == "/v1/health":
            code = 500
        else:
            code = 200
        self.send_response(code); self.end_headers(); self.wfile.write(b"{}")


fly, app = int(sys.argv[1]), int(sys.argv[2])
threading.Thread(target=ThreadingHTTPServer(("127.0.0.1", fly), Fly).serve_forever, daemon=True).start()
ThreadingHTTPServer(("127.0.0.1", app), App).serve_forever()
