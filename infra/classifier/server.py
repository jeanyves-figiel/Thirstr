"""Thirstr public-photo classifier (F-15 R-15.10, #26).

Self-hosted NudeNet 3.4 (MIT, 320n ONNX, CPU). Private Fly network only: the API sends a
short-lived presigned GET URL, the service downloads the photo into memory, detects, answers
and forgets it. Nothing is written to disk or logged except counts and timings.

POST /detect {"url": "..."} -> {"detections": [{"class": str, "score": float}], "ms": int}
GET  /health                -> {"ok": true}
"""
import json
import logging
import os
import socket
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

from nudenet import NudeDetector

MAX_BYTES = 25 * 1024 * 1024
TOKEN = os.environ.get("CLASSIFIER_TOKEN", "")
# SSRF guard: only fetch from the photo store (comma-separated URL prefixes).
ALLOWED = [p for p in os.environ.get("ALLOWED_URL_PREFIXES", "").split(",") if p]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("classifier")

detector = NudeDetector()
lock = Lock()  # one inference at a time: shared CPU, keeps memory flat


def fetch(url: str) -> bytes:
    if not url.startswith(("https://", "http://")) or (ALLOWED and not url.startswith(tuple(ALLOWED))):
        raise ValueError("url not allowed")
    with urllib.request.urlopen(url, timeout=10) as r:
        data = r.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("too large")
    return data


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):  # no request logs (URLs carry signed keys)
        pass

    def reply(self, status: int, body: dict):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"ok": True})
        self.reply(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/detect":
            return self.reply(404, {"error": "not_found"})
        if TOKEN and self.headers.get("authorization") != f"Bearer {TOKEN}":
            return self.reply(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("content-length", "0"))
            url = json.loads(self.rfile.read(min(length, 8192)))["url"]
            t0 = time.monotonic()
            data = fetch(url)
            with lock:
                det = detector.detect(data)
            ms = int((time.monotonic() - t0) * 1000)
            log.info("detect ok n=%d ms=%d", len(det), ms)
            self.reply(200, {"detections": [{"class": d["class"], "score": round(d["score"], 3)} for d in det], "ms": ms})
        except Exception as e:  # noqa: BLE001 - API treats any failure as "human review"
            log.warning("detect failed: %s", type(e).__name__)
            self.reply(422, {"error": type(e).__name__})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    log.info("classifier ready on :%d", port)
    # Dual-stack "::" (Fly proxy + private IPv6); BIND_HOST=0.0.0.0 for IPv4-only hosts.
    host = os.environ.get("BIND_HOST", "::")

    class Server(ThreadingHTTPServer):
        address_family = socket.AF_INET6 if ":" in host else socket.AF_INET

        def server_bind(self):
            if self.address_family == socket.AF_INET6:
                self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            super().server_bind()

    try:
        server = Server((host, port), Handler)
    except OSError:  # no IPv6 on this host
        Server.address_family = socket.AF_INET
        host = "0.0.0.0"
        server = Server((host, port), Handler)
    log.info("listening on [%s]:%d", host, port)
    server.serve_forever()
