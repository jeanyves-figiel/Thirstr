// Status prober for status.thirstr.fun (EN-04 #163, docs/spec/slos.md › 6). Node 22, no dependencies.
//
//   node status/probe.mjs <data dir> [--no-probe]
//
// Reads/writes in <data dir> (the `status-data` branch):
//   state.json  – consecutive failures per component, last result (internal)
//   daily.json  – per day per component: probes, ok, warn, down, longest down/warn run (≤ 120 days kept)
//   status.json – everything the page shows (components, 90-day bars, month tiles, incidents, maintenance)
//   feed.xml    – Atom feed of incidents
// --no-probe: only refresh incidents (issue events), keep the last probe results.
// Env: GITHUB_TOKEN + GITHUB_REPOSITORY (issues), FLY_PROM_TOKEN (optional, month tiles + Notifications),
//      STATUS_API (default https://api.thirstr.fun), STATUS_SITE (default https://thirstr.fun), STATUS_MEDIA,
//      STATUS_AUTO_INCIDENT=1 to open an `incident` issue when a component goes down.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const dir = process.argv[2] ?? "data";
const doProbe = !process.argv.includes("--no-probe");
const API = process.env.STATUS_API ?? "https://api.thirstr.fun";
const SITE = process.env.STATUS_SITE ?? "https://thirstr.fun";
const MEDIA = process.env.STATUS_MEDIA ?? "https://fly.storage.tigris.dev/";
const WS = API.replace(/^http/, "ws") + "/socket/websocket?vsn=2.0.0";
const now = new Date();
const today = now.toISOString().slice(0, 10);

export const COMPONENTS = ["sign", "chat", "explore", "media", "push", "site"];

async function timed(fn, timeoutMs = 10_000) {
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const ok = await fn(ctl.signal);
    return { ok, ms: Math.round(performance.now() - t0) };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - t0) };
  } finally {
    clearTimeout(timer);
  }
}

function wsUpgrade(url, signal) {
  // Plain WebSocket handshake (Node 22 global WebSocket); open = server accepted the upgrade.
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const done = (v) => { try { ws.close(); } catch {} resolve(v); };
    ws.onopen = () => done(true);
    ws.onerror = () => done(false);
    signal.addEventListener("abort", () => done(false));
  });
}

