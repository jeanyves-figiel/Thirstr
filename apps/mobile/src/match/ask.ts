import type { Mode } from '../api/types';
import type { Filters } from '../explore/explore';
import { INTEREST_LABELS } from '../i18n/interests';

// F-24 Ask (#338, D-27, R-24.2–R-24.6). Turns what someone types or says into the filters the
// Filters sheet already has (R-04.8) plus interests. Runs on this phone: the text never leaves it,
// only the resulting filters do, exactly as if they had been set by hand (R-24.6).
//
// This is the phrase grammar (engine 3, R-24.3): en / fr / de, always shipped, and the validator
// for the on-device system models (engines 1–2), whose output goes through `sanitize` below.
// Nothing outside the filter schema can come out, and HIV status, ethnicity, languages and
// exclusion phrases ("no fems") are refused, never turned into a filter (R-24.5, AC-24.2).

export type Refusal = 'health' | 'ethnicity' | 'exclusion' | 'language';

export type AskResult = {
  /** Only keys of the Filters sheet (R-04.8) + `interests`. */
  filters: Partial<Filters>;
  /** Intent chips the ask implies (e.g. "gym buddy" → Sport), else null. */
  intents: Mode[] | null;
  refused: Refusal[];
  /** Words that matched nothing (shown so people can see what was ignored). */
  ignored: string[];
};

