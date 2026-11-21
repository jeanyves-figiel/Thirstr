import { getLocales } from 'expo-localization';

// App v2 copy additions (issue 58). en/fr/de; English is the fallback.
const en = {
  inbox: { all: 'All', unread: 'Unread', e2ee: 'All chats end-to-end encrypted', muted: 'Muted', none: 'Nothing unread.' },
  explore: { nearby: (n: number) => `${n} nearby` },
  party: { going: 'going', who: 'who can join', rating: 'liked it', rules: 'House rules' },
  albums: { private: 'Private' },
  settings: { visibleTo: 'Visible to ages', quick: (n: number) => `Quick reply ${n}` },
};
type V = typeof en;
const fr: V = {
  inbox: { all: 'Tous', unread: 'Non lus', e2ee: 'Toutes les discussions chiffrées de bout en bout', muted: 'Muet', none: 'Rien de non lu.' },
  explore: { nearby: (n) => `${n} à proximité` },
  party: { going: 'inscrits', who: 'qui peut venir', rating: 'ont aimé', rules: 'Règles de la maison' },
  albums: { private: 'Privé' },
  settings: { visibleTo: 'Visible pour les âges', quick: (n) => `Réponse rapide ${n}` },
};
const de: V = {
  inbox: { all: 'Alle', unread: 'Ungelesen', e2ee: 'Alle Chats Ende-zu-Ende-verschlüsselt', muted: 'Stumm', none: 'Nichts Ungelesenes.' },
  explore: { nearby: (n) => `${n} in der Nähe` },
  party: { going: 'dabei', who: 'wer darf kommen', rating: 'fanden es gut', rules: 'Hausregeln' },
  albums: { private: 'Privat' },
  settings: { visibleTo: 'Sichtbar für Alter', quick: (n) => `Schnellantwort ${n}` },
};
const lang = getLocales()[0]?.languageCode ?? 'en';
export const v2: V = lang === 'fr' ? fr : lang === 'de' ? de : en;
