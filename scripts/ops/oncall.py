#!/usr/bin/env python3
"""On-call alert evaluator and Pushover pager (EN-06, #165).

Runs every 5 min from .github/workflows/oncall.yml (outside Fly, so it still
pages when Fly itself is down). Reads infra/alerts/rules.json, checks each rule,
keeps state between runs in a small JSON file, and pushes to Pushover on
fire / reminder / resolve. Every push links the rule's runbook section in
docs/runbooks/alerts.md.

Inert until the secrets exist: without PUSHOVER_APP_TOKEN + PUSHOVER_USER_KEY
it evaluates, writes the job summary and logs "would page", nothing is sent.
Optional PUSHOVER_ESCALATION_KEY: a SEV1 not acknowledged within
ESCALATE_AFTER_MIN is pushed to that key too (second engineer, from open beta).

Stdlib only. Never prints secrets.

  oncall.py --check                  validate rules + runbook anchors (CI)
  oncall.py --state FILE [--dry-run] [--test-page]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RULES_PATH = os.path.join(ROOT, "infra", "alerts", "rules.json")
RUNBOOK_PATH = os.path.join(ROOT, "docs", "runbooks", "alerts.md")
RUNBOOK_URL = "https://github.com/jeanyves-figiel/Thirstr/blob/main/docs/runbooks/alerts.md"
PUSHOVER = "https://api.pushover.net/1"

REPEAT_MIN = {1: 60, 2: 240}  # reminder while still firing (SEV1: after an emergency expires)
EMERGENCY_RETRY_S = 120  # SEV1 re-alerts every 2 min ...
EMERGENCY_EXPIRE_S = 3600  # ... for up to 1 h, until acknowledged
ESCALATE_AFTER_MIN = 15
HEARTBEAT_WEEKDAY = 0  # Monday
HEARTBEAT_HOUR_UTC = 7
TYPES = {"promql", "http", "cert", "meta"}


# ---------------------------------------------------------------- rules


def load_rules(path: str = RULES_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def runbook_anchors(path: str = RUNBOOK_PATH) -> set[str]:
    anchors = set()
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"^#{2,3}\s+(.+?)\s*$", line)
            if m:
                text = m.group(1).strip().lower()
                text = re.sub(r"[^\w\- ]", "", text)
                anchors.add(text.replace(" ", "-"))
    return anchors


def check(rules: dict, anchors: set[str]) -> list[str]:
    errors = []
    seen = set()
    for r in rules.get("rules", []):
        rid = r.get("id", "?")
        if rid in seen:
            errors.append(f"{rid}: duplicate id")
        seen.add(rid)
        if not re.fullmatch(r"[a-z0-9-]+", rid):
            errors.append(f"{rid}: id must be kebab-case")
        if r.get("type") not in TYPES:
            errors.append(f"{rid}: type must be one of {sorted(TYPES)}")
        if r.get("sev") not in (1, 2, 3):
            errors.append(f"{rid}: sev must be 1, 2 or 3")
        if not r.get("title"):
            errors.append(f"{rid}: title missing")
        if not isinstance(r.get("for_min"), (int, float)) or r["for_min"] < 0:
            errors.append(f"{rid}: for_min must be >= 0")
        if r.get("type") == "promql" and not r.get("query"):
            errors.append(f"{rid}: query missing")
        if r.get("type") == "http" and not str(r.get("url", "")).startswith("https://"):
            errors.append(f"{rid}: url must be https")
        if r.get("type") == "cert" and not r.get("hosts"):
            errors.append(f"{rid}: hosts missing")
        if rid not in anchors:
            errors.append(f"{rid}: no '## {rid}' section in docs/runbooks/alerts.md")
    return errors


# ---------------------------------------------------------------- probes


def http_json(url: str, *, data: dict | None = None, headers: dict | None = None, timeout: int = 15):
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers or {})
    req.add_header("User-Agent", "thirstr-oncall/1")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def eval_promql(rule: dict, prom: str, token: str | None) -> tuple[bool, str]:
    if not token:
        raise RuntimeError("no metrics token")
    url = f"{prom}/api/v1/query?" + urllib.parse.urlencode({"query": rule["query"]})
    res = http_json(url, headers={"Authorization": f"FlyV1 {token}"})
    if res.get("status") != "success":
        raise RuntimeError(f"query status {res.get('status')}")
    samples = res["data"]["result"]
    if not samples:
        return False, ""
    vals = []
    for s in samples[:3]:
        v = float(s["value"][1])
        vals.append(fmt_value(v, rule.get("unit", "")))
    return True, ", ".join(vals)


def fmt_value(v: float, unit: str) -> str:
    if unit == "ratio":
        return f"{v * 100:.1f} %"
    if unit == "bytes":
        return f"{v / 1e6:.0f} MB"
    if unit == "s":
        return f"{v / 60:.0f} min" if v >= 120 else f"{v:.0f} s"
    if unit == "ms":
        return f"{v:.0f} ms"
    return f"{v:g}"


def eval_http(rule: dict) -> tuple[bool, str]:
    req = urllib.request.Request(rule["url"], headers={"User-Agent": "thirstr-oncall/1"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            code = resp.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:  # timeout, DNS, TLS, refused
        return True, type(e).__name__
    want = rule.get("expect_status", 200)
    return (code != want), (f"HTTP {code}" if code != want else "")


def cert_days_left(host: str) -> float:
    ctx = ssl.create_default_context()
    with socket.create_connection((host, 443), timeout=10) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as tls:
            not_after = tls.getpeercert()["notAfter"]
    exp = dt.datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=dt.timezone.utc)
    return (exp - dt.datetime.now(dt.timezone.utc)).total_seconds() / 86400


def eval_cert(rule: dict) -> tuple[bool, str]:
    bad = []
    for host in rule["hosts"]:
        try:
            days = cert_days_left(host)
            if days < rule.get("min_days", 14):
                bad.append(f"{host} {days:.0f} d")
        except Exception as e:
            bad.append(f"{host} {type(e).__name__}")
    return bool(bad), ", ".join(bad)


# ---------------------------------------------------------------- state machine


def step(rule: dict, st: dict, firing: bool, detail: str, now: float) -> list[str]:
    """Advance one rule's state. Returns events: 'fire', 'remind', 'resolve'."""
    events = []
    if firing:
        st.setdefault("pending_since", now)
        st["detail"] = detail
        if not st.get("active") and now - st["pending_since"] >= rule["for_min"] * 60:
            st["active"] = True
            st["firing_since"] = now
            st["paged"] = False
            st["escalated"] = False
        if st.get("active") and rule["sev"] < 3:
            if not st.get("paged"):
                events.append("fire")
            elif now - st.get("last_page", now) >= REPEAT_MIN[rule["sev"]] * 60:
                events.append("remind")
    else:
        st.pop("pending_since", None)
        if st.get("active"):
            if st.get("paged") and rule["sev"] < 3:
                events.append("resolve")
                st["resolved"] = {"firing_since": st.get("firing_since", now), "receipt": st.get("receipt")}
            for k in ("active", "firing_since", "paged", "last_page", "receipt", "escalated", "detail"):
                st.pop(k, None)
    return events


