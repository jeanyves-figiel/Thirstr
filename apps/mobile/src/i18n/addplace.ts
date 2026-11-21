import { getLocales } from 'expo-localization';

// #191 Add a place (F-12 R-12.11): a member pins a place where they are and checks in.
const en = {
  row: 'Add a place',
  rowSub: 'Not listed? Add where you are and check in',
  title: 'Add a place',
  name: 'Name',
  namePh: 'e.g. Café Hinterhof',
  what: 'What is it?',
  kinds: {
    club: 'Club',
    bar: 'Bar',
    sauna: 'Sauna',
    gym: 'Gym',
    other: 'Other',
  } as Record<string, string>,
  locating: 'Finding your exact position…',
  accuracy: (m: number) => `Your exact position · ±${m} m`,
  weak: 'GPS is too vague here. Step outside or wait a moment.',
  noLocation: 'Turn on location for Thirstr to add a place where you are.',
  retry: 'Try again',
  warnTitle: 'This shares your exact location',
  warnBody: 'The place is pinned exactly where you are now. Everyone on Thirstr will see it on the map and can check in. Never add a home or a private address.',
  add: 'I understand, add & check in',
  review: 'Our team may review or remove places later.',
  exists: (n: string) => `${n} is already on Thirstr, right here.`,
  checkInThere: 'Check in there',
  member: 'Added by a member',
  remove: 'Remove this place',
  removeSub: 'Only you, while nobody else is checked in',
};
type S = typeof en;

const fr: S = {
  row: 'Ajouter un lieu',
  rowSub: 'Pas dans la liste ? Ajoute l’endroit où tu es et fais ton check-in',
  title: 'Ajouter un lieu',
  name: 'Nom',
  namePh: 'ex. Café Hinterhof',
  what: 'C’est quoi ?',
  kinds: {
    club: 'Club',
    bar: 'Bar',
    sauna: 'Sauna',
    gym: 'Salle',
    other: 'Autre',
  },
  locating: 'Recherche de ta position exacte…',
  accuracy: (m) => `Ta position exacte · ±${m} m`,
  weak: 'Le GPS est trop imprécis ici. Sors ou attends un instant.',
  noLocation: 'Active la localisation pour Thirstr pour ajouter l’endroit où tu es.',
  retry: 'Réessayer',
  warnTitle: 'Ceci partage ta position exacte',
  warnBody: 'Le lieu est épinglé exactement là où tu es. Tout le monde sur Thirstr le verra sur la carte et pourra y faire son check-in. N’ajoute jamais un domicile ou une adresse privée.',
  add: 'J’ai compris, ajouter et check-in',
  review: 'Notre équipe peut vérifier ou retirer des lieux plus tard.',
  exists: (n) => `${n} est déjà sur Thirstr, juste ici.`,
  checkInThere: 'Faire le check-in là',
  member: 'Ajouté par un membre',
  remove: 'Retirer ce lieu',
  removeSub: 'Toi seul, tant que personne d’autre n’est là',
};

const de: S = {
  row: 'Ort hinzufügen',
  rowSub: 'Nicht dabei? Füge hinzu, wo du bist, und checke ein',
  title: 'Ort hinzufügen',
  name: 'Name',
  namePh: 'z. B. Café Hinterhof',
  what: 'Was ist es?',
  kinds: {
    club: 'Club',
    bar: 'Bar',
    sauna: 'Sauna',
    gym: 'Gym',
    other: 'Anderes',
  },
  locating: 'Suche deine genaue Position…',
  accuracy: (m) => `Deine genaue Position · ±${m} m`,
  weak: 'GPS ist hier zu ungenau. Geh nach draussen oder warte kurz.',
  noLocation: 'Schalte den Standort für Thirstr ein, um einen Ort hinzuzufügen, wo du bist.',
  retry: 'Nochmal',
  warnTitle: 'Das teilt deinen genauen Standort',
  warnBody: 'Der Ort wird genau da gepinnt, wo du jetzt bist. Alle auf Thirstr sehen ihn auf der Karte und können einchecken. Füge nie ein Zuhause oder eine private Adresse hinzu.',
  add: 'Verstanden, hinzufügen & einchecken',
  review: 'Unser Team kann Orte später prüfen oder entfernen.',
  exists: (n) => `${n} ist schon auf Thirstr, genau hier.`,
  checkInThere: 'Dort einchecken',
  member: 'Von einem Mitglied hinzugefügt',
  remove: 'Diesen Ort entfernen',
  removeSub: 'Nur du, solange sonst niemand eingecheckt ist',
};

const lang = getLocales()[0]?.languageCode ?? 'en';
export const ap: S = lang === 'fr' ? fr : lang === 'de' ? de : en;
export { en as apEn, fr as apFr, de as apDe };
