// Strings for on-device chat translation (#106, F-07 R-07.25–R-07.31). en / fr / de.
import { getLocales } from 'expo-localization';

const en = {
  from: (l: string) => `Translated from ${l}`,
  showOriginal: 'Show original',
  hideOriginal: 'Hide original',
  translate: 'Translate',
  translateLang: (l: string) => `Translate ${l}`,
  download: 'One-time download of the language pack. Your messages stay on this phone.',
  translating: 'Translating…',
  note: (from: string, to: string) => `${from} is translated to ${to} on this phone. Nothing leaves it.`,
  // Settings › Chats & media
  section: 'Translation',
  setting: 'Translate messages',
  into: (l: string) => `Into ${l}, your phone’s language`,
  modes: { auto: 'Automatic', tap: 'Tap', off: 'Off' } as Record<string, string>,
  modeSub: {
    auto: 'Messages in other languages are translated as they arrive. Tap “Show original” any time.',
    tap: 'A “Translate” button appears under messages in other languages.',
    off: 'Messages are always shown as written.',
  } as Record<string, string>,
  privacy: 'Done on this phone. Your chats never go to Thirstr or a translation service. Language packs download once.',
  unavailable: 'Needs iOS 18 or later on this phone.',
  // Chat ⋯
  chat: 'Translate this chat',
  chatSub: (from: string, to: string) => `${from} → ${to}, on this phone`,
  chatSubAny: 'On this phone',
};

type T = typeof en;

const fr: T = {
  from: (l) => `Traduit de : ${l}`,
  showOriginal: 'Voir l’original',
  hideOriginal: 'Masquer l’original',
  translate: 'Traduire',
  translateLang: (l) => `Traduire : ${l}`,
  download: 'Téléchargement unique du pack de langue. Tes messages restent sur ce téléphone.',
  translating: 'Traduction…',
  note: (from, to) => `${from} est traduit en ${to} sur ce téléphone. Rien n’en sort.`,
  section: 'Traduction',
  setting: 'Traduire les messages',
  into: (l) => `En ${l}, la langue de ton téléphone`,
  modes: { auto: 'Automatique', tap: 'Au toucher', off: 'Non' },
  modeSub: {
    auto: 'Les messages dans d’autres langues sont traduits dès leur arrivée. Touche « Voir l’original » quand tu veux.',
    tap: 'Un bouton « Traduire » apparaît sous les messages dans d’autres langues.',
    off: 'Les messages restent tels qu’ils ont été écrits.',
  },
  privacy: 'Fait sur ce téléphone. Tes conversations ne vont jamais chez Thirstr ni chez un service de traduction. Les packs de langue se téléchargent une fois.',
  unavailable: 'Nécessite iOS 18 ou plus récent sur ce téléphone.',
  chat: 'Traduire cette conversation',
  chatSub: (from, to) => `${from} → ${to}, sur ce téléphone`,
  chatSubAny: 'Sur ce téléphone',
};

const de: T = {
  from: (l) => `Übersetzt aus ${l}`,
  showOriginal: 'Original zeigen',
  hideOriginal: 'Original ausblenden',
  translate: 'Übersetzen',
  translateLang: (l) => `${l} übersetzen`,
  download: 'Einmaliger Download des Sprachpakets. Deine Nachrichten bleiben auf diesem Handy.',
  translating: 'Übersetze…',
  note: (from, to) => `${from} wird auf diesem Handy in ${to} übersetzt. Nichts verlässt es.`,
  section: 'Übersetzung',
  setting: 'Nachrichten übersetzen',
  into: (l) => `In ${l}, die Sprache deines Handys`,
  modes: { auto: 'Automatisch', tap: 'Antippen', off: 'Aus' },
  modeSub: {
    auto: 'Nachrichten in anderen Sprachen werden beim Eintreffen übersetzt. Tippe jederzeit auf „Original zeigen“.',
    tap: 'Unter Nachrichten in anderen Sprachen erscheint „Übersetzen“.',
    off: 'Nachrichten werden immer so gezeigt, wie sie geschrieben wurden.',
  },
  privacy: 'Passiert auf diesem Handy. Deine Chats gehen nie an Thirstr oder einen Übersetzungsdienst. Sprachpakete werden einmal geladen.',
  unavailable: 'Braucht iOS 18 oder neuer auf diesem Handy.',
  chat: 'Diesen Chat übersetzen',
  chatSub: (from, to) => `${from} → ${to}, auf diesem Handy`,
  chatSubAny: 'Auf diesem Handy',
};

const lang = getLocales()[0]?.languageCode ?? 'en';
export const trx: T = lang === 'fr' ? fr : lang === 'de' ? de : en;
export { en as trEn, fr as trFr, de as trDe };