# ---------------------------------------------------------------- pushover


class Pager:
    def __init__(self, dry_run: bool):
        self.app = os.environ.get("PUSHOVER_APP_TOKEN") or ""
        self.user = os.environ.get("PUSHOVER_USER_KEY") or ""
        self.escalation = os.environ.get("PUSHOVER_ESCALATION_KEY") or ""
        self.dry_run = dry_run
        self.log: list[str] = []

    @property
    def live(self) -> bool:
        return bool(self.app and self.user) and not self.dry_run

    def send(self, *, title: str, message: str, priority: int, url: str = "", url_title: str = "",
             user: str | None = None) -> dict | None:
        if not self.live:
            self.log.append(f"would page (p{priority}): {title}")
            return None
        data = {
            "token": self.app,
            "user": user or self.user,
            "title": title[:250],
            "message": message[:1024],
            "priority": priority,
            "timestamp": int(time.time()),
        }
        if url:
            data["url"] = url
            data["url_title"] = url_title[:100]
        if priority == 2:
            data["retry"] = EMERGENCY_RETRY_S
            data["expire"] = EMERGENCY_EXPIRE_S
        res = http_json(f"{PUSHOVER}/messages.json", data=data)
        self.log.append(f"paged (p{priority}): {title}")
        return res

    def acknowledged(self, receipt: str) -> bool:
        res = http_json(f"{PUSHOVER}/receipts/{urllib.parse.quote(receipt)}.json?token={urllib.parse.quote(self.app)}")
        return bool(res.get("acknowledged"))

    def cancel(self, receipt: str) -> None:
        http_json(f"{PUSHOVER}/receipts/{urllib.parse.quote(receipt)}/cancel.json", data={"token": self.app})


