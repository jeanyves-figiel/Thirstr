// What the test bot says (testing.md › Chat test bot). Pure: no I/O, unit-tested.
// Plain replies come in the chat's language so on-device translation (R-07.25…) has work to do.

export const LANGS = ['de', 'pt', 'fr', 'es', 'it', 'en', 'ja'] as const;
export type Lang = (typeof LANGS)[number];

export type ChatState = {
  lang: Lang;
  /** Rotate languages on every reply. */
  mix: boolean;
  /** Send Delivered receipts. */
  delivered: boolean;
  /** Send Read receipts. */
  read: boolean;
  /** Replies so far (picks phrases in turn). */
  n: number;
};

export const initialState = (lang: Lang = 'de', receipts = true): ChatState => ({ lang, mix: false, delivered: receipts, read: receipts, n: 0 });

/** Things a bot can share in a 1:1 chat (bot.ts does them). */
export type Act = 'photo' | 'once' | 'album' | 'revoke' | 'location' | 'link';
export type Out =
  | { delayMs: number; p: { t: 'text'; text: string } | { t: 'quick_reply'; text: string; k: number }; act?: undefined }
  | { delayMs: number; act: Act; p?: undefined };

const PHRASES: Record<Lang, string[]> = {
  de: [
    'Hey! Schön, von dir zu hören. Was machst du heute Abend?',
    'Ich bin gerade in Altstetten, ganz in deiner Nähe.',
    'Klingt gut! Erzähl mir mehr.',
    'Hast du Lust, später etwas trinken zu gehen?',
    'Ich bin nur ein Testbot, aber ich antworte immer 😉',
    'Das Wetter in Zürich ist heute ziemlich grau, oder?',
  ],
  pt: [
    'Oi! Tudo bem? O que você vai fazer hoje à noite?',
    'Estou em Altstetten, bem perto de você.',
    'Que legal! Me conta mais.',
    'Quer tomar alguma coisa mais tarde?',
    'Sou só um bot de teste, mas sempre respondo 😉',
    'O tempo em Zurique está meio cinzento hoje, né?',
  ],
  fr: [
    'Salut ! Ça va ? Tu fais quoi ce soir ?',
    'Je suis à Altstetten, tout près de toi.',
    'Ça a l’air sympa ! Raconte-moi.',
    'Ça te dit de boire un verre plus tard ?',
    'Je ne suis qu’un bot de test, mais je réponds toujours 😉',
    'Il fait un peu gris à Zurich aujourd’hui, non ?',
  ],
  es: [
    '¡Hola! ¿Qué tal? ¿Qué haces esta noche?',
    'Estoy en Altstetten, muy cerca de ti.',
    '¡Suena bien! Cuéntame más.',
    '¿Te apetece tomar algo más tarde?',
    'Solo soy un bot de prueba, pero siempre contesto 😉',
    'Hoy el tiempo en Zúrich está bastante gris, ¿no?',
  ],
  it: [
    'Ciao! Come va? Cosa fai stasera?',
    'Sono ad Altstetten, vicino a te.',
    'Sembra bello! Raccontami di più.',
    'Ti va di bere qualcosa più tardi?',
    'Sono solo un bot di prova, ma rispondo sempre 😉',
    'Oggi a Zurigo il tempo è piuttosto grigio, vero?',
  ],
  en: [
    'Hey! Good to hear from you. What are you up to tonight?',
    "I'm in Altstetten, really close to you.",
    'Sounds good! Tell me more.',
    'Fancy a drink later?',
    "I'm just a test bot, but I always answer 😉",
    'Pretty grey in Zurich today, right?',
  ],
  ja: [
    'こんにちは！今夜は何をしますか？',
    '今アルトシュテッテンにいます。すぐ近くです。',
    'いいですね！もっと教えてください。',
    'あとで一杯どうですか？',
    'ただのテストボットですが、いつも返事します 😉',
    '今日のチューリッヒは曇っていますね。',
  ],
};

const LONG: Record<Lang, string> = {
  de: 'Ich bin vor ein paar Monaten nach Zürich gezogen und entdecke die Stadt immer noch. Am Wochenende gehe ich gern an den See, und unter der Woche trainiere ich meistens abends im Gym. Kennst du ein gutes Café in Kreis 4?',
  pt: 'Eu me mudei para Zurique há alguns meses e ainda estou descobrindo a cidade. Nos fins de semana gosto de ir ao lago, e durante a semana costumo treinar na academia à noite. Você conhece um bom café no Kreis 4?',
  fr: 'Je suis arrivé à Zurich il y a quelques mois et je découvre encore la ville. Le week-end, j’aime aller au lac, et en semaine je vais surtout à la salle le soir. Tu connais un bon café dans le Kreis 4 ?',
  es: 'Me mudé a Zúrich hace unos meses y todavía estoy descubriendo la ciudad. Los fines de semana me gusta ir al lago y entre semana suelo entrenar en el gimnasio por la noche. ¿Conoces un buen café en el Kreis 4?',
  it: 'Mi sono trasferito a Zurigo qualche mese fa e sto ancora scoprendo la città. Nel fine settimana mi piace andare al lago e durante la settimana mi alleno in palestra la sera. Conosci un buon caffè nel Kreis 4?',
  en: "I moved to Zurich a few months ago and I'm still discovering the city. At weekends I like going to the lake, and during the week I usually hit the gym in the evening. Do you know a good café in Kreis 4?",
  ja: '数か月前にチューリッヒに引っ越してきて、まだ街を探検しています。週末は湖に行くのが好きで、平日は夜にジムでトレーニングしています。クライス4でいいカフェを知っていますか？',
};

