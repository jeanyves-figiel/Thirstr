// Labels for profile option values (GET /profile-options). en is the reference; fr/de translate.
// Languages show their own name (endonym), the same in every app language.
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', fr: 'Français', de: 'Deutsch', it: 'Italiano', es: 'Español', pt: 'Português', nl: 'Nederlands',
  pl: 'Polski', tr: 'Türkçe', ru: 'Русский', ar: 'العربية', he: 'עברית', ja: '日本語', zh: '中文', id: 'Bahasa Indonesia',
  th: 'ไทย', hi: 'हिन्दी', sv: 'Svenska', da: 'Dansk', no: 'Norsk', fi: 'Suomi', cs: 'Čeština', el: 'Ελληνικά',
  hu: 'Magyar', ro: 'Română', uk: 'Українська',
};

type Dict = Record<string, string>;

// Only values whose en label is not just the capitalised value.
const en: Dict = {
  vers_top: 'Vers top', vers_bottom: 'Vers bottom', pos_undetectable: 'Poz, undetectable', neg: 'Negative', pos: 'Positive',
  ask: 'Ask me', doxypep: 'DoxyPEP', can_host: 'Can host', can_travel: 'Can travel', either: 'Either', neither: 'Neither',
  very: 'Very hairy', complicated: "It's complicated", safer_only: 'Safer only', bdsm: 'BDSM', clean_cut: 'Clean-cut',
  martial_arts: 'Martial arts', crossfit: 'CrossFit', perfect_night: 'My perfect night', ask_me_about: 'Ask me about',
  green_flag: 'Green flag', weekend: 'This weekend', looking_for_someone_who: 'Looking for someone who',
  just_sport: 'Just sport', open_to_more: 'Open to more', on: 'On PrEP', off: 'Not on PrEP',
};

const fr: Dict = {
  top: 'Actif', vers_top: 'Plutôt actif', vers: 'Versa', vers_bottom: 'Plutôt passif', bottom: 'Passif', side: 'Side',
  slim: 'Mince', fit: 'Sportif', muscular: 'Musclé', average: 'Moyen', stocky: 'Trapu', large: 'Fort',
  mornings: 'Matin', lunch: 'Midi', evenings: 'Soir', weekends: 'Week-end',
  single: 'Célibataire', partnered: 'En couple', open: 'Couple libre', poly: 'Poly', complicated: "C'est compliqué",
  gym: 'Muscu', running: 'Course', cycling: 'Vélo', swimming: 'Natation', climbing: 'Escalade', football: 'Foot',
  basketball: 'Basket', volleyball: 'Volley', tennis: 'Tennis', padel: 'Padel', yoga: 'Yoga', crossfit: 'CrossFit',
  hiking: 'Randonnée', skiing: 'Ski', martial_arts: 'Arts martiaux', dance: 'Danse', rugby: 'Rugby', rowing: 'Aviron', other: 'Autre',
  none: 'Aucun', stubble: 'Barbe de 3 jours', short: 'Courte', full: 'Fournie', light: 'Léger', moderate: 'Moyen', hairy: 'Poilu', very: 'Très poilu',
  neg: 'Négatif', pos_undetectable: 'Positif, indétectable', pos: 'Positif', ask: 'Demande-moi',
  can_host: 'Je reçois', can_travel: 'Je me déplace', either: 'Les deux', neither: 'Ni l’un ni l’autre',
  hookup: 'Plan', now: 'Maintenant', tonight: 'Ce soir', chat: 'Discuter', dates: 'Dates', friends: 'Amis', activities: 'Activités',
  gay: 'Gay', bi: 'Bi', queer: 'Queer', pan: 'Pan', curious: 'Curieux',
  oral: 'Oral', kissing: 'Bisous', cuddling: 'Câlins', massage: 'Massage', kink: 'Kink', bdsm: 'BDSM', fetish: 'Fétiche',
  group: 'Groupe', watching: 'Mater', rimming: 'Anulingus', fisting: 'Fist', toys: 'Jouets', roleplay: 'Jeu de rôle', safer_only: 'Safe uniquement',
  on: 'Sous PrEP', off: 'Pas de PrEP', doxypep: 'DoxyPEP',
  perfect_night: 'Ma soirée idéale', ask_me_about: 'Parle-moi de', green_flag: 'Green flag', weekend: 'Ce week-end', looking_for_someone_who: 'Je cherche quelqu’un qui',
  just_sport: 'Juste le sport', open_to_more: 'Ouvert à plus',
  beginner: 'Débutant', casual: 'Loisir', intermediate: 'Intermédiaire', advanced: 'Avancé', competitive: 'Compétition',
  bear: 'Ours', twink: 'Minet', jock: 'Sportif', otter: 'Loutre', daddy: 'Daddy', geek: 'Geek', leather: 'Cuir', pup: 'Pup',
  rugged: 'Viril', trans: 'Trans', clean_cut: 'Soigné', chub: 'Chub', muscle: 'Muscle', discreet: 'Discret',
};

