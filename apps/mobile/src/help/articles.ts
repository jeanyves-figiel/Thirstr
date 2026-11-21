// F-22 R-22.2 (#178): help articles ship inside the app (offline, no reading history leaves the phone).
// Every article exists in en, fr and de (checked by __tests__/help.test.ts). Keep bodies ≤ 600 words.
// Blocks: p = paragraph, h = heading, ol / ul = lists, go = button to an app screen.

export type Lang = 'en' | 'fr' | 'de';
export type Block = { p: string } | { h: string } | { ol: string[] } | { ul: string[] } | { go: string; route: string; params?: object };
export type Text = { title: string; sum: string; body: Block[] };
export type CatId = 'start' | 'location' | 'chats' | 'safety' | 'profile' | 'account' | 'verify' | 'plans';
export type Meta = { id: string; cat: CatId; updated: string; related: string[]; keywords?: string };

export const CATS: { id: CatId; tone: 'sport' | 'trust' | 'friends' | 'hookup' | 'personal' | 'travel' }[] = [
  { id: 'start', tone: 'sport' },
  { id: 'location', tone: 'trust' },
  { id: 'chats', tone: 'friends' },
  { id: 'safety', tone: 'hookup' },
  { id: 'profile', tone: 'personal' },
  { id: 'account', tone: 'travel' },
  { id: 'verify', tone: 'trust' },
  { id: 'plans', tone: 'friends' },
];

export const CAT_NAMES: Record<Lang, Record<CatId, string>> = {
  en: { start: 'Getting started', location: 'Location & privacy', chats: 'Chats & media', safety: 'Safety', profile: 'Profile & photos', account: 'Account & sign-in', verify: 'Verification', plans: 'Parties, plans & Tonight' },
  fr: { start: 'Premiers pas', location: 'Position & vie privée', chats: 'Chats & médias', safety: 'Sécurité', profile: 'Profil & photos', account: 'Compte & connexion', verify: 'Vérification', plans: 'Soirées, plans & Ce soir' },
  de: { start: 'Erste Schritte', location: 'Standort & Privatsphäre', chats: 'Chats & Medien', safety: 'Sicherheit', profile: 'Profil & Fotos', account: 'Konto & Anmeldung', verify: 'Verifizierung', plans: 'Partys, Pläne & Heute Abend' },
};

const U = '2026-11-21';
export const META: Meta[] = [
  { id: 'how-thirstr-works', cat: 'start', updated: U, related: ['map-and-grid', 'who-sees-location'] },
  { id: 'map-and-grid', cat: 'start', updated: U, related: ['how-thirstr-works', 'hide-distance'] },
  { id: 'free', cat: 'start', updated: U, related: ['how-thirstr-works'] },
  { id: 'data-saver', cat: 'start', updated: U, related: ['map-and-grid'], keywords: 'mobile data battery slow' },
  { id: 'who-sees-location', cat: 'location', updated: U, related: ['hide-distance', 'exact-pin', 'go-hidden'] },
  { id: 'hide-distance', cat: 'location', updated: U, related: ['who-sees-location', 'exact-pin'], keywords: 'distance km' },
  { id: 'exact-pin', cat: 'location', updated: U, related: ['who-sees-location', 'hide-distance'] },
  { id: 'go-hidden', cat: 'location', updated: U, related: ['who-sees-location', 'why-verify'], keywords: 'incognito invisible' },
  { id: 'travel', cat: 'location', updated: U, related: ['who-sees-location'], keywords: 'trip city' },
  { id: 'disappearing-chats', cat: 'chats', updated: U, related: ['private-albums', 'chat-backup'] },
  { id: 'private-albums', cat: 'chats', updated: U, related: ['photo-rules', 'disappearing-chats'] },
  { id: 'translate', cat: 'chats', updated: U, related: ['disappearing-chats'] },
  { id: 'chat-backup', cat: 'chats', updated: U, related: ['new-phone', 'recovery-words'] },
  { id: 'video-check', cat: 'chats', updated: U, related: ['report-someone', 'date-checkin'], keywords: 'fake catfish' },
  { id: 'report-someone', cat: 'safety', updated: U, related: ['block-hide', 'scams'] },
  { id: 'block-hide', cat: 'safety', updated: U, related: ['report-someone'] },
  { id: 'date-checkin', cat: 'safety', updated: U, related: ['video-check', 'safe-mode'], keywords: 'sos emergency meet' },
  { id: 'safe-mode', cat: 'safety', updated: U, related: ['app-lock', 'go-hidden'] },
  { id: 'app-lock', cat: 'safety', updated: U, related: ['safe-mode'], keywords: 'pin face id duress' },
  { id: 'scams', cat: 'safety', updated: U, related: ['report-someone', 'someone-got-in'], keywords: 'money phishing code' },
  { id: 'photo-rules', cat: 'profile', updated: U, related: ['private-albums', 'moments'], keywords: 'rejected nude main' },
  { id: 'moments', cat: 'profile', updated: U, related: ['photo-rules'], keywords: 'story' },
  { id: 'lenses', cat: 'profile', updated: U, related: ['how-thirstr-works'], keywords: 'hookup friends sport' },
  { id: 'lost-phone', cat: 'account', updated: U, related: ['recovery-words', 'new-phone', 'someone-got-in'], keywords: 'stolen' },
  { id: 'recovery-words', cat: 'account', updated: U, related: ['lost-phone', 'chat-backup'], keywords: 'phrase 12' },
  { id: 'new-phone', cat: 'account', updated: U, related: ['chat-backup', 'lost-phone'] },
  { id: 'someone-got-in', cat: 'account', updated: U, related: ['lost-phone', 'scams'], keywords: 'hacked takeover' },
  { id: 'pause-delete', cat: 'account', updated: U, related: ['download-data'] },
  { id: 'download-data', cat: 'account', updated: U, related: ['pause-delete'], keywords: 'gdpr export' },
  { id: 'why-verify', cat: 'verify', updated: U, related: ['selfie-fails', 'go-hidden'] },
  { id: 'selfie-fails', cat: 'verify', updated: U, related: ['why-verify'] },
  { id: 'parties', cat: 'plans', updated: U, related: ['tonight'] },
  { id: 'tonight', cat: 'plans', updated: U, related: ['parties'] },
];

const SETTINGS = (screen: string) => ({ route: screen });
const ME = { route: 'Tabs', params: { screen: 'Me' } };