async function promValue(query) {
  const token = process.env.FLY_PROM_TOKEN;
  if (!token) return null;
  try {
    const u = new URL(`https://api.fly.io/prometheus/${process.env.FLY_ORG ?? "personal"}/api/v1/query`);
    u.searchParams.set("query", query);
    const r = await fetch(u, { headers: { Authorization: `FlyV1 ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const v = (await r.json())?.data?.result?.[0]?.value?.[1];
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

const SLOW = { sign: 2000, chat: 2000, explore: 2000, media: 3000, site: 3000 };

async function probeAll() {
  const res = {};
  res.sign = await timed(async (signal) => {
    // Refresh with a bogus token: hits the router, rate limit and the sessions table; never sends mail.
    const r = await fetch(`${API}/v1/auth/refresh`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh: "status-probe" }), signal,
    });
    return r.status === 401 || r.status === 422;
  });
  res.chat = await timed(async (signal) => {
    const h = await fetch(`${API}/v1/health`, { signal });
    return h.ok && (await wsUpgrade(WS, signal));
  });
  res.explore = await timed(async (signal) => {
    const r = await fetch(`${API}/v1/welcome`, { signal });
    return r.ok && (await r.text()).includes('"cells"');
  });
  res.media = await timed(async (signal) => {
    // Photo storage (Tigris, S3 API): any answer below 500 means the storage front door is up.
    const r = await fetch(MEDIA, { method: "HEAD", signal });
    return r.status < 500;
  });
  res.site = await timed(async (signal) => (await fetch(`${SITE}/`, { signal })).ok);
  const share = await promValue(
    'sum(rate(thirstr_push_send_count{app="thirstr-api-prod",outcome="retry"}[15m])) / sum(rate(thirstr_push_send_count{app="thirstr-api-prod"}[15m]))'
  );
  res.push = share === null ? { nodata: true } : { ok: share <= 0.5, warn: share > 0.05, ms: null };
  return res;
}

function classify(id, r) {
  if (r.nodata) return "none";
  if (!r.ok) return "down";
  if (r.warn || (SLOW[id] && r.ms > SLOW[id])) return "warn";
  return "ok";
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(join(dir, file), "utf8")); } catch { return fallback; }
}

async function github(path, init = {}) {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`GitHub ${path}: ${r.status}`);
  return r.json();
}

const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const STATES = ["investigating", "identified", "monitoring"];

async function incidents() {
  const since = new Date(now - 90 * 864e5).toISOString();
  const list = [];
  for (const label of ["incident", "maintenance"]) {
    const issues = (await github(`/issues?labels=${label}&state=all&since=${since}&per_page=50`)) ?? [];
    for (const i of issues) {
      if (i.pull_request || !TRUSTED.has(i.author_association)) continue;
      const labels = i.labels.map((l) => (typeof l === "string" ? l : l.name));
      const comments = i.comments ? (await github(`/issues/${i.number}/comments?per_page=100`)) ?? [] : [];
      const updates = comments
        .filter((c) => TRUSTED.has(c.author_association) && /^update:/i.test(c.body.trim()))
        .map((c) => {
          const text = c.body.trim().replace(/^update:\s*/i, "");
          const st = STATES.find((s) => text.toLowerCase().startsWith(s + ":"));
          return { at: c.created_at, state: st ?? null, text: st ? text.slice(st.length + 1).trim() : text };
        })
        .reverse();
      const when = label === "maintenance" ? (i.body ?? "").match(/^when:\s*(\S+)\/(\S+)/im) : null;
      list.push({
        id: i.number,
        kind: label,
        title: i.title,
        state: i.state === "closed" ? "resolved" : STATES.find((s) => labels.includes(s)) ?? (label === "maintenance" ? "scheduled" : "investigating"),
        severity: labels.find((l) => /^sev-\d$/.test(l)) ?? null,
        affects: labels.filter((l) => l.startsWith("affects:")).map((l) => l.slice(8)).filter((c) => COMPONENTS.includes(c)),
        opened: i.created_at,
        closed: i.closed_at,
        window: when ? { from: when[1], to: when[2] } : null,
        updates,
      });
    }
  }
  return list.sort((a, b) => b.opened.localeCompare(a.opened));
}

function atom(list) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const entries = list.slice(0, 30).map((i) => `  <entry>
    <id>https://status.thirstr.fun/#incident-${i.id}</id>
    <title>${esc(i.title)} (${esc(i.state)})</title>
    <updated>${esc(i.updates[0]?.at ?? i.closed ?? i.opened)}</updated>
    <link href="https://status.thirstr.fun/#incident-${i.id}"/>
    <content type="text">${esc(i.updates.map((u) => `${u.at} ${u.state ?? ""} ${u.text}`).join("\n"))}</content>
  </entry>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Thirstr status</title>
  <id>https://status.thirstr.fun/</id>
  <link href="https://status.thirstr.fun/"/>
  <updated>${now.toISOString()}</updated>
${entries}
</feed>
`;
}

async function main() {
  await mkdir(dir, { recursive: true });
  const state = await readJson("state.json", { fails: {}, last: {} });
  const daily = await readJson("daily.json", {});

  if (doProbe) {
    const res = await probeAll();
    daily[today] ??= {};
    for (const id of COMPONENTS) {
      const raw = classify(id, res[id]);
      // two consecutive failures before red; one success clears
      const fails = raw === "down" ? (state.fails[id] ?? 0) + 1 : 0;
      state.fails[id] = fails;
      const shown = raw === "down" && fails < 2 ? "warn" : raw;
      const prev = state.last[id]?.state;
      state.last[id] = { state: shown, ms: res[id].ms ?? null, at: now.toISOString(), since: prev === shown ? state.last[id]?.since ?? now.toISOString() : now.toISOString() };
      if (shown === "none") continue;
      const d = (daily[today][id] ??= { n: 0, ok: 0, warn: 0, down: 0, runDown: 0, runWarn: 0, maxDown: 0, maxWarn: 0 });
      d.n++; d[shown]++;
      d.runDown = shown === "down" ? d.runDown + 1 : 0;
      d.runWarn = shown === "warn" ? d.runWarn + 1 : 0;
      d.maxDown = Math.max(d.maxDown, d.runDown);
      d.maxWarn = Math.max(d.maxWarn, d.runWarn);
    }
    for (const day of Object.keys(daily).sort().slice(0, -120)) delete daily[day];
  }

  let inc = [];
  try { inc = await incidents(); } catch (e) { console.error(String(e)); inc = (await readJson("status.json", {})).incidents ?? []; }

  if (doProbe && process.env.STATUS_AUTO_INCIDENT === "1") {
    const down = COMPONENTS.filter((id) => state.last[id]?.state === "down");
    const open = inc.some((i) => i.kind === "incident" && i.state !== "resolved");
    if (down.length && !open) {
      await github(`/issues`, { method: "POST", body: JSON.stringify({
        title: `Not working: ${down.join(", ")}`,
        body: "Opened by the status prober after 2 failed checks in a row. Edit the title for the public page; post updates as comments starting with `Update:`. Close when resolved.",
        labels: ["incident", "investigating", ...down.map((c) => `affects:${c}`)],
      }) });
      inc = await incidents();
    }
  }

  // Month tiles (SLO-2 external availability + SLO-3/4 from Prometheus when reachable).
  const month = today.slice(0, 7);
  let probes = 0, good = 0;
  for (const [day, comps] of Object.entries(daily)) if (day.startsWith(month)) for (const c of Object.values(comps)) { probes += c.n; good += c.ok + c.warn; }
  const p95 = (route) => promValue(`histogram_quantile(0.95, sum by (le) (rate(phoenix_router_dispatch_stop_duration_bucket{app="thirstr-api-prod",route=~"${route}"}[7d])))`);
  const tiles = {
    availability: probes ? Math.floor((good / probes) * 10000) / 100 : null,
    message_p95_ms: await p95("/v1/mls/messages"),
    map_p95_ms: await p95("/v1/explore/(grid|map|tray|summary)"),
  };

  const days = {};
  for (const id of COMPONENTS) {
    days[id] = [];
    for (let k = 89; k >= 0; k--) {
      const d = new Date(now - k * 864e5).toISOString().slice(0, 10);
      const c = daily[d]?.[id];
      const maint = inc.some((i) => i.kind === "maintenance" && i.window && i.affects.includes(id) && i.window.from.slice(0, 10) <= d && i.window.to.slice(0, 10) >= d);
      let s = "none";
      if (c) s = c.maxDown >= 2 ? (maint ? "maint" : "down") : c.maxWarn >= 2 || c.maxDown === 1 ? "warn" : "ok";
      days[id].push({ d, s, n: c?.n ?? 0, up: c?.n ? Math.round(((c.ok + c.warn) / c.n) * 10000) / 100 : null });
    }
  }
  const uptime = {};
  for (const id of COMPONENTS) {
    let n = 0, g = 0;
    for (const x of days[id]) { const c = daily[x.d]?.[id]; if (c) { n += c.n; g += c.ok + c.warn; } }
    uptime[id] = n ? Math.floor((g / n) * 10000) / 100 : null;
  }

  const status = {
    updated: now.toISOString(),
    components: COMPONENTS.map((id) => ({ id, state: state.last[id]?.state ?? "none", since: state.last[id]?.since ?? null, ms: state.last[id]?.ms ?? null, uptime90: uptime[id] })),
    month: tiles,
    days,
    incidents: inc,
  };
  await writeFile(join(dir, "state.json"), JSON.stringify(state));
  await writeFile(join(dir, "daily.json"), JSON.stringify(daily));
  await writeFile(join(dir, "status.json"), JSON.stringify(status));
  await writeFile(join(dir, "feed.xml"), atom(inc));
  console.log(COMPONENTS.map((id) => `${id}=${status.components.find((c) => c.id === id).state}`).join(" "));
}

await main();