/** Built-in quick replies of the app (apps/mobile/src/i18n/app.ts › chat.quick), by index `k`. */
export const QUICK_EN = ['Yes 🔥', 'Not now', 'Later?', 'Pics?', 'Host?', 'Can travel'];

export const HELP = [
  '🤖 Thirstr test bot (staging only, not a real person).',
  'I answer every message. Commands:',
  '• lang de|pt|fr|es|it|en|ja: reply language',
  '• mix: change language on every reply (mix off to stop)',
  '• long: a long message (translation test)',
  '• burst 5: several messages at once (max 10)',
  '• later 60: answer in 60 s, close the app to test push (max 600)',
  '• quick: a built-in quick reply',
  '• echo <text>: send it back',
  '• noread: Delivered but never Read (read on to undo)',
  '• receipts off|on: no Delivered/Read from me',
  '• status: my current settings',
  '• photo / once: I send a photo (once = view once)',
  '• album / revoke: I share / unshare my private album',
  '• location: I share my live location (1 h)',
  '• link: my profile link',
].join('\n');

const BASE_DELAY = 2000;

const pick = (lang: Lang, n: number) => PHRASES[lang][n % PHRASES[lang].length];

/** Decides the replies to an incoming text and the chat's new state. */
export function plan(text: string, s0: ChatState, rnd: () => number = Math.random): { state: ChatState; out: Out[] } {
  const s = { ...s0 };
  const raw = text.trim();
  const [cmd = '', ...rest] = raw.split(/\s+/);
  const arg = rest.join(' ');
  const c = cmd.toLowerCase();
  const say = (t: string, delayMs = BASE_DELAY): Out => ({ delayMs, p: { t: 'text', text: t } });
  const next = () => {
    const lang = s.mix ? LANGS[s.n % LANGS.length] : s.lang;
    const t = pick(lang, s.n);
    s.n += 1;
    return t;
  };

  switch (c) {
    case 'help':
    case 'hilfe':
    case 'aide':
    case 'ajuda':
    case '?':
      return { state: s, out: [say(HELP, 800)] };
    case 'lang': {
      const l = arg.toLowerCase() as Lang;
      if (!LANGS.includes(l)) return { state: s, out: [say('lang: ' + LANGS.join(' | '), 800)] };
      s.lang = l;
      s.mix = false;
      return { state: s, out: [say(pick(l, 0), 1200)] };
    }
    case 'mix':
      s.mix = arg.toLowerCase() !== 'off';
      return { state: s, out: [say(s.mix ? '🔀 mix on' : '🔀 mix off', 800)] };
    case 'long':
      return { state: s, out: [say(LONG[s.mix ? LANGS[s.n++ % LANGS.length] : s.lang], 3000)] };
    case 'burst': {
      const n = Math.max(1, Math.min(10, parseInt(arg, 10) || 5));
      return { state: s, out: Array.from({ length: n }, (_, i) => say(`${i + 1}/${n} ${next()}`, 1000 + i * 400)) };
    }
    case 'later': {
      const sec = Math.max(5, Math.min(600, parseInt(arg, 10) || 60));
      return { state: s, out: [say(`⏰ ${sec} s`, 800), say(next(), sec * 1000)] };
    }
    case 'photo':
    case 'pic':
    case 'once':
    case 'album':
    case 'revoke':
    case 'location':
    case 'link':
      return { state: s, out: [{ delayMs: 1500, act: c === 'pic' ? 'photo' : (c as Act) }] };
    case 'quick': {
      const k = Math.floor(rnd() * QUICK_EN.length);
      return { state: s, out: [{ delayMs: 1200, p: { t: 'quick_reply', text: QUICK_EN[k], k } }] };
    }
    case 'echo':
      return { state: s, out: [say(arg || '…', 800)] };
    case 'noread':
      s.read = false;
      return { state: s, out: [say('👀 Read receipts off: you will only see Delivered.', 800)] };
    case 'read':
      s.read = arg.toLowerCase() !== 'off';
      return { state: s, out: [say(s.read ? '✅ Read receipts on' : '👀 Read receipts off', 800)] };
    case 'receipts': {
      const on = arg.toLowerCase() !== 'off';
      s.delivered = on;
      s.read = on;
      return { state: s, out: [say(on ? '✅ Receipts on' : '🚫 Receipts off', 800)] };
    }
    case 'status':
      return {
        state: s,
        out: [say(`lang ${s.lang}${s.mix ? ' (mix)' : ''} · delivered ${s.delivered ? 'on' : 'off'} · read ${s.read ? 'on' : 'off'}`, 800)],
      };
    default:
      // A bit of variety in timing so it feels like someone typing.
      return { state: s, out: [say(next(), BASE_DELAY + Math.floor(rnd() * 1500))] };
  }
}

/** Reply to things that aren't text (photos, locations, …). */
export function nonText(s: ChatState): string {
  const t: Record<Lang, string> = {
    de: 'Danke! Ich kann leider nur Text lesen 🤖',
    pt: 'Valeu! Infelizmente só consigo ler texto 🤖',
    fr: 'Merci ! Je ne sais lire que du texte 🤖',
    es: '¡Gracias! Solo puedo leer texto 🤖',
    it: 'Grazie! Purtroppo leggo solo testo 🤖',
    en: 'Thanks! I can only read text 🤖',
    ja: 'ありがとう！テキストしか読めません 🤖',
  };
  return t[s.lang];
}
