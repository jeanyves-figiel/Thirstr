import { getLocales } from 'expo-localization';

// Onboarding v2 copy (F-02 R-02.1a…g, issue 54). en/fr/de; English is the fallback.
const en = {
  back: 'Back',
  step: (n: number, total: number) => `Step ${n} of ${total}`,
  cont: 'Continue',
  welcome: {
    live: (area: string | null) => (area ? `Live around ${area}` : 'Live near you'),
    count: (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} guys around you.`,
    joining: 'Guys are joining near you.',
    promises: ['No phone number. Ever.', 'You choose how precisely you show up.', 'Chats end-to-end encrypted.'],
    start: 'Get started',
    login: 'I already have an account',
    link: 'Use this account on a new phone',
  },
  signup: {
    title: 'Let’s get you in.',
    sub: 'About a minute. No phone number, no password.',
    loginTitle: 'Welcome back.',
    loginSub: 'Sign in the way you signed up.',
    apple: 'Continue with Apple',
    passkey: 'Use a passkey',
    google: 'Continue with Google',
    email: 'Email me a sign-in link',
    emailPh: 'you@example.com',
    send: 'Send link',
    consent: ['By continuing you confirm you’re ', '18 or older', ' and accept the Terms and Privacy Policy.'] as [string, string, string],
  },
  name: { title: 'What should guys call you?', sub: 'A first name or a nickname. You can change it anytime.', ph: 'Your name' },
  birthday: {
    title: (name: string) => (name ? `When’s your birthday, ${name}?` : 'When’s your birthday?'),
    sub: 'Only your age is shown. Never your birthday.',
    age: (n: number) => `You’ll show as ${n}`,
    tooYoung: 'You need to be 18+',
    day: 'Day',
    month: 'Month',
    year: 'Year',
  },
  identity: {
    title: 'How do you identify?',
    sub: 'Thirstr is for every guy. Pick what fits.',
    options: { man: 'Man', trans_man: 'Trans man', non_binary: 'Non-binary', other: 'Something else', unspecified: 'Prefer not to say' } as Record<string, string>,
    otherPh: 'Your word for it',
  },
  herefor: {
    title: 'What are you up for?',
    sub: 'Pick as many as you like. Change it anytime.',
    tiles: {
      hookup: ['Hookups', 'The main event'],
      tonight: ['Tonight', 'Free right now'],
      chat: ['Chat', 'Talk first, see after'],
      friends: ['Friends', 'New people, no pressure'],
      sport: ['Sport', 'Gym, runs, games'],
    } as Record<string, [string, string]>,
  },
  underage: { title: 'Come back when you’re 18.', body: 'Thirstr is for adults only. We’ve deleted what you entered.' },
  update: { title: 'Time for an update.', body: 'This version of Thirstr is too old to keep you safe and in sync. Update to carry on. Your chats stay on this phone.', cta: 'Update Thirstr' },
  location: {
    title: 'How should you show up?',
    levels: {
      hidden: ['Hidden', 'Verify first, then browse without showing up.'],
      city: ['City', 'Just your city. No distance shown.'],
      area: ['Area', 'A ~200 m zone. Widens if few guys are around.'],
      exact: ['Exact', 'Your pin, slightly shifted, for 1 h. Then gone.'],
    } as Record<string, [string, string]>,
    exactLocked: 'Verify first, then share a pin for up to 4 h.',
    caption: { hidden: 'Not on the map', city: 'Your city', area: '~200 m zone', exact: 'Pin for 1 h' } as Record<string, string>,
    defaultBadge: 'Default',
    footer: 'Your coordinates never leave your phone.',
    allow: 'Allow location',
    pickCity: 'Pick my city',
    cityTitle: 'Which city are you in?',
    citySub: 'No problem. You show up as being in your city.',
    cityPh: 'Search city',
    closer: {
      title: 'Show guys how close you are?',
      yes: ['~150 m', 'Yes, ~50 m zone. Better matches nearby.'] as [string, string],
      no: ['200–500 m', 'No, keep the ~200 m zone.'] as [string, string],
      foot: 'Never your exact spot. Change it any time on Me.',
      caption: '~50 m zone',
    },
  },
  photo: {
    title: 'Show yourself.',
    sub: 'Face or no face, your call. Keep it vanilla; spicy goes in extras or private albums.',
    add: 'Add main photo',
    main: 'Main',
    hint: 'Good light, just you. No face is fine. Checked in seconds.',
    later: 'Add it later',
    laterNote: 'Nobody sees you until you add one.',
    checking: 'Quick check: a person, nothing explicit…',
    ok: 'Looks great. Add up to 4 more, or keep going.',
    choose: 'Choose photo',
    checkingCta: 'Checking…',
    extra: 'Add extra photo',
  },
  verify: {
    title: 'Get the teal check.',
    sub: 'Prove you’re real with a quick selfie check. 30 seconds.',
    perks: [
      ['Verified badge', ' on your profile and pin'],
      ['Unlocks Hidden', ': browse without showing up'],
      ['Checked on your phone.', ' Frames deleted instantly. We never see your face.'],
    ] as [string, string][],
    now: 'Verify now',
    later: 'Later',
    done: 'Verified.',
  },
  done: {
    title: (name: string) => `You’re in, ${name}.`,
    sub: 'This is how guys will see you.',
    cta: 'See who’s around',
    level: { hidden: 'Hidden', city: 'City', area: '~200 m away', exact: 'Exact · 1 h' } as Record<string, string>,
  },
};

type O = typeof en;

const fr: O = {
  ...en,
  back: 'Retour',
  step: (n, total) => `Étape ${n} sur ${total}`,
  cont: 'Continuer',
  welcome: { live: (a) => (a ? `En direct autour de ${a}` : 'En direct près de toi'), count: (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')} mecs autour de toi.`, joining: 'Des mecs arrivent près de toi.', promises: ['Jamais de numéro de téléphone.', 'Tu choisis ta précision sur la carte.', 'Discussions chiffrées de bout en bout.'], start: 'Commencer', login: 'J’ai déjà un compte', link: 'Utiliser ce compte sur un nouveau téléphone' },
  signup: { ...en.signup, title: 'On y va.', sub: 'Une minute. Ni téléphone, ni mot de passe.', loginTitle: 'Content de te revoir.', loginSub: 'Connecte-toi comme à l’inscription.', apple: 'Continuer avec Apple', passkey: 'Utiliser une clé d’accès', google: 'Continuer avec Google', email: 'Recevoir un lien par e-mail', emailPh: 'toi@exemple.fr', send: 'Envoyer le lien', consent: ['En continuant, tu confirmes avoir ', '18 ans ou plus', ' et acceptes les Conditions et la Politique de confidentialité.'] },
  name: { title: 'Comment les mecs t’appellent ?', sub: 'Un prénom ou un surnom. Modifiable à tout moment.', ph: 'Ton prénom' },
  birthday: { ...en.birthday, title: (n) => (n ? `Ta date de naissance, ${n} ?` : 'Ta date de naissance ?'), sub: 'Seul ton âge est affiché. Jamais ta date.', age: (n) => `Tu apparaîtras avec ${n} ans`, tooYoung: 'Il faut avoir 18 ans', day: 'Jour', month: 'Mois', year: 'Année' },
  identity: { title: 'Tu te définis comment ?', sub: 'Thirstr est pour tous les mecs. Choisis ce qui te va.', options: { man: 'Homme', trans_man: 'Homme trans', non_binary: 'Non-binaire', other: 'Autre chose', unspecified: 'Je préfère ne pas le dire' }, otherPh: 'Ton mot à toi' },
  herefor: { title: 'Tu es partant pour quoi ?', sub: 'Autant que tu veux. Modifiable à tout moment.', tiles: { hookup: ['Plans', 'Le cœur du truc'], tonight: ['Ce soir', 'Dispo maintenant'], chat: ['Discuter', 'D’abord parler'], friends: ['Amis', 'Des gens, sans pression'], sport: ['Sport', 'Salle, running, matchs'] } },
  underage: { title: 'Reviens à tes 18 ans.', body: 'Thirstr est réservé aux adultes. On a supprimé ce que tu as saisi.' },
  update: { title: 'Une mise à jour s’impose.', body: 'Cette version de Thirstr est trop ancienne pour rester sûre et synchronisée. Mets-la à jour pour continuer. Tes discussions restent sur ce téléphone.', cta: 'Mettre à jour Thirstr' },
  location: { ...en.location, title: 'Comment veux-tu apparaître ?', levels: { hidden: ['Caché', 'Vérifie-toi d’abord, puis navigue sans apparaître.'], city: ['Ville', 'Juste ta ville. Aucune distance.'], area: ['Zone', 'Une zone d’environ 200 m. S’élargit s’il y a peu de monde.'], exact: ['Exact', 'Ton épingle, légèrement décalée, pendant 1 h. Puis elle disparaît.'] }, caption: { hidden: 'Pas sur la carte', city: 'Ta ville', area: 'Zone ~200 m', exact: 'Épingle 1 h' }, defaultBadge: 'Par défaut', exactLocked: 'Vérifie-toi d’abord, puis partage une épingle jusqu’à 4 h.', footer: 'Tes coordonnées ne quittent jamais ton téléphone.', allow: 'Autoriser la localisation', pickCity: 'Choisir ma ville', cityTitle: 'Tu es dans quelle ville ?', citySub: 'Pas de souci. Tu apparais dans ta ville.', cityPh: 'Chercher une ville', closer: { title: 'Montrer à quelle distance tu es ?', yes: ['~150 m', 'Oui, zone de ~50 m. De meilleurs matchs autour.'], no: ['200–500 m', 'Non, garder la zone de ~200 m.'], foot: 'Jamais ta position exacte. Modifiable à tout moment dans Moi.', caption: 'Zone ~50 m' } },
  photo: { title: 'Montre-toi.', sub: 'Avec ou sans visage, c’est toi qui vois. Photo principale soft ; le hot va dans les extras ou les albums privés.', later: 'Plus tard', laterNote: 'Personne ne te voit tant que tu n’en as pas ajouté une.', add: 'Ajouter la photo principale', main: 'Principale', hint: 'Bonne lumière, toi seul. Sans visage, ça marche aussi. Vérifié en quelques secondes.', checking: 'Petite vérif : une personne, rien d’explicite…', ok: 'Parfait. Ajoute jusqu’à 4 autres, ou continue.', choose: 'Choisir une photo', checkingCta: 'Vérification…', extra: 'Ajouter une photo' },
  verify: { title: 'Obtiens le badge turquoise.', sub: 'Prouve que tu es réel avec un selfie rapide. 30 secondes.', perks: [['Badge vérifié', ' sur ton profil et ton épingle'], ['Débloque Caché', ' : navigue sans apparaître'], ['Vérifié sur ton téléphone.', ' Images supprimées aussitôt. On ne voit jamais ton visage.']], now: 'Me vérifier', later: 'Plus tard', done: 'Vérifié.' },
  done: { title: (n) => `C’est parti, ${n}.`, sub: 'Voilà comment les mecs te voient.', cta: 'Voir qui est dans le coin', level: { hidden: 'Caché', city: 'Ville', area: 'à ~200 m', exact: 'Exact · 1 h' } },
};

