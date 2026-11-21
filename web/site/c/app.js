// F-13 trusted-contact page. The link fragment (#rid.key) never reaches the server; every message
// is AES-256-GCM ciphertext decrypted here. Links are kept in this browser so the page also works
// when launched from the home screen (the fragment is lost there).
'use strict';

const T = {
  en: {
    invite: (n) => `${n} wants you as a trusted contact`,
    inviteBody: 'If something goes wrong on a date, Thirstr sends you an alert here with their location. Nothing else is shared, and you can stop any time.',
    accept: 'Accept',
    decline: 'No thanks',
    contactOf: (n) => `You are ${n}'s trusted contact`,
    nothing: 'No alerts. You will get a notification if they need you.',
    alertsOn: 'Turn on notifications',
    alertsOk: 'Notifications are on for this browser.',
    iosHint: 'On iPhone: tap Share, then Add to Home Screen, and open Thirstr from there to get notifications.',
    noPush: 'This browser cannot show notifications. Keep this page bookmarked and check it when asked.',
    stop: 'Stop being a contact',
    stopped: 'You are no longer a trusted contact.',
    gone: 'This link is no longer active.',
    bad: 'This link is incomplete. Ask for a new one.',
    notice: (n, d) => `${n} has a meetup. Check-in due ${d}.`,
    ok: (n) => `${n} checked in: all good.`,
    loc: (n) => `${n} shared a live location`,
    alert: (n) => `${n} did not check in`,
    panic: (n) => `${n} pressed the SOS button`,
    due: (d) => `Check-in was due ${d}.`,
    where: (d) => `Last known location (${d})`,
    map: 'Open map',
    with: 'Meeting',
    chat: 'Last messages',
    me: 'them',
    other: 'other',
    advice: 'Try calling them now. If you cannot reach them and are worried, call local emergency services.',
    error: 'Could not load. Retrying…',
  },
  fr: {
    invite: (n) => `${n} veut faire de toi un contact de confiance`,
    inviteBody: 'Si un rendez-vous tourne mal, Thirstr t’envoie une alerte ici avec sa position. Rien d’autre n’est partagé, et tu peux arrêter quand tu veux.',
    accept: 'Accepter',
    decline: 'Non merci',
    contactOf: (n) => `Tu es le contact de confiance de ${n}`,
    nothing: 'Aucune alerte. Tu recevras une notification s’il a besoin de toi.',
    alertsOn: 'Activer les notifications',
    alertsOk: 'Les notifications sont activées dans ce navigateur.',
    iosHint: 'Sur iPhone : touche Partager, puis Sur l’écran d’accueil, et ouvre Thirstr depuis là pour recevoir les notifications.',
    noPush: 'Ce navigateur ne peut pas afficher de notifications. Garde cette page en favori et consulte-la si on te le demande.',
    stop: 'Ne plus être contact',
    stopped: 'Tu n’es plus contact de confiance.',
    gone: 'Ce lien n’est plus actif.',
    bad: 'Ce lien est incomplet. Demande-en un nouveau.',
    notice: (n, d) => `${n} a un rendez-vous. Check-in prévu à ${d}.`,
    ok: (n) => `${n} a confirmé : tout va bien.`,
    loc: (n) => `${n} a partagé sa position en direct`,
    alert: (n) => `${n} n’a pas confirmé son check-in`,
    panic: (n) => `${n} a appuyé sur SOS`,
    due: (d) => `Le check-in était prévu à ${d}.`,
    where: (d) => `Dernière position connue (${d})`,
    map: 'Ouvrir la carte',
    with: 'Rendez-vous avec',
    chat: 'Derniers messages',
    me: 'lui',
    other: 'l’autre',
    advice: 'Essaie de l’appeler maintenant. Si tu n’arrives pas à le joindre et que tu t’inquiètes, appelle les secours.',
    error: 'Chargement impossible. Nouvel essai…',
  },
  de: {
    invite: (n) => `${n} möchte dich als Vertrauenskontakt`,
    inviteBody: 'Wenn bei einem Date etwas schiefgeht, schickt dir Thirstr hier eine Warnung mit seinem Standort. Sonst wird nichts geteilt, und du kannst jederzeit aufhören.',
    accept: 'Annehmen',
    decline: 'Nein danke',
    contactOf: (n) => `Du bist Vertrauenskontakt von ${n}`,
    nothing: 'Keine Warnungen. Du bekommst eine Mitteilung, wenn er dich braucht.',
    alertsOn: 'Mitteilungen einschalten',
    alertsOk: 'Mitteilungen sind in diesem Browser an.',
    iosHint: 'Auf dem iPhone: Teilen, dann Zum Home-Bildschirm, und Thirstr von dort öffnen, um Mitteilungen zu bekommen.',
    noPush: 'Dieser Browser kann keine Mitteilungen zeigen. Setz ein Lesezeichen und schau nach, wenn du gebeten wirst.',
    stop: 'Kein Kontakt mehr sein',
    stopped: 'Du bist kein Vertrauenskontakt mehr.',
    gone: 'Dieser Link ist nicht mehr aktiv.',
    bad: 'Dieser Link ist unvollständig. Bitte um einen neuen.',
    notice: (n, d) => `${n} hat ein Treffen. Check-in fällig um ${d}.`,
    ok: (n) => `${n} hat eingecheckt: alles gut.`,
    loc: (n) => `${n} teilt seinen Live-Standort`,
    alert: (n) => `${n} hat nicht eingecheckt`,
    panic: (n) => `${n} hat SOS gedrückt`,
    due: (d) => `Check-in war fällig um ${d}.`,
    where: (d) => `Letzter bekannter Standort (${d})`,
    map: 'Karte öffnen',
    with: 'Treffen mit',
    chat: 'Letzte Nachrichten',
    me: 'er',
    other: 'andere',
    advice: 'Ruf ihn jetzt an. Wenn du ihn nicht erreichst und dir Sorgen machst, ruf den Notruf.',
    error: 'Laden fehlgeschlagen. Neuer Versuch…',
  },
};
const lang = (navigator.language || 'en').slice(0, 2);
const t = T[lang] || T.en;
document.documentElement.lang = T[lang] ? lang : 'en';

