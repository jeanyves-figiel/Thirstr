import { getLocales } from 'expo-localization';

// #113 merged map: intent chips, intent ring labels, place layers and place card (F-04 R-04.18–R-04.20).
const en = {
  intent: (m: string, n: string) => `${m}, ${n} around`,
  intentsLabel: 'Looking for',
  and: 'and',
  lookingFor: (who: string, list: string, dist: string) => `${who}, looking for ${list}, ${dist}`,
  layersLabel: 'Places on map',
  layer: { clubs: 'Clubs', saunas: 'Saunas', parties: 'Parties', gyms: 'Gyms' } as Record<string, string>,
  kind: { club: 'CLUB', bar: 'BAR', sauna: 'SAUNA', gym: 'GYM', official: 'OFFICIAL PARTY', hosted: 'HOSTED PARTY' } as Record<string, string>,
  here: (n: string) => `${n} here`,
  aFew: 'A few here',
  tonight: 'TONIGHT',
  at: (v: string) => `at ${v}`,
  seats: (t: number, c: number) => `${t} of ${c} seats taken`,
  areaOnly: 'Area only, the host sends the address',
  checkIn: 'Check in',
  directions: 'Directions',
  details: 'Details',
  join: 'Request to join',
  osm: '© OpenStreetMap contributors',
  close: 'Close',
  open: (h: string) => `Hours: ${h}`,
};
type S = typeof en;

const fr: S = {
  intent: (m, n) => `${m}, ${n} autour`,
  intentsLabel: 'Recherche',
  and: 'et',
  lookingFor: (who, list, dist) => `${who}, cherche ${list}, ${dist}`,
  layersLabel: 'Lieux sur la carte',
  layer: { clubs: 'Clubs', saunas: 'Saunas', parties: 'Soirées', gyms: 'Salles' },
  kind: { club: 'CLUB', bar: 'BAR', sauna: 'SAUNA', gym: 'SALLE DE SPORT', official: 'SOIRÉE OFFICIELLE', hosted: 'SOIRÉE PRIVÉE' },
  here: (n) => `${n} sur place`,
  aFew: 'Quelques-uns sur place',
  tonight: 'CE SOIR',
  at: (v) => `à ${v}`,
  seats: (t, c) => `${t} places prises sur ${c}`,
  areaOnly: 'Zone seulement, l’hôte envoie l’adresse',
  checkIn: 'Check-in',
  directions: 'Itinéraire',
  details: 'Détails',
  join: 'Demander à venir',
  osm: '© Contributeurs OpenStreetMap',
  close: 'Fermer',
  open: (h) => `Horaires : ${h}`,
};

const de: S = {
  intent: (m, n) => `${m}, ${n} in der Nähe`,
  intentsLabel: 'Sucht',
  and: 'und',
  lookingFor: (who, list, dist) => `${who}, sucht ${list}, ${dist}`,
  layersLabel: 'Orte auf der Karte',
  layer: { clubs: 'Clubs', saunas: 'Saunas', parties: 'Partys', gyms: 'Gyms' },
  kind: { club: 'CLUB', bar: 'BAR', sauna: 'SAUNA', gym: 'GYM', official: 'OFFIZIELLE PARTY', hosted: 'PRIVATE PARTY' },
  here: (n) => `${n} hier`,
  aFew: 'Ein paar hier',
  tonight: 'HEUTE',
  at: (v) => `im ${v}`,
  seats: (t, c) => `${t} von ${c} Plätzen belegt`,
  areaOnly: 'Nur Gegend, der Host schickt die Adresse',
  checkIn: 'Einchecken',
  directions: 'Route',
  details: 'Details',
  join: 'Anfragen',
  osm: '© OpenStreetMap-Mitwirkende',
  close: 'Schliessen',
  open: (h) => `Öffnungszeiten: ${h}`,
};

const lang = getLocales()[0]?.languageCode ?? 'en';
export const pl: S = lang === 'fr' ? fr : lang === 'de' ? de : en;
export { en as plEn, fr as plFr, de as plDe };