/** Lower case, no accents, punctuation → spaces (keeps digits, "-" between digits). */
export function norm(s: string): string {
  return ` ${s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[’']/g, ' ')
    .replace(/(\d)\s*-\s*(\d)/g, '$1 to $2')
    .replace(/[^a-z0-9+<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

type Acc = { f: Partial<Filters>; intents: Set<Mode>; refused: Set<Refusal> };
type Rule = [RegExp, (m: RegExpMatchArray, a: Acc) => void];

const add = (a: Acc, k: string, v: string) => {
  const cur = (a.f[k] as string[] | undefined) ?? [];
  if (!cur.includes(v)) a.f[k] = [...cur, v];
};
// Leading space consumed, trailing one only looked at, so neighbouring words still match.
const w = (alts: string) => new RegExp(` (?:${alts})(?= )`, 'g');
const set = (k: string, v: string) => ((_: RegExpMatchArray, a: Acc) => add(a, k, v)) as Rule[1];

const AGE_MIN = 18;
const AGE_MAX = 99;
const age = (n: string) => Math.min(AGE_MAX, Math.max(AGE_MIN, Number.parseInt(n, 10)));
const KM = 1000;

// ---- refusals first, so "no fems" never reaches the position rules and "neg" never a filter.
const PEOPLE = 'fems?|femmes?|fats?|fatties|chubs?|asians?|blacks?|whites?|latinos?|arabs?|indians?|old(?:ies)?|trans|twinks?|bears?|folles?|grosse?s?|gros|noirs?|blancs?|asiatiques?|arabes?|rebeus?|beurs?|tunten?|dicke|schwarze|weisse|asiaten|alte';
const REFUSALS: Rule[] = [
  // exclusion phrases: "no fems", "pas de folles", "keine Tunten", "masc only", "X only" for people
  [w(`no (?:${PEOPLE})|not (?:${PEOPLE})|pas de (?:${PEOPLE})|sans (?:${PEOPLE})|keine? (?:${PEOPLE})|(?:masc|white|black|asian|latino|arab)s? only|only (?:masc|white|black|asian|latino|arab)s?`), (_, a) => a.refused.add('exclusion')],
  // HIV / STI status and PrEP: health stays in chats (F-06 R-06.5, R-04.8)
  [w('hiv(?: neg(?:ative)?| pos(?:itive)?| status)?|neg(?:ative)?|poz|positive|negatif|positif|seronegatifs?|seropositifs?|clean (?:only|guys?|mecs?)|clean(?! ?cut)|ddf|std free|prep|sous prep|undetectable|indetectable|u u|negativ|positiv|sauber'), (_, a) => a.refused.add('health')],
  // ethnicity / race words (never a filter, anti-discrimination)
  [w('white|black|asian|latino|latin|arab|middle eastern|indian|blanc|blancs|noir|noirs|asiatique|asiatiques|maghrebin|rebeu|beur|metisse?|weiss|weisser|schwarz|schwarzer|asiatisch|turkisch|arabisch|ethnicity|race|ethnie|herkunft'), (_, a) => a.refused.add('ethnicity')],
  // languages: chats translate instead (#106)
  [w('(?:who )?speaks? \\w+|(?:qui )?parle \\w+|spricht \\w+|(?:english|french|german|spanish) speaking|francophone|anglophone|deutschsprachig'), (_, a) => a.refused.add('language')],
];

const RULES: Rule[] = [
  // ---- distance
  [w('(?:within|under|less than|< ?|a moins de|moins de|dans un rayon de|im umkreis von|innerhalb von|unter|bis) ?(\\d+(?:\\.\\d+)?) ?(km|kilometers?|kilometres?|mi|miles?|m)'), (m, a) => {
    const n = Number.parseFloat(m[1]);
    const u = m[2];
    a.f.distance_max = Math.round(u.startsWith('mi') ? n * 1609 : u === 'm' ? n : n * KM);
  }],
  [w('(?:near me|nearby|close by|close to me|around me|very close|pres de (?:moi|chez moi)|a cote|tout pres|in der nahe|ganz nah|nah)'), (_, a) => (a.f.distance_max = a.f.distance_max ?? 2 * KM)],
  // ---- age
  [w('(?:between|entre|zwischen) (\\d\\d) (?:and|et|und|to) (\\d\\d)|(\\d\\d) to (\\d\\d)(?: ans| jahre| years?(?: old)?| yo)?'), (m, a) => {
    const lo = age(m[1] ?? m[3]);
    const hi = age(m[2] ?? m[4]);
    a.f.age_min = Math.min(lo, hi);
    a.f.age_max = Math.max(lo, hi);
  }],
  [w('(?:under|below|younger than|less than|max|moins de|pas plus de|unter|junger als|bis) (\\d\\d)(?: ans| jahre| years?(?: old)?| yo)?|< ?(\\d\\d)'), (m, a) => {
    a.f.age_max = age(m[1] ?? m[2]) - (/under|below|younger|less|moins|unter|junger|</.test(m[0]) ? 1 : 0);
  }],
  [w('(?:over|above|older than|more than|plus de|au dessus de|uber|alter als|ab) (\\d\\d)(?: ans| jahre| years?(?: old)?| yo)?|> ?(\\d\\d)|(\\d\\d) ?\\+'), (m, a) => {
    a.f.age_min = age(m[1] ?? m[2] ?? m[3]) + (/over|above|older|more|plus|dessus|uber|alter|>/.test(m[0]) ? 1 : 0);
  }],
  [w('(?:in (?:their|his) )?([2-6])0s|(vingt|trente|quarante|cinquante|soixante)aine|(zwanzig|dreissig|vierzig|funfzig|sechzig)er'), (m, a) => {
    const fr: Record<string, number> = { vingt: 2, trente: 3, quarante: 4, cinquante: 5, soixante: 6 };
    const de: Record<string, number> = { zwanzig: 2, dreissig: 3, vierzig: 4, funfzig: 5, sechzig: 6 };
    const d = m[1] ? Number(m[1]) : m[2] ? fr[m[2]] : de[m[3]];
    a.f.age_min = Math.max(AGE_MIN, d * 10);
    a.f.age_max = d * 10 + 9;
  }],
  [w('(?:young|jeunes?|jung|junge)'), (_, a) => (a.f.age_max = a.f.age_max ?? 29)],
  [w('(?:older|mature|plus ages?|matures?|alter|reife)'), (_, a) => (a.f.age_min = a.f.age_min ?? 40)],
  // ---- status
  [w('unverified|not verified|non verifies?|nicht verifiziert'), (_, a) => (a.f.verified_only = false)],
  [w('verified|real|verifies?|verifiziert|echte?'), (_, a) => (a.f.verified_only = true)],
  [w('online|on line|active|en ligne|connectes?|aktiv online|gerade online'), (_, a) => (a.f.online_now = true)],
  [w('new(?: guys| members| profiles| here)?|newbies|nouveaux?|nouvelles?|neu(?:e|en)?(?: mitglieder)?'), (_, a) => (a.f.new_members = true)],
  // ---- when / looking for ("ce soir" before "soir" = evenings)
  [w('tonight|this evening|ce soir|cette nuit|heute abend|heute nacht'), set('looking_for', 'tonight')],
  [w('right now|now|asap|maintenant|tout de suite|direct|jetzt|sofort|gleich'), (m, a) => {
    add(a, 'looking_for', 'now');
    a.f.has_now = true;
  }],
  [w('dates?|dating|rencards?|rendez vous|daten|dates'), set('looking_for', 'dates')],
  [w('friends?|mates?|buddies|amis?|potes?|freunde?|kumpels?'), (_, a) => {
    add(a, 'looking_for', 'friends');
    a.intents.add('friends');
  }],
  [w('chat(?:ting)?|talk|discuter|parler|plaudern|quatschen'), set('looking_for', 'chat')],
  [w('hook ?ups?|fun|plans?|sex|nsa|fick'), (_, a) => {
    add(a, 'looking_for', 'hookup');
    a.intents.add('hookup');
  }],
  // ---- position (compound forms first)
  [w('vers(?:atile)? tops?|top vers|plutot actifs?|eher aktiv'), set('position', 'vers_top')],
  [w('vers(?:atile)? bottoms?|bottom vers|plutot passifs?|eher passiv'), set('position', 'vers_bottom')],
  [w('tops?|actifs?|aktiv|aktive'), set('position', 'top')],
  [w('bottoms?|passifs?|passiv|passive'), set('position', 'bottom')],
  [w('vers|versatile|versas?|flexi|flexibel'), set('position', 'vers')],
  [w('sides?'), set('position', 'side')],
  // ---- hosting
  [w('(?:can|who can|able to) host|hosts?|hosting|with (?:a|his own) place|has a place|(?:qui )?recoit|recoivent|chez (?:lui|eux)|a un lieu|kann empfangen|empfangt|hat (?:eine )?wohnung|bei ihm'), set('hosting', 'can_host')],
  [w('(?:can|who can|able to) travel|comes? (?:over|to me)|(?:qui )?se deplace|se deplacent|peut venir|kann kommen|kommt vorbei|mobil'), set('hosting', 'can_travel')],
  // ---- tribes
  [w('bears?|ours|baren'), set('tribes', 'bear')],
  [w('twinks?|minets?'), set('tribes', 'twink')],
  [w('jocks?|sportifs? mecs?'), set('tribes', 'jock')],
  [w('otters?|loutres?'), set('tribes', 'otter')],
  [w('daddys?|daddies|papas?'), set('tribes', 'daddy')],
  [w('geeks?|nerds?|nerdy'), set('tribes', 'geek')],
  [w('leather|cuir|leder'), set('tribes', 'leather')],
  [w('pups?|puppies|puppy'), set('tribes', 'pup')],
  [w('rugged|virils?|kernig'), set('tribes', 'rugged')],
  [w('clean ?cut|bcbg|gepflegt'), set('tribes', 'clean_cut')],
  [w('muscle (?:guys?|men)|musclebears?|muscle'), set('tribes', 'muscle')],
  [w('discreet|discrets?|diskret'), set('tribes', 'discreet')],
  [w('trans (?:guys?|men)|trans mecs?|transmanner?'), set('tribes', 'trans')],
  // ---- build
  [w('slim|skinny|thin|lean|minces?|fins?|schlank|dunn'), set('build', 'slim')],
  [w('fit|athletic|toned|sportlich|athletisch|athletiques?'), set('build', 'fit')],
  [w('muscular|muscled|buff|ripped|muscles?|muscules?|muskulos'), set('build', 'muscular')],
  [w('stocky|thick|trapus?|stammig|kraftig'), set('build', 'stocky')],
  [w('chubby|big|large|heavy|forts?|enrobes?|mollig'), set('build', 'large')],
  // ---- orientation
  [w('bi|bisexual|bisexuels?|bisexuell'), set('orientation', 'bi')],
  [w('curious|bi curious|curieux|neugierig'), set('orientation', 'curious')],
  [w('queer'), set('orientation', 'queer')],
  // ---- sport (implies the Sport chip)
  [w('gym(?: buddy| partner| bro)?|workout(?: partner| buddy)?|training partner|lifting|muscu(?:lation)?|salle|fitness(?:studio)?|trainingspartner'), (m, a) => sport(a, 'gym')],
  [w('running|runners?|run|jogging|joggers?|course a pied|courir|laufen|joggen|lauftreff'), (m, a) => sport(a, 'running')],
  [w('cycling|bike|biking|cyclists?|velo|radfahren|rennrad'), (m, a) => sport(a, 'cycling')],
  [w('swimming|swim|swimmers?|natation|nager|schwimmen'), (m, a) => sport(a, 'swimming')],
  [w('climbing|climbers?|bouldering|escalade|grimpe|bloc|klettern|bouldern'), (m, a) => sport(a, 'climbing')],
  [w('football|soccer|foot|fussball'), (m, a) => sport(a, 'football')],
  [w('basketball|basket'), (m, a) => sport(a, 'basketball')],
  [w('volleyball|volley|beach ?volley'), (m, a) => sport(a, 'volleyball')],
  [w('tennis'), (m, a) => sport(a, 'tennis')],
  [w('padel'), (m, a) => sport(a, 'padel')],
  [w('yoga'), (m, a) => sport(a, 'yoga')],
  [w('crossfit'), (m, a) => sport(a, 'crossfit')],
  [w('hiking|hikes?|hikers?|randonnee|rando|wandern|wanderung'), (m, a) => sport(a, 'hiking')],
  [w('skiing|ski|snowboard(?:ing)?|skifahren'), (m, a) => sport(a, 'skiing')],
  [w('martial arts|mma|boxing|boxe|judo|jiu jitsu|bjj|kampfsport|boxen'), (m, a) => sport(a, 'martial_arts')],
  [w('dancing|dance|danse|tanzen'), (m, a) => sport(a, 'dance')],
  [w('rugby'), (m, a) => sport(a, 'rugby')],
  [w('rowing|aviron|rudern'), (m, a) => sport(a, 'rowing')],
  // ---- schedule
  [w('mornings?|early|matin|le matin|morgens|fruh'), set('schedule', 'mornings')],
  [w('lunch(?:time)?|midi|mittags?'), set('schedule', 'lunch')],
  [w('evenings?|after work|soir|le soir|abends|nach der arbeit'), set('schedule', 'evenings')],
  [w('weekends?|week end|wochenende'), set('schedule', 'weekends')],
];

function sport(a: Acc, s: string) {
  add(a, 'sports', s);
  a.intents.add('sport');
}

// Interests: every label in every language, plus a few spoken forms.
const INTEREST_SYNONYMS: Record<string, string> = {
  gaming: 'video_games', gamer: 'video_games', gamers: 'video_games', 'jeux video': 'video_games', zocken: 'video_games',
  'drag race': 'drag_shows', drag: 'drag_shows', clubs: 'clubbing', clubber: 'clubbing', party: 'clubbing', parties: 'clubbing', feiern: 'clubbing',
  movies: 'cinema', films: 'cinema', film: 'cinema', series: 'tv_series', netflix: 'tv_series', serie: 'tv_series',
  dog: 'dogs', chien: 'dogs', hund: 'dogs', cat: 'cats', chatons: 'cats', katze: 'cats',
  reading: 'books', lire: 'books', lesen: 'books', 'board game': 'board_games', 'd d': 'tabletop_rpg', dnd: 'tabletop_rpg',
  travel: 'travelling', voyager: 'travelling', reisen: 'travelling', art: 'art_galleries', kunst: 'art_galleries',
  beer: 'craft_beer', biere: 'craft_beer', bier: 'craft_beer', vegan: 'vegan_food', vegetarian: 'vegan_food',
  pop: 'pop_music', indie: 'indie_music', classical: 'classical_music', classique: 'classical_music', klassik: 'classical_music',
  scifi: 'sci_fi', 'sci fi': 'sci_fi', sf: 'sci_fi', 'star trek': 'sci_fi', 'star wars': 'sci_fi',
  sober: 'sober_life', 'sans alcool': 'sober_life', nuchtern: 'sober_life', concerts: 'live_gigs', gigs: 'live_gigs',
};

let interestIndex: [RegExp, string][] | null = null;
function interestRules(): [RegExp, string][] {
  if (interestIndex) return interestIndex;
  const m = new Map<string, string>();
  for (const dict of Object.values(INTEREST_LABELS))
    for (const [id, label] of Object.entries(dict)) {
      const n = norm(label).trim();
      if (n.length >= 3) m.set(n, id);
      if (n.length >= 4 && n.endsWith('s')) m.set(n.slice(0, -1), id);
    }
  for (const [k, id] of Object.entries(INTEREST_SYNONYMS)) m.set(norm(k).trim(), id);
  // longest phrases first, so "craft beer" wins over "beer"
  // "chat(s)" is French for cats but means talking in English: never an interest by itself.
  for (const k of ['chat', 'chats']) m.delete(k);
  interestIndex = [...m.entries()].sort((a, b) => b[0].length - a[0].length).map(([k, id]) => [new RegExp(` ${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?= )`, 'g'), id]);
  return interestIndex;
}

const STOP = new Set(
  (
    'guys guy men man boys boy dudes people someone somebody anyone who whos that are is be with and or a an the for to me my i im i m looking look want wanna show find get into likes like love loves of some any all just only also very really please who are ' +
    'mecs mec hommes homme gars garcons qui sont est avec et ou un une des les le la l d de du pour moi je cherche veux trouve montre aime aiment adore dans en au aux a ans ' +
    'typen typ manner mann jungs kerle kerl leute die der das den dem mit und oder ein eine einen fur mich ich suche will zeig zeige mag mogen steht stehen auf sind ist in im am zu von bitte jahre alt ' +
    'years old yo km'
  ).split(' '),
);

/** Parses an ask. `known` limits the output to values the server offers (GET /profile-options). */
export function parseAsk(text: string, known?: Record<string, string[]>): AskResult {
  let s = norm(text);
  const a: Acc = { f: {}, intents: new Set(), refused: new Set() };
  const run = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    re.lastIndex = 0;
    s = s.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpMatchArray;
      fn(m);
      return ' ';
    });
  };
  for (const [re, fn] of REFUSALS) run(re, (m) => fn(m, a));
  for (const [re, id] of interestRules()) run(re, () => add(a, 'interests', id));
  for (const [re, fn] of RULES) run(re, (m) => fn(m, a));
  const ignored = s
    .split(' ')
    .filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t));
  const out = sanitize({ filters: a.f, intents: a.intents.size ? [...a.intents] : null, refused: [...a.refused], ignored }, known);
  return out;
}

const LIST_KEYS = ['position', 'hosting', 'tribes', 'build', 'looking_for', 'sports', 'sport_level', 'schedule', 'sport_intent', 'orientation', 'interests'];
const BOOL_KEYS = ['verified_only', 'online_now', 'has_now', 'new_members'];
/** Never filterable, whatever an engine returns (R-04.8, R-24.5). */
const FORBIDDEN = ['hiv', 'prep', 'last_tested', 'ethnicity', 'languages', 'race'];
const MODES: Mode[] = ['hookup', 'friends', 'sport'];

/**
 * Keeps only the Filters sheet schema. Every engine's output passes here (R-24.2, AC-24.2):
 * unknown keys and values dropped, ages 18–99, distance 100 m–300 km, forbidden keys refused.
 */
export function sanitize(r: AskResult, known?: Record<string, string[]>): AskResult {
  const f: Partial<Filters> = {};
  const refused = new Set(r.refused);
  for (const [k, v] of Object.entries(r.filters ?? {})) {
    if (FORBIDDEN.includes(k)) {
      refused.add(k === 'languages' ? 'language' : k === 'ethnicity' || k === 'race' ? 'ethnicity' : 'health');
      continue;
    }
    if (LIST_KEYS.includes(k) && Array.isArray(v)) {
      const ok = known?.[k];
      const vals = [...new Set(v.filter((x): x is string => typeof x === 'string' && (!ok || ok.includes(x))))];
      if (vals.length) f[k] = vals;
    } else if (BOOL_KEYS.includes(k) && typeof v === 'boolean') f[k] = v;
    else if ((k === 'age_min' || k === 'age_max') && typeof v === 'number' && Number.isFinite(v)) f[k] = Math.min(AGE_MAX, Math.max(AGE_MIN, Math.round(v)));
    else if (k === 'distance_max' && typeof v === 'number' && Number.isFinite(v)) f[k] = Math.min(300_000, Math.max(100, Math.round(v)));
  }
  if (typeof f.age_min === 'number' && typeof f.age_max === 'number' && f.age_min > f.age_max) [f.age_min, f.age_max] = [f.age_max, f.age_min];
  const intents = r.intents?.filter((m) => MODES.includes(m)) ?? null;
  return { filters: f, intents: intents && intents.length ? intents : null, refused: [...refused], ignored: r.ignored ?? [] };
}

/** True when the ask produced anything to apply. */
export const askHasFilters = (r: AskResult) => Object.keys(r.filters).length > 0 || !!r.intents;