const en: Record<string, Text> = {
  'how-thirstr-works': {
    title: 'How Thirstr works',
    sum: 'One map, three intents, you decide how close.',
    body: [
      { p: 'Thirstr shows guys around you on one map, with a grid as a toggle. Everyone picks what they are here for: Hookup (coral), Friends (violet) or Sport (lime).' },
      { h: 'You stay in control' },
      { ul: ['You choose how precisely you show up: Hidden, City, Area or Exact.', 'You choose who can message you and what photos you get from strangers.', 'Your chats are end-to-end encrypted. Thirstr can’t read them.'] },
      { go: 'Open Me', ...ME },
    ],
  },
  'map-and-grid': {
    title: 'Map or grid',
    sum: 'Switch between the map and the grid of guys around you.',
    body: [
      { p: 'Explore opens on the map. Rings show what people are here for. Pull up the sheet for the Active now grid, or tap the toggle for the full grid.' },
      { p: 'Filters at the top switch intents (Hookup, Friends, Sport) and places like Clubs, Saunas, Parties and Gyms.' },
    ],
  },
  free: {
    title: 'Is Thirstr free?',
    sum: 'Yes. Everything you need works for free.',
    body: [{ p: 'Thirstr is fully usable for free: map, grid, chats, albums, safety features and verification. If paid extras come later, they will never be needed to stay safe or private.' }],
  },
  'data-saver': {
    title: 'Use less mobile data',
    sum: 'Data saver keeps the app light on mobile data.',
    body: [
      { p: 'Data saver is on Auto by default: on mobile data it loads small photos, nothing ahead of time, and big chat media only when you tap.' },
      { p: 'Messages, safety alerts and your location are never slowed down.' },
      { go: 'Open Data saver', ...SETTINGS('DataSaverSettings') },
    ],
  },
  'who-sees-location': {
    title: 'Who sees my location?',
    sum: 'Nobody sees your spot unless you pin it. You pick the level.',
    body: [
      { p: 'Your location level decides what guys see:' },
      { ul: ['Hidden: not on the map or grid (verified members only).', 'City: only your city.', 'Area: about 200 m, wider where few people are. This is the default.', 'Exact: a pin you set, for a time you choose, then it expires.'] },
      { p: 'Distances are shown as bands, never as your exact position.' },
      { go: 'Open Location in Me', ...ME },
    ],
  },
  'hide-distance': {
    title: 'Hide my distance',
    sum: 'Show a vaguer distance or none at all.',
    body: [
      { h: 'Change what guys see' },
      { ol: ['Go to Me › Location.', 'Pick Hidden, City, Area or Exact.', 'In Settings › Privacy & visibility you can also hide the distance on your profile.'] },
      { go: 'Open Privacy settings', ...SETTINGS('PrivacySettings') },
    ],
  },
  'exact-pin': {
    title: 'Exact pin: who sees it, for how long',
    sum: 'A pin is opt-in and always expires.',
    body: [
      { p: 'Exact shows a pin where you set it, for 30 min, 1, 2 or 4 hours. You choose who sees it. When the time is up it disappears on its own.' },
      { p: 'You can remove it any time from Me › Location.' },
      { go: 'Open Me', ...ME },
    ],
  },
  'go-hidden': {
    title: 'Go hidden for a while',
    sum: 'Disappear from the map and grid, with a timer.',
    body: [
      { p: 'Hidden takes you off the map and grid. You can set a timer and choose how you come back.' },
      { p: 'Only verified members can be hidden, so fakes can’t watch without being seen. You can also choose not to be seen by hidden members.' },
      { go: 'Open Me', ...ME },
    ],
  },
  travel: {
    title: 'Travel plans',
    sum: 'Look around a city before you go.',
    body: [
      { p: 'Add up to 3 trips in Me › Trips. You can look around the city before you arrive and choose whether guys there can see you before you land.' },
      { p: 'Only the city is shared, and trips delete themselves after they end.' },
      { go: 'Open Trips', ...SETTINGS('Trips') },
    ],
  },
  'disappearing-chats': {
    title: 'Disappearing chats',
    sum: 'Messages that delete themselves.',
    body: [
      { p: 'In Settings › Chats & media you can set messages to delete after a time. You can also set it for one chat from its menu.' },
      { p: 'Chats are end-to-end encrypted. Thirstr only passes them on and deletes undelivered copies after 30 days.' },
      { go: 'Open Chat settings', ...SETTINGS('ChatSettings') },
    ],
  },
  'private-albums': {
    title: 'Private albums',
    sum: 'Share spicier photos and videos only with who you choose.',
    body: [
      { p: 'Private albums have no limits and can hold videos. You share an album in a chat and can take it back any time.' },
      { p: 'Albums are encrypted on your phone. Thirstr can’t see what is inside.' },
    ],
  },
  translate: {
    title: 'Translate chats',
    sum: 'Messages in other languages, translated on your phone.',
    body: [
      { p: 'Turn on Translate messages in Settings › Chats & media. Translation runs on your phone (iOS 18 or later). Your chats never go to Thirstr or a translation service.' },
      { go: 'Open Chat settings', ...SETTINGS('ChatSettings') },
    ],
  },
  'chat-backup': {
    title: 'Chat backup',
    sum: 'An encrypted backup only your recovery words unlock.',
    body: [
      { p: 'Chat backup is off by default. When on, your chats are sealed on your phone with a key only your 12 recovery words can open, and uploaded daily on Wi-Fi.' },
      { p: 'It needs the recovery phrase. Without the words, nobody can open it, not even Thirstr.' },
      { go: 'Open Chat backup', ...SETTINGS('ChatBackupSettings') },
    ],
  },
  'video-check': {
    title: 'Video check',
    sum: 'Ask a match for a short live video before you meet.',
    body: [
      { p: 'From a chat you can ask for a short video check. It is recorded live, without sound, and can be watched once.' },
      { p: 'If the face doesn’t match the profile, trust that feeling and report the profile.' },
    ],
  },
  'report-someone': {
    title: 'Report someone',
    sum: 'From their profile or the chat menu. They aren’t told.',
    body: [
      { ol: ['Open their profile or your chat with them.', 'Tap ⋯ › Report.', 'Pick a reason. In a chat you can attach messages as proof.'] },
      { p: 'The person isn’t told who reported them. Serious reports are looked at first. If you are in danger, call local emergency services.' },
    ],
  },
  'block-hide': {
    title: 'Block or hide',
    sum: 'Hide someone from your Explore, or block them everywhere.',
    body: [
      { p: 'Hold a tile in the grid or a pin on the map to hide or block. Hide removes them from your Explore. Block stops all contact both ways.' },
      { p: 'Undo both in Settings › Safety › Hidden & blocked.' },
      { go: 'Open Hidden & blocked', ...SETTINGS('Blocked') },
    ],
  },
  'date-checkin': {
    title: 'Date check-in and SOS',
    sum: 'Your trusted contacts know if you don’t check in.',
    body: [
      { p: 'Before a date, start a check-in from Me › Date check-in. Pick when you should be done. If you don’t tap I’m OK in time, your trusted contacts are alerted.' },
      { p: 'SOS alerts them right away. On iPhone the check-in also shows on the lock screen, without names or the app name.' },
      { go: 'Start a check-in', ...SETTINGS('CheckinStart') },
    ],
  },
  'safe-mode': {
    title: 'Safe Mode',
    sum: 'Extra discretion in countries where being gay is risky.',
    body: [
      { p: 'Safe Mode turns on automatically in countries where it is needed. It hides the app’s nature in notifications and tightens what others can see.' },
      { p: 'You can set it to Always on or Off in Settings › Safety.' },
      { go: 'Open Safety settings', ...SETTINGS('SafetySettings') },
    ],
  },
  'app-lock': {
    title: 'App lock and duress PIN',
    sum: 'Lock Thirstr with Face ID or a PIN.',
    body: [
      { p: 'App lock asks for Face ID or a PIN when Thirstr opens. A duress PIN opens a harmless version if someone forces you to unlock.' },
      { go: 'Open App lock', ...SETTINGS('AppLock') },
    ],
  },
  scams: {
    title: 'Spot scams',
    sum: 'Nobody from Thirstr will ever ask for codes, words or money.',
    body: [
      { ul: ['Thirstr never asks for your recovery words, sign-in codes or a selfie by message or email.', 'Never send money or gift cards to someone you haven’t met.', 'Be careful with links that ask you to sign in.'] },
      { p: 'Report anyone who asks. It helps protect everyone.' },
    ],
  },
  'photo-rules': {
    title: 'Why a photo can’t be your main one',
    sum: 'Main photo vanilla, others can be spicier.',
    body: [
      { p: 'Your main public photo must be vanilla: no nudity. Up to 5 other public photos can be a bit spicy. Explicit photos and videos belong in private albums.' },
      { p: 'Photos are checked by AI only, on our EU servers. If one is turned down, it can still go in a private album.' },
    ],
  },
  moments: {
    title: 'Moments',
    sum: 'Photos that disappear after 1, 6 or 24 hours.',
    body: [{ p: 'Share a Moment from the Active now sheet. Pick who sees it and how long it lasts. You see who viewed it. When it expires, the photo is deleted.' }],
  },
  lenses: {
    title: 'Show me in Hookup, Friends, Sport',
    sum: 'One profile, shown in the intents you pick.',
    body: [
      { p: 'You have one profile. In Me › Show me in, pick the intents you appear in. Some fields can show in one intent only.' },
      { go: 'Open Me', ...ME },
    ],
  },
  'lost-phone': {
    title: 'Lost my phone',
    sum: 'Get back in, and sign out the lost phone.',
    body: [
      { ol: ['On a new phone, sign in with Apple, Google, a passkey or your email link.', 'Or use your 12 recovery words: every other phone is signed out at once.', 'Want the lost phone out without the words? Use the identity check.'] },
      { p: 'Chats come back only from another phone or a chat backup.' },
      { go: 'Start identity check', ...SETTINGS('RecoveryClaim') },
    ],
  },
  'recovery-words': {
    title: 'Set up recovery words',
    sum: '12 words that work when nothing else does.',
    body: [
      { p: 'Settings › Account › Recovery phrase shows 12 words once. Write them down. They sign you in on a new phone and unlock your sealed backup of albums, notes, favorites and friends.' },
      { p: 'Anyone with the words can sign in as you. Thirstr will never ask for them.' },
      { go: 'Set up recovery words', ...SETTINGS('Recovery') },
    ],
  },
  'new-phone': {
    title: 'New phone: keep my chats',
    sum: 'Move everything from your old phone in one go.',
    body: [
      { ol: ['On the new phone, choose Link a device.', 'On the old phone, scan the code and confirm with Face ID.', 'Choose All chats or the last 12 months.'] },
      { p: 'Chats move end-to-end encrypted, checked by a code on both screens.' },
      { go: 'Open Devices', ...SETTINGS('Devices') },
    ],
  },
  'someone-got-in': {
    title: 'Someone got into my account',
    sum: 'Prove it’s you with a selfie and take it back.',
    body: [
      { p: 'Sign in with any method you still have, then start the identity check. A fresh selfie is matched on your phone against your verified photos. Nothing leaves the phone.' },
      { p: 'After a short hold (24 h if another phone used the account this week, else 1 h), every other phone is signed out and other sign-ins are removed. The other side can stop it only by passing the same selfie check.' },
      { p: 'Nobody at Thirstr can move an account, whatever is sent by email.' },
      { go: 'Start identity check', ...SETTINGS('RecoveryClaim') },
    ],
  },
  'pause-delete': {
    title: 'Pause or delete my account',
    sum: 'Take a break, or leave for good.',
    body: [
      { p: 'Pause hides your profile everywhere and keeps your chats. Resume any time.' },
      { p: 'Delete removes your account and data from our servers within 24 hours. It can’t be undone.' },
      { go: 'Open Account settings', ...SETTINGS('AccountSettings') },
    ],
  },
  'download-data': {
    title: 'Download my data',
    sum: 'One file with everything about you.',
    body: [
      { p: 'Settings › Account › Download my data packs one .zip on your phone: account, profile, photos, private albums and chats as text. It is built on your phone; we never keep a copy.' },
      { go: 'Open Account settings', ...SETTINGS('AccountSettings') },
    ],
  },
  'why-verify': {
    title: 'Why verify?',
    sum: 'A quick selfie check shows you’re real.',
    body: [
      { p: 'Verification is a short live selfie check on your phone. It gives you the tick, lets you go Hidden, host parties and use the identity check if you ever lose access.' },
      { p: 'Your face and the images never leave your phone.' },
      { go: 'Verify now', ...SETTINGS('Verify') },
    ],
  },
  'selfie-fails': {
    title: 'Selfie check keeps failing',
    sum: 'Light, angle and glasses make the difference.',
    body: [
      { ul: ['Face a window or a lamp; avoid light behind you.', 'Take off glasses and caps.', 'Hold the phone at eye level and follow the prompts slowly.', 'Your main photo should show your face.'] },
      { p: 'After 3 tries there is a short wait before you can try again.' },
    ],
  },
  parties: {
    title: 'Host or join a party',
    sum: 'Any verified member can host.',
    body: [{ p: 'Create a party from Tonight. You choose who can request to join and approve each guest. The exact address is shared only with guests you accept.' }],
  },
  tonight: {
    title: 'The Tonight board',
    sum: 'See who’s up for something tonight.',
    body: [{ p: 'Tonight shows plans, parties and activities for today. Tap I’m in to join a plan. Posts expire on their own.' }],
  },
};

