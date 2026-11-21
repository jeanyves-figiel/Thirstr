import { getLocales } from 'expo-localization';

// F-17 R-17.16 (#177): Data saver. en / fr / de.
const en = {
  title: 'Data saver',
  auto: 'Auto on mobile data',
  autoSub: 'On with mobile data and metered Wi-Fi. Recommended.',
  always: 'Always',
  alwaysSub: 'Wi-Fi too',
  off: 'Off',
  offSub: 'Everything loads in full',
  whileOn: "While it's on",
  rules: ['Small photos in Explore and lists; full size when you open a profile', 'Nothing loaded ahead of time', 'Big chat photos and videos load when you tap', 'Videos you send go in 720p'],
  never: 'Messages, safety alerts and your location are never slowed down.',
  sumAutoOn: 'Auto · on now',
  sumAutoOff: 'Auto · off on Wi-Fi',
};
type S = typeof en;
const fr: S = {
  title: 'Économiseur de données',
  auto: 'Auto sur données mobiles',
  autoSub: 'Activé sur données mobiles et Wi-Fi limité. Recommandé.',
  always: 'Toujours',
  alwaysSub: 'Aussi en Wi-Fi',
  off: 'Désactivé',
  offSub: 'Tout se charge en entier',
  whileOn: 'Quand il est activé',
  rules: ['Petites photos dans Explorer et les listes ; taille réelle en ouvrant un profil', 'Rien n’est chargé à l’avance', 'Les grandes photos et vidéos du chat se chargent quand vous touchez', 'Les vidéos envoyées partent en 720p'],
  never: 'Les messages, les alertes de sécurité et votre position ne sont jamais ralentis.',
  sumAutoOn: 'Auto · activé',
  sumAutoOff: 'Auto · désactivé en Wi-Fi',
};
const de: S = {
  title: 'Datensparmodus',
  auto: 'Auto bei mobilen Daten',
  autoSub: 'An bei mobilen Daten und getaktetem WLAN. Empfohlen.',
  always: 'Immer',
  alwaysSub: 'Auch im WLAN',
  off: 'Aus',
  offSub: 'Alles lädt in voller Größe',
  whileOn: 'Solange er an ist',
  rules: ['Kleine Fotos in Entdecken und Listen; volle Größe beim Öffnen eines Profils', 'Nichts wird im Voraus geladen', 'Große Chat-Fotos und Videos laden beim Tippen', 'Gesendete Videos gehen in 720p'],
  never: 'Nachrichten, Sicherheitsalarme und dein Standort werden nie gebremst.',
  sumAutoOn: 'Auto · gerade an',
  sumAutoOff: 'Auto · im WLAN aus',
};
const lang = getLocales()[0]?.languageCode ?? 'en';
export const sv: S = lang === 'fr' ? fr : lang === 'de' ? de : en;
export { en as svEn, fr as svFr, de as svDe };
