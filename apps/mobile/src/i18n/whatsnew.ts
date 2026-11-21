import { getLocales } from 'expo-localization';

// F-17 R-17.15 (#238): What's new card + history.
const en = {
  title: "What's new",
  newIn: (v: string) => `New in ${v}`,
  things: (n: number) => `${n} ${n === 1 ? 'thing' : 'things'} · tap for more`,
  close: 'Close',
  version: (v: string) => `Version ${v}`,
  gotIt: 'Got it',
  earlier: (n: number) => `+ ${n} earlier ${n === 1 ? 'update' : 'updates'}`,
  findAgain: "Find it again in Settings › What's new",
  isNew: 'New',
  open: (t: string) => `${t}, open`,
  empty: 'Nothing new yet.',
};
type S = typeof en;
const fr: S = {
  title: 'Quoi de neuf',
  newIn: (v) => `Nouveau dans la ${v}`,
  things: (n) => `${n} ${n === 1 ? 'nouveauté' : 'nouveautés'} · touche pour voir`,
  close: 'Fermer',
  version: (v) => `Version ${v}`,
  gotIt: 'Compris',
  earlier: (n) => `+ ${n} ${n === 1 ? 'mise à jour précédente' : 'mises à jour précédentes'}`,
  findAgain: 'Retrouve-le dans Réglages › Quoi de neuf',
  isNew: 'Nouveau',
  open: (t) => `${t}, ouvrir`,
  empty: 'Rien de neuf pour l’instant.',
};
const de: S = {
  title: 'Neu in Thirstr',
  newIn: (v) => `Neu in ${v}`,
  things: (n) => `${n} ${n === 1 ? 'Neuerung' : 'Neuerungen'} · tippen für mehr`,
  close: 'Schließen',
  version: (v) => `Version ${v}`,
  gotIt: 'Verstanden',
  earlier: (n) => `+ ${n} ${n === 1 ? 'frühere Version' : 'frühere Versionen'}`,
  findAgain: 'Wieder zu finden unter Einstellungen › Neu in Thirstr',
  isNew: 'Neu',
  open: (t) => `${t}, öffnen`,
  empty: 'Noch nichts Neues.',
};

export const wnLang = getLocales()[0]?.languageCode ?? 'en';
export const wn: S = wnLang === 'fr' ? fr : wnLang === 'de' ? de : en;
export { en as wnEn, fr as wnFr, de as wnDe };