const store = {
  get(k, d) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const api = async (method, path, body) => {
  const r = await fetch('/v1/relay/' + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 404) throw Object.assign(new Error('gone'), { gone: true });
  if (!r.ok) throw new Error(String(r.status));
  return r.status === 204 ? null : r.json();
};
const open = async (key, wire) => {
  const raw = b64(wire);
  const k = await crypto.subtle.importKey('raw', b64(key), 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, k, raw.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
};
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
};

// links: [{rid, key}]
let links = store.get('tc.links', []);
const frag = location.hash.slice(1);
if (frag) {
  const [rid, key] = frag.split('.');
  if (rid && key && b64(key).length === 32) {
    if (!links.some((l) => l.rid === rid)) links.push({ rid, key });
    store.set('tc.links', links);
  }
  history.replaceState(null, '', '/c/');
}

const main = document.getElementById('main');
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const pushable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function subscribe(vapid) {
  if (!pushable) return null;
  const reg = await navigator.serviceWorker.register('/c/sw.js', { scope: '/c/' });
  if ((await Notification.requestPermission()) !== 'granted') return null;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(vapid) }));
  const j = sub.toJSON();
  return { endpoint: j.endpoint, keys: j.keys };
}

function pushHint(link, info) {
  if (pushable && Notification.permission === 'granted') return h('p', { class: 'muted' }, t.alertsOk);
  if (pushable)
    return h(
      'div',
      { class: 'row' },
      h('button', {
        class: 'btn',
        onclick: async () => {
          const push = await subscribe(info.vapid_key).catch(() => null);
          if (push) await api('PUT', link.rid + '/push', { push }).catch(() => {});
          render();
        },
      }, t.alertsOn),
    );
  return h('p', { class: 'hint' }, ios && !standalone ? t.iosHint : t.noPush);
}