const fr: Record<string, Text> = {
  'how-thirstr-works': {
    title: 'Comment marche Thirstr',
    sum: 'Une carte, trois envies, tu décides à quelle distance.',
    body: [
      { p: 'Thirstr montre les mecs autour de toi sur une carte, avec une grille en option. Chacun choisit ce qu’il cherche : Plan cul (corail), Amis (violet) ou Sport (vert).' },
      { h: 'Tu gardes le contrôle' },
      { ul: ['Tu choisis ta précision : Masqué, Ville, Zone ou Exact.', 'Tu choisis qui peut t’écrire et quelles photos tu reçois d’inconnus.', 'Tes chats sont chiffrés de bout en bout. Thirstr ne peut pas les lire.'] },
      { go: 'Ouvrir Moi', ...ME },
    ],
  },
  'map-and-grid': {
    title: 'Carte ou grille',
    sum: 'Passe de la carte à la grille des mecs autour de toi.',
    body: [
      { p: 'Explorer s’ouvre sur la carte. Les anneaux montrent ce que chacun cherche. Tire le panneau pour la grille Actifs maintenant, ou touche le bouton pour la grille complète.' },
      { p: 'Les filtres en haut changent d’envie (Plan cul, Amis, Sport) et de lieux : Clubs, Saunas, Soirées, Salles de sport.' },
    ],
  },
  free: {
    title: 'Thirstr est-il gratuit ?',
    sum: 'Oui. Tout l’essentiel est gratuit.',
    body: [{ p: 'Thirstr s’utilise entièrement gratuitement : carte, grille, chats, albums, sécurité et vérification. Si des options payantes arrivent, elles ne seront jamais nécessaires pour rester en sécurité ou discret.' }],
  },
  'data-saver': {
    title: 'Consommer moins de données',
    sum: 'L’économiseur garde l’app légère sur données mobiles.',
    body: [
      { p: 'L’économiseur est en Auto par défaut : sur données mobiles, petites photos, rien à l’avance, et les gros médias du chat seulement quand tu touches.' },
      { p: 'Les messages, les alertes de sécurité et ta position ne sont jamais ralentis.' },
      { go: 'Ouvrir l’économiseur', ...SETTINGS('DataSaverSettings') },
    ],
  },
  'who-sees-location': {
    title: 'Qui voit ma position ?',
    sum: 'Personne ne voit ton emplacement sauf si tu poses une épingle.',
    body: [
      { p: 'Ton niveau de position décide de ce que voient les mecs :' },
      { ul: ['Masqué : ni sur la carte ni dans la grille (membres vérifiés).', 'Ville : seulement ta ville.', 'Zone : environ 200 m, plus large s’il y a peu de monde. C’est le réglage par défaut.', 'Exact : une épingle que tu poses, pour une durée choisie, puis elle expire.'] },
      { p: 'Les distances sont des tranches, jamais ta position exacte.' },
      { go: 'Ouvrir Position dans Moi', ...ME },
    ],
  },
  'hide-distance': {
    title: 'Masquer ma distance',
    sum: 'Affiche une distance plus vague, ou aucune.',
    body: [
      { h: 'Changer ce que voient les mecs' },
      { ol: ['Va dans Moi › Position.', 'Choisis Masqué, Ville, Zone ou Exact.', 'Dans Réglages › Confidentialité, tu peux aussi masquer la distance sur ton profil.'] },
      { go: 'Ouvrir la confidentialité', ...SETTINGS('PrivacySettings') },
    ],
  },
  'exact-pin': {
    title: 'Épingle exacte : qui la voit, combien de temps',
    sum: 'Une épingle est facultative et expire toujours.',
    body: [
      { p: 'Exact montre une épingle là où tu la poses, pour 30 min, 1, 2 ou 4 heures. Tu choisis qui la voit. À la fin, elle disparaît toute seule.' },
      { p: 'Tu peux la retirer à tout moment dans Moi › Position.' },
      { go: 'Ouvrir Moi', ...ME },
    ],
  },
  'go-hidden': {
    title: 'Se masquer un moment',
    sum: 'Disparais de la carte et de la grille, avec un minuteur.',
    body: [
      { p: 'Masqué te retire de la carte et de la grille. Tu peux régler un minuteur et choisir comment tu reviens.' },
      { p: 'Seuls les membres vérifiés peuvent se masquer, pour que les faux profils ne regardent pas sans être vus. Tu peux aussi ne pas être vu par les membres masqués.' },
      { go: 'Ouvrir Moi', ...ME },
    ],
  },
  travel: {
    title: 'Voyages',
    sum: 'Découvre une ville avant d’y aller.',
    body: [
      { p: 'Ajoute jusqu’à 3 voyages dans Moi › Voyages. Tu peux regarder la ville avant d’arriver et choisir si les mecs sur place te voient avant ton arrivée.' },
      { p: 'Seule la ville est partagée, et les voyages s’effacent après la fin.' },
      { go: 'Ouvrir Voyages', ...SETTINGS('Trips') },
    ],
  },
  'disappearing-chats': {
    title: 'Chats éphémères',
    sum: 'Des messages qui s’effacent tout seuls.',
    body: [
      { p: 'Dans Réglages › Chats & médias, tu peux faire disparaître les messages après un délai. Tu peux aussi le régler pour un seul chat depuis son menu.' },
      { p: 'Les chats sont chiffrés de bout en bout. Thirstr ne fait que les transmettre et efface les copies non livrées après 30 jours.' },
      { go: 'Ouvrir les réglages des chats', ...SETTINGS('ChatSettings') },
    ],
  },
  'private-albums': {
    title: 'Albums privés',
    sum: 'Partage tes photos et vidéos plus hot seulement avec qui tu veux.',
    body: [
      { p: 'Les albums privés n’ont pas de limite et acceptent les vidéos. Tu partages un album dans un chat et peux le reprendre à tout moment.' },
      { p: 'Les albums sont chiffrés sur ton téléphone. Thirstr ne voit pas leur contenu.' },
    ],
  },
  translate: {
    title: 'Traduire les chats',
    sum: 'Les messages dans d’autres langues, traduits sur ton téléphone.',
    body: [
      { p: 'Active Traduire les messages dans Réglages › Chats & médias. La traduction se fait sur ton téléphone (iOS 18 ou plus). Tes chats ne vont jamais chez Thirstr ni chez un service de traduction.' },
      { go: 'Ouvrir les réglages des chats', ...SETTINGS('ChatSettings') },
    ],
  },
  'chat-backup': {
    title: 'Sauvegarde des chats',
    sum: 'Une sauvegarde chiffrée que seuls tes mots ouvrent.',
    body: [
      { p: 'La sauvegarde est désactivée par défaut. Activée, tes chats sont scellés sur ton téléphone avec une clé que seuls tes 12 mots de récupération ouvrent, puis envoyés chaque jour en Wi-Fi.' },
      { p: 'Elle nécessite la phrase de récupération. Sans les mots, personne ne peut l’ouvrir, pas même Thirstr.' },
      { go: 'Ouvrir la sauvegarde', ...SETTINGS('ChatBackupSettings') },
    ],
  },
  'video-check': {
    title: 'Vérification vidéo',
    sum: 'Demande une courte vidéo en direct avant de te voir.',
    body: [
      { p: 'Depuis un chat, tu peux demander une courte vidéo de vérification. Elle est filmée en direct, sans son, et ne se regarde qu’une fois.' },
      { p: 'Si le visage ne correspond pas au profil, fie-toi à ton instinct et signale le profil.' },
    ],
  },
  'report-someone': {
    title: 'Signaler quelqu’un',
    sum: 'Depuis son profil ou le menu du chat. Il n’est pas prévenu.',
    body: [
      { ol: ['Ouvre son profil ou ton chat avec lui.', 'Touche ⋯ › Signaler.', 'Choisis une raison. Dans un chat, tu peux joindre des messages comme preuve.'] },
      { p: 'La personne ne sait pas qui l’a signalée. Les signalements graves passent en premier. En cas de danger, appelle les secours.' },
    ],
  },
  'block-hide': {
    title: 'Bloquer ou masquer',
    sum: 'Masque quelqu’un de ton Explorer, ou bloque-le partout.',
    body: [
      { p: 'Maintiens une vignette de la grille ou une épingle de la carte pour masquer ou bloquer. Masquer le retire de ton Explorer. Bloquer coupe tout contact dans les deux sens.' },
      { p: 'Annule les deux dans Réglages › Sécurité › Masqués & bloqués.' },
      { go: 'Ouvrir Masqués & bloqués', ...SETTINGS('Blocked') },
    ],
  },
  'date-checkin': {
    title: 'Check-in de rendez-vous et SOS',
    sum: 'Tes contacts de confiance savent si tu ne confirmes pas.',
    body: [
      { p: 'Avant un rendez-vous, lance un check-in depuis Moi › Check-in de rendez-vous. Choisis l’heure de fin. Si tu ne touches pas Je vais bien à temps, tes contacts de confiance sont alertés.' },
      { p: 'SOS les alerte tout de suite. Sur iPhone, le check-in s’affiche aussi sur l’écran verrouillé, sans noms ni nom de l’app.' },
      { go: 'Lancer un check-in', ...SETTINGS('CheckinStart') },
    ],
  },
  'safe-mode': {
    title: 'Mode sûr',
    sum: 'Plus de discrétion dans les pays où être gay est risqué.',
    body: [
      { p: 'Le mode sûr s’active automatiquement dans les pays où c’est nécessaire. Il masque la nature de l’app dans les notifications et limite ce que les autres voient.' },
      { p: 'Tu peux le mettre sur Toujours ou Désactivé dans Réglages › Sécurité.' },
      { go: 'Ouvrir la sécurité', ...SETTINGS('SafetySettings') },
    ],
  },
  'app-lock': {
    title: 'Verrou de l’app et code de contrainte',
    sum: 'Verrouille Thirstr avec Face ID ou un code.',
    body: [
      { p: 'Le verrou demande Face ID ou un code à l’ouverture. Un code de contrainte ouvre une version anodine si quelqu’un te force à déverrouiller.' },
      { go: 'Ouvrir le verrou', ...SETTINGS('AppLock') },
    ],
  },
  scams: {
    title: 'Repérer les arnaques',
    sum: 'Personne de Thirstr ne te demandera de codes, de mots ou d’argent.',
    body: [
      { ul: ['Thirstr ne demande jamais tes mots de récupération, codes de connexion ou un selfie par message ou e-mail.', 'N’envoie jamais d’argent ni de cartes cadeaux à quelqu’un que tu n’as pas rencontré.', 'Méfie-toi des liens qui demandent de te connecter.'] },
      { p: 'Signale toute personne qui le demande. Ça protège tout le monde.' },
    ],
  },
  'photo-rules': {
    title: 'Pourquoi une photo ne peut pas être principale',
    sum: 'Photo principale sage, les autres peuvent être plus hot.',
    body: [
      { p: 'Ta photo principale publique doit être sage : pas de nudité. Jusqu’à 5 autres photos publiques peuvent être un peu hot. Les photos et vidéos explicites vont dans les albums privés.' },
      { p: 'Les photos sont vérifiées uniquement par IA, sur nos serveurs en UE. Si une est refusée, elle peut aller dans un album privé.' },
    ],
  },
  moments: {
    title: 'Moments',
    sum: 'Des photos qui disparaissent après 1, 6 ou 24 heures.',
    body: [{ p: 'Partage un Moment depuis le panneau Actifs maintenant. Choisis qui le voit et combien de temps. Tu vois qui l’a regardé. À l’expiration, la photo est supprimée.' }],
  },
  lenses: {
    title: 'Apparaître dans Plan cul, Amis, Sport',
    sum: 'Un profil, montré dans les envies que tu choisis.',
    body: [
      { p: 'Tu as un seul profil. Dans Moi › M’afficher dans, choisis les envies où tu apparais. Certains champs peuvent n’apparaître que dans une envie.' },
      { go: 'Ouvrir Moi', ...ME },
    ],
  },
  'lost-phone': {
    title: 'J’ai perdu mon téléphone',
    sum: 'Reviens et déconnecte le téléphone perdu.',
    body: [
      { ol: ['Sur un nouveau téléphone, connecte-toi avec Apple, Google, une passkey ou ton lien e-mail.', 'Ou utilise tes 12 mots de récupération : tous les autres téléphones sont déconnectés aussitôt.', 'Tu veux sortir le téléphone perdu sans les mots ? Utilise le contrôle d’identité.'] },
      { p: 'Les chats ne reviennent que depuis un autre téléphone ou une sauvegarde.' },
      { go: 'Lancer le contrôle d’identité', ...SETTINGS('RecoveryClaim') },
    ],
  },
  'recovery-words': {
    title: 'Créer tes mots de récupération',
    sum: '12 mots qui marchent quand rien d’autre ne marche.',
    body: [
      { p: 'Réglages › Compte › Phrase de récupération affiche 12 mots une seule fois. Note-les. Ils te connectent sur un nouveau téléphone et ouvrent ta sauvegarde scellée d’albums, notes, favoris et amis.' },
      { p: 'Quiconque a les mots peut se connecter à ta place. Thirstr ne les demandera jamais.' },
      { go: 'Créer mes mots', ...SETTINGS('Recovery') },
    ],
  },
  'new-phone': {
    title: 'Nouveau téléphone : garder mes chats',
    sum: 'Transfère tout depuis l’ancien téléphone d’un coup.',
    body: [
      { ol: ['Sur le nouveau téléphone, choisis Lier un appareil.', 'Sur l’ancien, scanne le code et confirme avec Face ID.', 'Choisis Tous les chats ou les 12 derniers mois.'] },
      { p: 'Les chats passent chiffrés de bout en bout, vérifiés par un code sur les deux écrans.' },
      { go: 'Ouvrir Appareils', ...SETTINGS('Devices') },
    ],
  },
  'someone-got-in': {
    title: 'Quelqu’un est entré dans mon compte',
    sum: 'Prouve que c’est toi par selfie et reprends-le.',
    body: [
      { p: 'Connecte-toi avec un moyen que tu as encore, puis lance le contrôle d’identité. Un selfie est comparé sur ton téléphone avec tes photos vérifiées. Rien ne quitte le téléphone.' },
      { p: 'Après un court délai (24 h si un autre téléphone a utilisé le compte cette semaine, sinon 1 h), tous les autres téléphones sont déconnectés et les autres connexions retirées. L’autre côté ne peut arrêter qu’en réussissant le même selfie.' },
      { p: 'Personne chez Thirstr ne peut transférer un compte, quoi qu’on envoie par e-mail.' },
      { go: 'Lancer le contrôle d’identité', ...SETTINGS('RecoveryClaim') },
    ],
  },
  'pause-delete': {
    title: 'Mettre en pause ou supprimer mon compte',
    sum: 'Fais une pause, ou pars pour de bon.',
    body: [
      { p: 'La pause masque ton profil partout et garde tes chats. Reprends quand tu veux.' },
      { p: 'Supprimer efface ton compte et tes données de nos serveurs sous 24 heures. C’est définitif.' },
      { go: 'Ouvrir le compte', ...SETTINGS('AccountSettings') },
    ],
  },
  'download-data': {
    title: 'Télécharger mes données',
    sum: 'Un fichier avec tout ce qui te concerne.',
    body: [
      { p: 'Réglages › Compte › Télécharger mes données crée un .zip sur ton téléphone : compte, profil, photos, albums privés et chats en texte. Il est créé sur ton téléphone ; on n’en garde aucune copie.' },
      { go: 'Ouvrir le compte', ...SETTINGS('AccountSettings') },
    ],
  },
  'why-verify': {
    title: 'Pourquoi se vérifier ?',
    sum: 'Un selfie rapide montre que tu es réel.',
    body: [
      { p: 'La vérification est un court selfie en direct sur ton téléphone. Elle te donne le badge, te permet de te masquer, d’organiser des soirées et d’utiliser le contrôle d’identité si tu perds l’accès.' },
      { p: 'Ton visage et les images ne quittent jamais ton téléphone.' },
      { go: 'Me vérifier', ...SETTINGS('Verify') },
    ],
  },
  'selfie-fails': {
    title: 'Le selfie échoue toujours',
    sum: 'Lumière, angle et lunettes font la différence.',
    body: [
      { ul: ['Mets-toi face à une fenêtre ou une lampe ; évite la lumière derrière toi.', 'Enlève lunettes et casquette.', 'Tiens le téléphone à hauteur des yeux et suis les consignes lentement.', 'Ta photo principale doit montrer ton visage.'] },
      { p: 'Après 3 essais, il faut attendre un peu avant de réessayer.' },
    ],
  },
  parties: {
    title: 'Organiser ou rejoindre une soirée',
    sum: 'Tout membre vérifié peut organiser.',
    body: [{ p: 'Crée une soirée depuis Ce soir. Tu choisis qui peut demander à venir et tu acceptes chaque invité. L’adresse exacte n’est partagée qu’avec les invités acceptés.' }],
  },
  tonight: {
    title: 'Le tableau Ce soir',
    sum: 'Vois qui est partant ce soir.',
    body: [{ p: 'Ce soir montre les plans, soirées et activités du jour. Touche Je suis partant pour rejoindre un plan. Les annonces expirent toutes seules.' }],
  },
};