const de: O = {
  ...en,
  back: 'Zurück',
  step: (n, total) => `Schritt ${n} von ${total}`,
  cont: 'Weiter',
  welcome: { live: (a) => (a ? `Live rund um ${a}` : 'Live in deiner Nähe'), count: (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} Typen in deiner Nähe.`, joining: 'Gerade kommen Typen in deiner Nähe dazu.', promises: ['Nie eine Telefonnummer.', 'Du bestimmst, wie genau man dich sieht.', 'Chats Ende-zu-Ende-verschlüsselt.'], start: 'Los geht’s', login: 'Ich habe schon ein Konto', link: 'Konto auf neuem Handy nutzen' },
  signup: { ...en.signup, title: 'Rein mit dir.', sub: 'Etwa eine Minute. Keine Telefonnummer, kein Passwort.', loginTitle: 'Willkommen zurück.', loginSub: 'Melde dich so an wie bei der Registrierung.', apple: 'Mit Apple fortfahren', passkey: 'Passkey verwenden', google: 'Mit Google fortfahren', email: 'Anmeldelink per E-Mail', emailPh: 'du@beispiel.de', send: 'Link senden', consent: ['Mit dem Fortfahren bestätigst du, dass du ', '18 oder älter', ' bist, und akzeptierst AGB und Datenschutz.'] },
  name: { title: 'Wie sollen dich Typen nennen?', sub: 'Vorname oder Spitzname. Jederzeit änderbar.', ph: 'Dein Name' },
  birthday: { ...en.birthday, title: (n) => (n ? `Wann hast du Geburtstag, ${n}?` : 'Wann hast du Geburtstag?'), sub: 'Nur dein Alter wird angezeigt. Nie dein Geburtstag.', age: (n) => `Du wirst mit ${n} angezeigt`, tooYoung: 'Du musst 18+ sein', day: 'Tag', month: 'Monat', year: 'Jahr' },
  identity: { title: 'Wie identifizierst du dich?', sub: 'Thirstr ist für jeden Typen. Wähl, was passt.', options: { man: 'Mann', trans_man: 'Trans Mann', non_binary: 'Nicht-binär', other: 'Etwas anderes', unspecified: 'Sag ich lieber nicht' }, otherPh: 'Dein Wort dafür' },
  herefor: { title: 'Worauf hast du Lust?', sub: 'So viele du willst. Jederzeit änderbar.', tiles: { hookup: ['Sex', 'Der Hauptgrund'], tonight: ['Heute Nacht', 'Jetzt frei'], chat: ['Chat', 'Erst reden'], friends: ['Freunde', 'Neue Leute, kein Druck'], sport: ['Sport', 'Gym, Laufen, Spiele'] } },
  underage: { title: 'Komm wieder, wenn du 18 bist.', body: 'Thirstr ist nur für Erwachsene. Deine Angaben wurden gelöscht.' },
  update: { title: 'Zeit für ein Update.', body: 'Diese Thirstr-Version ist zu alt, um sicher und synchron zu bleiben. Aktualisiere, um weiterzumachen. Deine Chats bleiben auf diesem Handy.', cta: 'Thirstr aktualisieren' },
  location: { ...en.location, title: 'Wie willst du auftauchen?', levels: { hidden: ['Versteckt', 'Erst verifizieren, dann unsichtbar stöbern.'], city: ['Stadt', 'Nur deine Stadt. Keine Entfernung.'], area: ['Bereich', 'Eine ~200-m-Zone. Wird größer, wenn wenig los ist.'], exact: ['Genau', 'Dein Pin, leicht verschoben, für 1 h. Dann weg.'] }, caption: { hidden: 'Nicht auf der Karte', city: 'Deine Stadt', area: '~200-m-Zone', exact: 'Pin für 1 h' }, defaultBadge: 'Standard', exactLocked: 'Erst verifizieren, dann einen Pin bis zu 4 h teilen.', footer: 'Deine Koordinaten verlassen nie dein Handy.', allow: 'Standort erlauben', pickCity: 'Stadt wählen', cityTitle: 'In welcher Stadt bist du?', citySub: 'Kein Problem. Du erscheinst in deiner Stadt.', cityPh: 'Stadt suchen', closer: { title: 'Zeigen, wie nah du bist?', yes: ['~150 m', 'Ja, ~50-m-Zone. Bessere Treffer in der Nähe.'], no: ['200–500 m', 'Nein, bei der ~200-m-Zone bleiben.'], foot: 'Nie dein genauer Standort. Jederzeit unter Ich änderbar.', caption: '~50-m-Zone' } },
  photo: { title: 'Zeig dich.', sub: 'Mit oder ohne Gesicht, du entscheidest. Hauptfoto bleibt brav; Heißes kommt in Extras oder private Alben.', later: 'Später', laterNote: 'Niemand sieht dich, bis du eins hinzufügst.', add: 'Hauptfoto hinzufügen', main: 'Haupt', hint: 'Gutes Licht, nur du. Ohne Gesicht geht auch. In Sekunden geprüft.', checking: 'Kurzer Check: eine Person, nichts Explizites…', ok: 'Sieht super aus. Bis zu 4 weitere, oder weiter.', choose: 'Foto wählen', checkingCta: 'Wird geprüft…', extra: 'Weiteres Foto' },
  verify: { title: 'Hol dir den Haken.', sub: 'Beweise mit einem kurzen Selfie-Check, dass du echt bist. 30 Sekunden.', perks: [['Verifiziert-Badge', ' auf Profil und Pin'], ['Schaltet Versteckt frei', ': stöbern ohne aufzutauchen'], ['Auf deinem Handy geprüft.', ' Bilder sofort gelöscht. Wir sehen dein Gesicht nie.']], now: 'Jetzt verifizieren', later: 'Später', done: 'Verifiziert.' },
  done: { title: (n) => `Du bist drin, ${n}.`, sub: 'So sehen dich die Typen.', cta: 'Zeig mir, wer da ist', level: { hidden: 'Versteckt', city: 'Stadt', area: '~200 m entfernt', exact: 'Genau · 1 h' } },
};

const lang = getLocales()[0]?.languageCode ?? 'en';
export const o: O = lang === 'fr' ? fr : lang === 'de' ? de : en;
export const MONTHS: Record<string, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
};
export const months = MONTHS[lang] ?? MONTHS.en;
export { en as onbEn, fr as onbFr, de as onbDe };