def hhmm(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%H:%M UTC")


def page_for(pager: Pager, rule: dict, st: dict, event: str, now: float) -> None:
    rid, sev = rule["id"], rule["sev"]
    url = f"{RUNBOOK_URL}#{rid}"
    since = hhmm(st.get("firing_since", now))
    detail = st.get("detail") or ""
    if event == "resolve":
        last = st.pop("resolved", {})
        since = hhmm(last.get("firing_since", now))
        pager.send(title=f"Resolved: {rule['title']}", message=f"{rid} is back to normal (fired {since}).",
                   priority=-1, url=url, url_title=f"Runbook: {rid}")
        if last.get("receipt") and pager.live:
            try:
                pager.cancel(last["receipt"])
            except Exception:
                pass
        return
    prefix = "Still firing: " if event == "remind" else ""
    msg = f"{prefix}{rule['title']}" + (f" ({detail})" if detail else "") + f". Since {since}. Tap for the runbook."
    res = pager.send(title=f"[SEV{sev}] Thirstr prod: {rule['title']}", message=msg,
                     priority=2 if sev == 1 else 0, url=url, url_title=f"Runbook: {rid}")
    if res is not None:
        st["paged"] = True
        st["last_page"] = now
        if res.get("receipt"):
            st["receipt"] = res["receipt"]


def maybe_escalate(pager: Pager, rule: dict, st: dict, now: float) -> None:
    if not (pager.live and pager.escalation and rule["sev"] == 1 and st.get("receipt")):
        return
    if st.get("escalated") or now - st.get("firing_since", now) < ESCALATE_AFTER_MIN * 60:
        return
    try:
        if pager.acknowledged(st["receipt"]):
            return
    except Exception:
        return
    pager.send(title=f"[SEV1 escalated] Thirstr prod: {rule['title']}",
               message=f"Not acknowledged for {ESCALATE_AFTER_MIN} min. {rule['title']}. Since {hhmm(st['firing_since'])}.",
               priority=2, url=f"{RUNBOOK_URL}#{rule['id']}", url_title=f"Runbook: {rule['id']}",
               user=pager.escalation)
    st["escalated"] = True


# ---------------------------------------------------------------- main


def evaluate(rules: dict, state: dict, pager: Pager, now: float, token: str | None) -> list[dict]:
    alerts = state.setdefault("alerts", {})
    rows = []
    prom_errors = []
    ordered = [r for r in rules["rules"] if r["type"] != "meta"] + [r for r in rules["rules"] if r["type"] == "meta"]
    for rule in ordered:
        st = alerts.setdefault(rule["id"], {})
        try:
            if rule["type"] == "promql":
                firing, detail = eval_promql(rule, rules["prometheus"], token)
            elif rule["type"] == "http":
                firing, detail = eval_http(rule)
            elif rule["type"] == "cert":
                firing, detail = eval_cert(rule)
            else:  # meta: metrics-unreachable
                firing, detail = bool(prom_errors), (prom_errors[0] if prom_errors else "")
        except Exception as e:
            # A failed query neither fires nor resolves its rule; it feeds metrics-unreachable.
            prom_errors.append(f"{rule['id']}: {type(e).__name__}")
            rows.append({"id": rule["id"], "sev": rule["sev"], "status": "error", "detail": type(e).__name__})
            continue
        for event in step(rule, st, firing, detail, now):
            page_for(pager, rule, st, event, now)
        maybe_escalate(pager, rule, st, now)
        status = "FIRING" if st.get("active") else ("pending" if st.get("pending_since") else "ok")
        rows.append({"id": rule["id"], "sev": rule["sev"], "status": status, "detail": detail})
    # forget state of rules that were removed from rules.json
    for rid in list(alerts):
        if rid not in {r["id"] for r in rules["rules"]}:
            alerts.pop(rid)
    return rows


def heartbeat(pager: Pager, state: dict, rows: list[dict], now: float) -> None:
    """Weekly quiet push proving the pipe works; also once when the keys first appear."""
    t = dt.datetime.fromtimestamp(now, dt.timezone.utc)
    first = pager.live and not state.get("connected")
    weekly = (t.weekday() == HEARTBEAT_WEEKDAY and t.hour >= HEARTBEAT_HOUR_UTC
              and now - state.get("last_heartbeat", 0) > 6 * 86400)
    if not (first or weekly):
        return
    firing = [r["id"] for r in rows if r["status"] == "FIRING"]
    errors = [r["id"] for r in rows if r["status"] == "error"]
    msg = f"{len(rows)} checks. " + (f"Firing: {', '.join(firing)}. " if firing else "None firing. ")
    if errors:
        msg += f"Check errors: {', '.join(errors)}."
    title = "Thirstr on-call connected" if first else "Thirstr on-call weekly check"
    if pager.send(title=title, message=msg, priority=-1, url=RUNBOOK_URL, url_title="Alert runbooks") is not None:
        state["connected"] = True
        state["last_heartbeat"] = now
    elif not pager.live and weekly:
        state["last_heartbeat"] = now


def summary(rows: list[dict], pager: Pager) -> str:
    mode = "live" if pager.live else ("dry run" if pager.dry_run else "inert (Pushover secrets not set)")
    out = [f"### On-call ({mode})", "", "| Rule | Sev | Status | Detail |", "|---|---|---|---|"]
    for r in rows:
        out.append(f"| [{r['id']}]({RUNBOOK_URL}#{r['id']}) | {r['sev']} | {r['status']} | {r['detail']} |")
    if pager.log:
        out += ["", *[f"- {line}" for line in pager.log]]
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--state", default="oncall-state.json")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--test-page", action="store_true")
    args = ap.parse_args()

    rules = load_rules()
    errors = check(rules, runbook_anchors())
    if errors or args.check:
        for e in errors:
            print(f"::error::{e}")
        print(f"{len(rules['rules'])} rules, {len(errors)} errors")
        return 1 if errors else 0

    try:
        with open(args.state, encoding="utf-8") as f:
            state = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    before = json.dumps(state, sort_keys=True)

    pager = Pager(args.dry_run)
    now = time.time()
    if args.test_page:
        pager.send(title="Thirstr on-call test", message="Test push from the On-call alerts workflow.",
                   priority=0, url=RUNBOOK_URL, url_title="Alert runbooks")
    token = os.environ.get("FLY_METRICS_TOKEN") or None
    rows = evaluate(rules, state, pager, now, token)
    heartbeat(pager, state, rows, now)

    text = summary(rows, pager)
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(text)

    changed = json.dumps(state, sort_keys=True) != before
    if not args.dry_run:
        with open(args.state, "w", encoding="utf-8") as f:
            json.dump(state, f)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"changed={'true' if changed and not args.dry_run else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