const de: Record<string, Text> = {
  'how-thirstr-works': {
    title: 'So funktioniert Thirstr',
    sum: 'Eine Karte, drei Absichten, du bestimmst die Nähe.',
    body: [
      { p: 'Thirstr zeigt Typen in deiner Nähe auf einer Karte, mit einem Raster als Umschalter. Jeder wählt, wofür er hier ist: Hookup (Koralle), Freunde (Violett) oder Sport (Limette).' },
      { h: 'Du behältst die Kontrolle' },
      { ul: ['Du wählst, wie genau du erscheinst: Versteckt, Stadt, Bereich oder Genau.', 'Du wählst, wer dir schreiben darf und welche Fotos du von Fremden bekommst.', 'Deine Chats sind Ende-zu-Ende-verschlüsselt. Thirstr kann sie nicht lesen.'] },
      { go: 'Ich öffnen', ...ME },
    ],
  },
  'map-and-grid': {
    title: 'Karte oder Raster',
    sum: 'Wechsle zwischen Karte und Raster der Typen um dich herum.',
    body: [
      { p: 'Entdecken öffnet sich auf der Karte. Ringe zeigen, wofür jemand hier ist. Zieh das Blatt hoch für das Raster Gerade aktiv, oder tippe auf den Umschalter für das volle Raster.' },
      { p: 'Filter oben wechseln die Absicht (Hookup, Freunde, Sport) und Orte wie Clubs, Saunen, Partys und Gyms.' },
    ],
  },
  free: {
    title: 'Ist Thirstr kostenlos?',
    sum: 'Ja. Alles Wichtige ist kostenlos.',
    body: [{ p: 'Thirstr ist komplett kostenlos nutzbar: Karte, Raster, Chats, Alben, Sicherheit und Verifizierung. Falls später Bezahl-Extras kommen, braucht man sie nie, um sicher oder privat zu bleiben.' }],
  },
  'data-saver': {
    title: 'Weniger mobile Daten',
    sum: 'Der Datensparmodus hält die App leicht.',
    body: [
      { p: 'Der Datensparmodus steht standardmäßig auf Auto: Bei mobilen Daten lädt er kleine Fotos, nichts im Voraus und große Chat-Medien erst beim Tippen.' },
      { p: 'Nachrichten, Sicherheitsalarme und dein Standort werden nie gebremst.' },
      { go: 'Datensparmodus öffnen', ...SETTINGS('DataSaverSettings') },
    ],
  },
  'who-sees-location': {
    title: 'Wer sieht meinen Standort?',
    sum: 'Niemand sieht deinen Ort, außer du setzt eine Nadel.',
    body: [
      { p: 'Deine Standortstufe bestimmt, was andere sehen:' },
      { ul: ['Versteckt: nicht auf Karte oder Raster (nur Verifizierte).', 'Stadt: nur deine Stadt.', 'Bereich: etwa 200 m, weiter, wo wenig los ist. Das ist der Standard.', 'Genau: eine Nadel, die du setzt, für eine Zeit deiner Wahl, dann läuft sie ab.'] },
      { p: 'Entfernungen werden als Bereiche gezeigt, nie als dein genauer Ort.' },
      { go: 'Standort unter Ich öffnen', ...ME },
    ],
  },
  'hide-distance': {
    title: 'Entfernung verbergen',
    sum: 'Zeig eine ungenauere Entfernung oder gar keine.',
    body: [
      { h: 'Ändern, was andere sehen' },
      { ol: ['Geh zu Ich › Standort.', 'Wähle Versteckt, Stadt, Bereich oder Genau.', 'Unter Einstellungen › Privatsphäre kannst du die Entfernung im Profil auch ausblenden.'] },
      { go: 'Privatsphäre öffnen', ...SETTINGS('PrivacySettings') },
    ],
  },
  'exact-pin': {
    title: 'Genaue Nadel: wer sie sieht, wie lange',
    sum: 'Eine Nadel ist freiwillig und läuft immer ab.',
    body: [
      { p: 'Genau zeigt eine Nadel, wo du sie setzt, für 30 Min., 1, 2 oder 4 Stunden. Du wählst, wer sie sieht. Danach verschwindet sie von selbst.' },
      { p: 'Du kannst sie jederzeit unter Ich › Standort entfernen.' },
      { go: 'Ich öffnen', ...ME },
    ],
  },
  'go-hidden': {
    title: 'Eine Weile versteckt sein',
    sum: 'Verschwinde von Karte und Raster, mit Timer.',
    body: [
      { p: 'Versteckt nimmt dich von Karte und Raster. Du kannst einen Timer setzen und wählen, wie du zurückkommst.' },
      { p: 'Nur Verifizierte können sich verstecken, damit Fakes nicht unsichtbar zuschauen. Du kannst auch festlegen, dass Versteckte dich nicht sehen.' },
      { go: 'Ich öffnen', ...ME },
    ],
  },
  travel: {
    title: 'Reisepläne',
    sum: 'Schau dich in einer Stadt um, bevor du hinfährst.',
    body: [
      { p: 'Füg unter Ich › Reisen bis zu 3 Reisen hinzu. Du kannst dich vorher umsehen und wählen, ob dich die Typen dort schon vor deiner Ankunft sehen.' },
      { p: 'Nur die Stadt wird geteilt, und Reisen löschen sich nach dem Ende selbst.' },
      { go: 'Reisen öffnen', ...SETTINGS('Trips') },
    ],
  },
  'disappearing-chats': {
    title: 'Verschwindende Chats',
    sum: 'Nachrichten, die sich selbst löschen.',
    body: [
      { p: 'Unter Einstellungen › Chats & Medien kannst du Nachrichten nach einer Zeit löschen lassen. Für einen einzelnen Chat geht das über sein Menü.' },
      { p: 'Chats sind Ende-zu-Ende-verschlüsselt. Thirstr leitet sie nur weiter und löscht nicht zugestellte Kopien nach 30 Tagen.' },
      { go: 'Chat-Einstellungen öffnen', ...SETTINGS('ChatSettings') },
    ],
  },
  'private-albums': {
    title: 'Private Alben',
    sum: 'Teil heißere Fotos und Videos nur mit wem du willst.',
    body: [
      { p: 'Private Alben haben keine Grenzen und können Videos enthalten. Du teilst ein Album im Chat und kannst es jederzeit zurücknehmen.' },
      { p: 'Alben werden auf deinem Handy verschlüsselt. Thirstr sieht den Inhalt nicht.' },
    ],
  },
  translate: {
    title: 'Chats übersetzen',
    sum: 'Nachrichten in anderen Sprachen, auf deinem Handy übersetzt.',
    body: [
      { p: 'Schalte Nachrichten übersetzen unter Einstellungen › Chats & Medien ein. Übersetzt wird auf deinem Handy (iOS 18 oder neuer). Deine Chats gehen nie an Thirstr oder einen Übersetzungsdienst.' },
      { go: 'Chat-Einstellungen öffnen', ...SETTINGS('ChatSettings') },
    ],
  },
  'chat-backup': {
    title: 'Chat-Backup',
    sum: 'Ein verschlüsseltes Backup, das nur deine Wörter öffnen.',
    body: [
      { p: 'Das Chat-Backup ist standardmäßig aus. Eingeschaltet werden deine Chats auf dem Handy mit einem Schlüssel versiegelt, den nur deine 12 Wiederherstellungswörter öffnen, und täglich im WLAN hochgeladen.' },
      { p: 'Es braucht die Wiederherstellungsphrase. Ohne die Wörter kann es niemand öffnen, auch Thirstr nicht.' },
      { go: 'Chat-Backup öffnen', ...SETTINGS('ChatBackupSettings') },
    ],
  },
  'video-check': {
    title: 'Video-Check',
    sum: 'Bitte vor dem Treffen um ein kurzes Live-Video.',
    body: [
      { p: 'Im Chat kannst du um einen kurzen Video-Check bitten. Er wird live aufgenommen, ohne Ton, und lässt sich einmal ansehen.' },
      { p: 'Passt das Gesicht nicht zum Profil, vertrau deinem Gefühl und melde das Profil.' },
    ],
  },
  'report-someone': {
    title: 'Jemanden melden',
    sum: 'Im Profil oder im Chat-Menü. Die Person erfährt es nicht.',
    body: [
      { ol: ['Öffne das Profil oder euren Chat.', 'Tippe auf ⋯ › Melden.', 'Wähle einen Grund. Im Chat kannst du Nachrichten als Beweis anhängen.'] },
      { p: 'Die Person erfährt nicht, wer sie gemeldet hat. Schwere Meldungen werden zuerst bearbeitet. Bei Gefahr ruf den Notruf.' },
    ],
  },
  'block-hide': {
    title: 'Blockieren oder ausblenden',
    sum: 'Blende jemanden in Entdecken aus oder blockiere ihn überall.',
    body: [
      { p: 'Halte eine Kachel im Raster oder eine Nadel auf der Karte gedrückt, um auszublenden oder zu blockieren. Ausblenden entfernt ihn aus deinem Entdecken. Blockieren stoppt jeden Kontakt in beide Richtungen.' },
      { p: 'Beides machst du unter Einstellungen › Sicherheit › Ausgeblendet & blockiert rückgängig.' },
      { go: 'Ausgeblendet & blockiert öffnen', ...SETTINGS('Blocked') },
    ],
  },
  'date-checkin': {
    title: 'Date-Check-in und SOS',
    sum: 'Deine Vertrauenspersonen erfahren es, wenn du dich nicht meldest.',
    body: [
      { p: 'Starte vor einem Date einen Check-in unter Ich › Date-Check-in. Wähle, wann du fertig sein willst. Tippst du nicht rechtzeitig auf Mir geht’s gut, werden deine Vertrauenspersonen alarmiert.' },
      { p: 'SOS alarmiert sie sofort. Auf dem iPhone erscheint der Check-in auch auf dem Sperrbildschirm, ohne Namen oder App-Namen.' },
      { go: 'Check-in starten', ...SETTINGS('CheckinStart') },
    ],
  },
  'safe-mode': {
    title: 'Sicherer Modus',
    sum: 'Mehr Diskretion in Ländern, in denen Schwulsein riskant ist.',
    body: [
      { p: 'Der sichere Modus schaltet sich in Ländern ein, in denen er nötig ist. Er verbirgt die Art der App in Mitteilungen und schränkt ein, was andere sehen.' },
      { p: 'Unter Einstellungen › Sicherheit kannst du ihn auf Immer an oder Aus stellen.' },
      { go: 'Sicherheit öffnen', ...SETTINGS('SafetySettings') },
    ],
  },
  'app-lock': {
    title: 'App-Sperre und Notfall-PIN',
    sum: 'Sperr Thirstr mit Face ID oder PIN.',
    body: [
      { p: 'Die App-Sperre fragt beim Öffnen nach Face ID oder PIN. Eine Notfall-PIN öffnet eine harmlose Version, falls dich jemand zum Entsperren zwingt.' },
      { go: 'App-Sperre öffnen', ...SETTINGS('AppLock') },
    ],
  },
  scams: {
    title: 'Betrug erkennen',
    sum: 'Niemand von Thirstr fragt nach Codes, Wörtern oder Geld.',
    body: [
      { ul: ['Thirstr fragt nie per Nachricht oder E-Mail nach Wiederherstellungswörtern, Anmeldecodes oder einem Selfie.', 'Schick nie Geld oder Gutscheine an jemanden, den du nicht getroffen hast.', 'Vorsicht bei Links, die eine Anmeldung verlangen.'] },
      { p: 'Melde jeden, der danach fragt. Das schützt alle.' },
    ],
  },
  'photo-rules': {
    title: 'Warum ein Foto nicht dein Hauptfoto sein kann',
    sum: 'Hauptfoto brav, die anderen dürfen heißer sein.',
    body: [
      { p: 'Dein öffentliches Hauptfoto muss brav sein: keine Nacktheit. Bis zu 5 weitere öffentliche Fotos dürfen etwas heißer sein. Explizite Fotos und Videos gehören in private Alben.' },
      { p: 'Fotos werden nur per KI auf unseren EU-Servern geprüft. Wird eins abgelehnt, kann es trotzdem in ein privates Album.' },
    ],
  },
  moments: {
    title: 'Moments',
    sum: 'Fotos, die nach 1, 6 oder 24 Stunden verschwinden.',
    body: [{ p: 'Teil einen Moment im Blatt Gerade aktiv. Wähle, wer ihn sieht und wie lange. Du siehst, wer ihn angeschaut hat. Läuft er ab, wird das Foto gelöscht.' }],
  },
  lenses: {
    title: 'Zeig mich in Hookup, Freunde, Sport',
    sum: 'Ein Profil, gezeigt in den Absichten deiner Wahl.',
    body: [
      { p: 'Du hast ein Profil. Unter Ich › Zeig mich in wählst du, wo du erscheinst. Manche Felder kannst du nur in einer Absicht zeigen.' },
      { go: 'Ich öffnen', ...ME },
    ],
  },
  'lost-phone': {
    title: 'Handy verloren',
    sum: 'Komm zurück und melde das verlorene Handy ab.',
    body: [
      { ol: ['Melde dich auf einem neuen Handy mit Apple, Google, Passkey oder E-Mail-Link an.', 'Oder nutze deine 12 Wiederherstellungswörter: Alle anderen Handys werden sofort abgemeldet.', 'Das verlorene Handy ohne die Wörter rauswerfen? Nutze die Identitätsprüfung.'] },
      { p: 'Chats kommen nur von einem anderen Handy oder aus einem Chat-Backup zurück.' },
      { go: 'Identitätsprüfung starten', ...SETTINGS('RecoveryClaim') },
    ],
  },
  'recovery-words': {
    title: 'Wiederherstellungswörter einrichten',
    sum: '12 Wörter, die funktionieren, wenn sonst nichts geht.',
    body: [
      { p: 'Einstellungen › Konto › Wiederherstellungsphrase zeigt dir 12 Wörter einmal. Schreib sie auf. Sie melden dich auf einem neuen Handy an und öffnen dein versiegeltes Backup von Alben, Notizen, Favoriten und Freunden.' },
      { p: 'Wer die Wörter hat, kann sich als du anmelden. Thirstr fragt nie danach.' },
      { go: 'Wörter einrichten', ...SETTINGS('Recovery') },
    ],
  },
  'new-phone': {
    title: 'Neues Handy: Chats behalten',
    sum: 'Alles vom alten Handy in einem Rutsch.',
    body: [
      { ol: ['Wähle auf dem neuen Handy Gerät verbinden.', 'Scanne auf dem alten Handy den Code und bestätige mit Face ID.', 'Wähle Alle Chats oder die letzten 12 Monate.'] },
      { p: 'Chats wandern Ende-zu-Ende-verschlüsselt, geprüft durch einen Code auf beiden Bildschirmen.' },
      { go: 'Geräte öffnen', ...SETTINGS('Devices') },
    ],
  },
  'someone-got-in': {
    title: 'Jemand ist in meinem Konto',
    sum: 'Beweise per Selfie, dass du es bist, und hol es zurück.',
    body: [
      { p: 'Melde dich mit einem Weg an, den du noch hast, und starte die Identitätsprüfung. Ein frisches Selfie wird auf deinem Handy mit deinen verifizierten Fotos verglichen. Nichts verlässt das Handy.' },
      { p: 'Nach einer kurzen Wartezeit (24 Std., wenn ein anderes Handy das Konto diese Woche benutzt hat, sonst 1 Std.) werden alle anderen Handys abgemeldet und andere Anmeldewege entfernt. Die andere Seite kann nur mit derselben bestandenen Selfie-Prüfung stoppen.' },
      { p: 'Niemand bei Thirstr kann ein Konto übertragen, egal was per E-Mail kommt.' },
      { go: 'Identitätsprüfung starten', ...SETTINGS('RecoveryClaim') },
    ],
  },
  'pause-delete': {
    title: 'Konto pausieren oder löschen',
    sum: 'Mach Pause oder geh für immer.',
    body: [
      { p: 'Pausieren versteckt dein Profil überall und behält deine Chats. Fortsetzen geht jederzeit.' },
      { p: 'Löschen entfernt dein Konto und deine Daten innerhalb von 24 Stunden von unseren Servern. Das ist endgültig.' },
      { go: 'Konto öffnen', ...SETTINGS('AccountSettings') },
    ],
  },
  'download-data': {
    title: 'Meine Daten herunterladen',
    sum: 'Eine Datei mit allem über dich.',
    body: [
      { p: 'Einstellungen › Konto › Meine Daten herunterladen packt ein .zip auf deinem Handy: Konto, Profil, Fotos, private Alben und Chats als Text. Es entsteht auf deinem Handy; wir behalten keine Kopie.' },
      { go: 'Konto öffnen', ...SETTINGS('AccountSettings') },
    ],
  },
  'why-verify': {
    title: 'Warum verifizieren?',
    sum: 'Ein kurzes Selfie zeigt, dass du echt bist.',
    body: [
      { p: 'Die Verifizierung ist eine kurze Live-Selfie-Prüfung auf deinem Handy. Du bekommst das Häkchen, kannst dich verstecken, Partys veranstalten und die Identitätsprüfung nutzen, falls du den Zugang verlierst.' },
      { p: 'Dein Gesicht und die Bilder verlassen nie dein Handy.' },
      { go: 'Jetzt verifizieren', ...SETTINGS('Verify') },
    ],
  },
  'selfie-fails': {
    title: 'Selfie-Prüfung klappt nicht',
    sum: 'Licht, Winkel und Brille machen den Unterschied.',
    body: [
      { ul: ['Schau zu einem Fenster oder einer Lampe; kein Licht hinter dir.', 'Brille und Kappe ab.', 'Halte das Handy auf Augenhöhe und folge den Anweisungen langsam.', 'Dein Hauptfoto sollte dein Gesicht zeigen.'] },
      { p: 'Nach 3 Versuchen musst du kurz warten, bevor es wieder geht.' },
    ],
  },
  parties: {
    title: 'Party veranstalten oder hingehen',
    sum: 'Jeder Verifizierte kann veranstalten.',
    body: [{ p: 'Erstelle eine Party unter Heute Abend. Du wählst, wer anfragen darf, und nimmst jeden Gast an. Die genaue Adresse sehen nur angenommene Gäste.' }],
  },
  tonight: {
    title: 'Die Heute-Abend-Tafel',
    sum: 'Sieh, wer heute Abend Lust hat.',
    body: [{ p: 'Heute Abend zeigt Pläne, Partys und Aktivitäten von heute. Tippe auf Ich bin dabei, um mitzumachen. Beiträge laufen von selbst ab.' }],
  },
};

export const ARTICLES: Record<Lang, Record<string, Text>> = { en, fr, de };
