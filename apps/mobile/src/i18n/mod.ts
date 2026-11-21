import { getLocales } from 'expo-localization';

// Hide / Block / Report everywhere (#111, F-15 R-15.17–R-15.22, S-21/S-51/S-71). en/fr/de; English is the fallback.
const en = {
  hide: 'Hide',
  hideSub: 'Not shown to you',
  block: 'Block',
  blockSub: 'No contact, both ways',
  report: 'Report',
  reportSub: 'Tell Thirstr, anonymous',
  never: (n: string) => `${n} is never told you hid, blocked or reported.`,
  manage: 'Settings › Hidden & blocked',
  hidden: (n: string) => `${n} hidden`,
  blocked: (n: string) => `${n} blocked`,
  undo: 'Undo',
  blockTitle: (n: string) => `Block ${n}?`,
  blockPoints: ['You won’t see each other anywhere', 'Your chat closes and taps are removed', 'They aren’t told'],
  cancel: 'Cancel',
  openProfile: 'Open profile',
  tapped: (n: string) => `Tap sent to ${n}`,
  online: 'Online',
  holdHint: 'Hold a tile for Hide, Block, Report',
  list: {
    title: 'Hidden & blocked',
    row: 'Hidden & blocked',
    hiddenTab: (n: number) => `Hidden · ${n}`,
    blockedTab: (n: number) => `Blocked · ${n}`,
    hiddenWhy: 'Hidden people are not on your map or grid. Chats with them still work.',
    blockedWhy: 'Blocked people can’t see or message you, and you can’t see them.',
    unhide: 'Unhide',
    unblock: 'Unblock',
    unhidden: (n: string) => `${n} is back in Explore`,
    unblocked: (n: string) => `${n} unblocked`,
    emptyHidden: 'Nobody hidden',
    emptyBlocked: 'Nobody blocked',
    emptySub: 'Hold anyone on the map, grid or in Chats to hide or block them.',
    ago: (d: number) => (d < 1 ? 'today' : d < 7 ? `${d} d ago` : `${Math.floor(d / 7)} w ago`),
  },
};
type V = typeof en;
type P<T> = {
  [K in keyof T]?: T[K] extends (...a: never[]) => unknown ? T[K] : T[K] extends unknown[] ? T[K] : T[K] extends object ? P<T[K]> : T[K];
};

const fr: P<V> = {
  hide: 'Masquer',
  hideSub: 'Tu ne le vois plus',
  block: 'Bloquer',
  blockSub: 'Plus aucun contact',
  report: 'Signaler',
  reportSub: 'À Thirstr, anonyme',
  never: (n: string) => `${n} ne saura jamais que tu l’as masqué, bloqué ou signalé.`,
  manage: 'Réglages › Masqués et bloqués',
  hidden: (n: string) => `${n} masqué`,
  blocked: (n: string) => `${n} bloqué`,
  undo: 'Annuler',
  blockTitle: (n: string) => `Bloquer ${n} ?`,
  blockPoints: ['Vous ne vous verrez plus nulle part', 'Votre chat se ferme et les taps sont effacés', 'Il n’est pas prévenu'],
  cancel: 'Annuler',
  openProfile: 'Voir le profil',
  tapped: (n: string) => `Tap envoyé à ${n}`,
  online: 'En ligne',
  holdHint: 'Reste appuyé sur une vignette pour masquer, bloquer, signaler',
  list: {
    title: 'Masqués et bloqués',
    row: 'Masqués et bloqués',
    hiddenTab: (n: number) => `Masqués · ${n}`,
    blockedTab: (n: number) => `Bloqués · ${n}`,
    hiddenWhy: 'Les profils masqués n’apparaissent plus sur ta carte ni ta grille. Vos chats continuent.',
    blockedWhy: 'Les profils bloqués ne peuvent ni te voir ni t’écrire, et tu ne les vois plus.',
    unhide: 'Afficher',
    unblock: 'Débloquer',
    unhidden: (n: string) => `${n} est de retour dans Explorer`,
    unblocked: (n: string) => `${n} débloqué`,
    emptyHidden: 'Personne de masqué',
    emptyBlocked: 'Personne de bloqué',
    emptySub: 'Reste appuyé sur quelqu’un (carte, grille, Messages) pour le masquer ou le bloquer.',
    ago: (d: number) => (d < 1 ? 'aujourd’hui' : d < 7 ? `il y a ${d} j` : `il y a ${Math.floor(d / 7)} sem.`),
  },
};

const de: P<V> = {
  hide: 'Ausblenden',
  hideSub: 'Du siehst ihn nicht mehr',
  block: 'Blockieren',
  blockSub: 'Kein Kontakt mehr',
  report: 'Melden',
  reportSub: 'An Thirstr, anonym',
  never: (n: string) => `${n} erfährt nie, dass du ihn ausgeblendet, blockiert oder gemeldet hast.`,
  manage: 'Einstellungen › Ausgeblendet & blockiert',
  hidden: (n: string) => `${n} ausgeblendet`,
  blocked: (n: string) => `${n} blockiert`,
  undo: 'Rückgängig',
  blockTitle: (n: string) => `${n} blockieren?`,
  blockPoints: ['Ihr seht euch nirgends mehr', 'Euer Chat wird geschlossen, Taps werden gelöscht', 'Er wird nicht benachrichtigt'],
  cancel: 'Abbrechen',
  openProfile: 'Profil öffnen',
  tapped: (n: string) => `Tap an ${n} gesendet`,
  online: 'Online',
  holdHint: 'Kachel gedrückt halten: Ausblenden, Blockieren, Melden',
  list: {
    title: 'Ausgeblendet & blockiert',
    row: 'Ausgeblendet & blockiert',
    hiddenTab: (n: number) => `Ausgeblendet · ${n}`,
    blockedTab: (n: number) => `Blockiert · ${n}`,
    hiddenWhy: 'Ausgeblendete Profile sind nicht auf deiner Karte oder im Raster. Chats gehen weiter.',
    blockedWhy: 'Blockierte Profile können dich weder sehen noch anschreiben, und du siehst sie nicht.',
    unhide: 'Einblenden',
    unblock: 'Freigeben',
    unhidden: (n: string) => `${n} ist wieder in Entdecken`,
    unblocked: (n: string) => `${n} freigegeben`,
    emptyHidden: 'Niemand ausgeblendet',
    emptyBlocked: 'Niemand blockiert',
    emptySub: 'Halte jemanden auf Karte, Raster oder in Chats gedrückt, um ihn auszublenden oder zu blockieren.',
    ago: (d: number) => (d < 1 ? 'heute' : d < 7 ? `vor ${d} T.` : `vor ${Math.floor(d / 7)} W.`),
  },
};

function merge<T>(base: T, over: P<T> | undefined): T {
  if (!over) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b) ? merge(b, v as P<typeof b>) : v;
  }
  return out as T;
}

const lang = getLocales()[0]?.languageCode ?? 'en';
export const mod: V = lang === 'fr' ? merge(en, fr) : lang === 'de' ? merge(en, de) : en;
export { en as modEn, fr as modFr, de as modDe };