function msgView(m) {
  const n = m.from || '…';
  const loc = m.loc
    ? h('p', {}, t.where(when(m.loc.at)) + ' · ', h('a', { href: `https://www.openstreetmap.org/?mlat=${+m.loc.lat}&mlon=${+m.loc.lng}#map=17/${+m.loc.lat}/${+m.loc.lng}`, target: '_blank', rel: 'noopener noreferrer' }, t.map))
    : null;
  const who = m.who ? h('p', {}, `${t.with}: ${m.who.name}${m.who.age ? ', ' + m.who.age : ''}`, m.who.link ? [' · ', h('a', { href: String(m.who.link).startsWith('https://') ? m.who.link : '#', target: '_blank', rel: 'noopener noreferrer' }, m.who.link)] : null) : null;
  const chat = m.msgs?.length ? [h('p', {}, t.chat), h('ul', {}, m.msgs.map((x) => h('li', {}, `${x.me ? t.me : t.other}: ${x.text}`)))] : null;
  const head = { notice: t.notice(n, when(m.due)), ok: t.ok(n), loc: t.loc(n), alert: t.alert(n), panic: t.panic(n) }[m.k] || n;
  const urgent = m.k === 'alert' || m.k === 'panic';
  return h('div', { class: 'msg ' + m.k }, h('h3', {}, head), h('p', { class: 'muted' }, when(m.at)), m.k === 'alert' && m.due ? h('p', {}, t.due(when(m.due))) : null, loc, who, chat, urgent ? h('p', {}, t.advice) : null);
}

async function linkView(link) {
  let info;
  try {
    info = await api('GET', link.rid);
  } catch (e) {
    if (e.gone) {
      links = links.filter((l) => l.rid !== link.rid);
      store.set('tc.links', links);
      return h('div', { class: 'card' }, h('p', {}, t.gone));
    }
    throw e;
  }
  const intro = await open(link.key, info.intro).catch(() => ({ from: '…' }));
  const name = intro.from || '…';
  if (!info.accepted) {
    return h(
      'div',
      { class: 'card' },
      h('h2', {}, t.invite(name)),
      h('p', {}, t.inviteBody),
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'btn',
          onclick: async (ev) => {
            ev.target.disabled = true;
            const push = await subscribe(info.vapid_key).catch(() => null);
            await api('POST', link.rid + '/accept', push ? { push } : {}).catch(() => {});
            render();
          },
        }, t.accept),
        h('button', { class: 'btn ghost', onclick: () => stop(link) }, t.decline),
      ),
    );
  }
  // fetch, decrypt, keep locally (server copies are deleted on ack), ack
  const key = 'tc.msgs.' + link.rid;
  const kept = store.get(key, []);
  const { messages } = await api('GET', link.rid + '/messages');
  for (const m of messages) {
    const p = await open(link.key, m.ciphertext).catch(() => null);
    if (p && !kept.some((k) => k.id === m.id)) kept.push({ ...p, id: m.id, at: p.at || m.at, rel: m.at });
  }
  kept.sort((a, b) => (a.rel === b.rel ? b.id - a.id : a.rel < b.rel ? 1 : -1));
  store.set(key, kept.slice(0, 50));
  if (messages.length) await api('POST', link.rid + '/ack', { ids: messages.map((m) => m.id) }).catch(() => {});
  return h(
    'div',
    { class: 'tc' },
    h('div', { class: 'card' }, h('h2', {}, t.contactOf(name)), pushHint(link, info)),
    kept.length ? kept.map(msgView) : h('p', { class: 'muted' }, t.nothing),
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => stop(link) }, t.stop)),
  );
}

async function stop(link) {
  await api('DELETE', link.rid).catch(() => {});
  links = links.filter((l) => l.rid !== link.rid);
  store.set('tc.links', links);
  try {
    localStorage.removeItem('tc.msgs.' + link.rid);
  } catch {
    /* ignore */
  }
  main.replaceChildren(h('div', { class: 'card' }, h('p', {}, t.stopped)));
}

let busy = false;
async function render() {
  if (busy) return;
  busy = true;
  try {
    if (!links.length) {
      main.replaceChildren(h('div', { class: 'card' }, h('p', {}, frag ? t.bad : t.gone)));
      return;
    }
    const views = await Promise.all(links.map(linkView));
    main.replaceChildren(h('div', { class: 'tc' }, views));
  } catch {
    main.replaceChildren(h('p', { class: 'muted' }, t.error));
  } finally {
    busy = false;
  }
}

render();
setInterval(() => document.visibilityState === 'visible' && render(), 30000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && render());