const de: Dict = {
  top: 'Top', vers_top: 'Eher Top', vers: 'Vers', vers_bottom: 'Eher Bottom', bottom: 'Bottom', side: 'Side',
  slim: 'Schlank', fit: 'Sportlich', muscular: 'Muskulös', average: 'Durchschnitt', stocky: 'Stämmig', large: 'Kräftig',
  mornings: 'Morgens', lunch: 'Mittags', evenings: 'Abends', weekends: 'Wochenende',
  single: 'Single', partnered: 'Vergeben', open: 'Offene Beziehung', poly: 'Poly', complicated: 'Kompliziert',
  gym: 'Gym', running: 'Laufen', cycling: 'Radfahren', swimming: 'Schwimmen', climbing: 'Klettern', football: 'Fußball',
  basketball: 'Basketball', volleyball: 'Volleyball', tennis: 'Tennis', padel: 'Padel', yoga: 'Yoga', crossfit: 'CrossFit',
  hiking: 'Wandern', skiing: 'Ski', martial_arts: 'Kampfsport', dance: 'Tanzen', rugby: 'Rugby', rowing: 'Rudern', other: 'Anderes',
  none: 'Keine', stubble: 'Dreitagebart', short: 'Kurz', full: 'Vollbart', light: 'Leicht', moderate: 'Mittel', hairy: 'Behaart', very: 'Sehr behaart',
  neg: 'Negativ', pos_undetectable: 'Positiv, unter der Nachweisgrenze', pos: 'Positiv', ask: 'Frag mich',
  can_host: 'Bei mir', can_travel: 'Bei dir', either: 'Beides', neither: 'Weder noch',
  hookup: 'Hookup', now: 'Jetzt', tonight: 'Heute Nacht', chat: 'Chatten', dates: 'Dates', friends: 'Freunde', activities: 'Aktivitäten',
  gay: 'Schwul', bi: 'Bi', queer: 'Queer', pan: 'Pan', curious: 'Neugierig',
  oral: 'Oral', kissing: 'Küssen', cuddling: 'Kuscheln', massage: 'Massage', kink: 'Kink', bdsm: 'BDSM', fetish: 'Fetisch',
  group: 'Gruppe', watching: 'Zuschauen', rimming: 'Rimming', fisting: 'Fisting', toys: 'Toys', roleplay: 'Rollenspiel', safer_only: 'Nur safe',
  on: 'Nehme PrEP', off: 'Keine PrEP', doxypep: 'DoxyPEP',
  perfect_night: 'Mein perfekter Abend', ask_me_about: 'Frag mich nach', green_flag: 'Green Flag', weekend: 'Dieses Wochenende', looking_for_someone_who: 'Ich suche jemanden, der',
  just_sport: 'Nur Sport', open_to_more: 'Offen für mehr',
  beginner: 'Anfänger', casual: 'Locker', intermediate: 'Mittel', advanced: 'Fortgeschritten', competitive: 'Wettkampf',
  bear: 'Bär', twink: 'Twink', jock: 'Jock', otter: 'Otter', daddy: 'Daddy', geek: 'Geek', leather: 'Leder', pup: 'Pup',
  rugged: 'Rau', trans: 'Trans', clean_cut: 'Gepflegt', chub: 'Chub', muscle: 'Muskel', discreet: 'Diskret',
};

export const OPTION_LABELS: Record<string, Dict> = { en, fr: { ...en, ...fr }, de: { ...en, ...de } };
