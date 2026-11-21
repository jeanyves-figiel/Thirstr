// The test bot cast (testing.md › Chat test bots, #109, #200). Staging only. Every bot is marked
// 🤖 in its name, its bio starts with "TEST ACCOUNT" (server enforced) and its photos say TEST BOT.
import type { Lang } from './replies';

export type Persona = {
  handle: string;
  name: string;
  age: number;
  gender: 'man' | 'trans_man' | 'non_binary' | 'other';
  here_for: string[];
  show_in: string[];
  lang: Lang;
  fields: Record<string, unknown>;
  /** Account settings (server applies read_receipts / hide_from_unverified only). */
  settings?: Record<string, unknown>;
  /** Where it is. `server` = the server keeps an area cell (Testbot v1, seeded, no photos needed). */
  location: { level: 'area' | 'city' | 'exact' | 'hidden' | 'server'; lat: number; lng: number };
  seeded?: boolean;
  now?: { status: 'now' | 'hosting' | 'can_travel' | 'door_open'; text: string };
  /** Public photos (slot 0 = main). Hue of the generated art. */
  photos: { n: number; hue: number };
  /** Private album shared on "album" (or the Pics? quick reply). */
  album?: { name: string; n: number; hue: number };
  plan?: { tag: 'hosting' | 'can_travel' | 'drinks_first' | 'party' | 'other'; text: string };
  /** Trip (F-20): shows as Visiting in that city while the bot lives elsewhere. */
  trip?: { city: string; days: number };
  party?: { title: string; rules: string[]; capacity: number };
  activity?: { sport: string; title: string; place: string };
  /** Writes first to people who chatted with another bot (once each). */
  icebreaker?: boolean;
};

// Zurich, public places only.
const ALTSTETTEN = { lat: 47.3914, lng: 8.4887 };

export const PERSONAS: Persona[] = [
  {
    handle: 'testbot',
    name: 'Testbot 🤖',
    age: 30,
    gender: 'man',
    here_for: ['hookup', 'tonight', 'chat', 'friends', 'sport'],
    show_in: ['hookup', 'friends', 'sport'],
    lang: 'de',
    fields: { bio: 'Chat test: receipts, typing, translation. Write "help".', languages: ['de', 'pt', 'fr', 'es', 'it', 'en'] },
    location: { level: 'server', ...ALTSTETTEN },
    seeded: true,
    now: { status: 'now', text: 'Test bot · write help' },
    photos: { n: 2, hue: 200 },
  },
  {
    handle: 'luca',
    name: 'Luca 🤖',
    age: 29,
    gender: 'man',
    here_for: ['hookup', 'tonight'],
    show_in: ['hookup'],
    lang: 'it',
    fields: {
      bio: 'Exact pin, 5 photos, private album, photos in chat. Try "album", "photo", "once".',
      languages: ['it', 'en'],
      build: 'fit',
      height_cm: 182,
      position: 'vers',
      hosting: 'can_host',
      looking_for: ['hookup', 'now'],
    },
    location: { level: 'exact', lat: 47.3912, lng: 8.4892 },
    now: { status: 'hosting', text: 'Test bot · can host' },
    photos: { n: 5, hue: 8 },
    album: { name: 'Notte', n: 4, hue: 330 },
  },
  {
    handle: 'tiago',
    name: 'Tiago 🤖',
    age: 34,
    gender: 'man',
    here_for: ['friends', 'chat', 'tonight'],
    show_in: ['friends', 'hookup'],
    lang: 'pt',
    fields: { bio: 'Lives in Lisbon (City level), visiting Zurich this week (trip). Fala comigo!', languages: ['pt', 'en', 'es'], build: 'average', relationship: 'single' },
    location: { level: 'city', lat: 38.7223, lng: -9.1393 },
    trip: { city: 'Zurich', days: 7 },
    photos: { n: 3, hue: 150 },
  },
  {
    handle: 'jonas',
    name: 'Jonas 🤖',
    age: 27,
    gender: 'man',
    here_for: ['sport', 'friends'],
    show_in: ['sport', 'friends'],
    lang: 'de',
    fields: { bio: 'Sport mode: posts a gym session you can join (group chat).', languages: ['de', 'en'], sports: ['gym', 'running'], sport_level: 'intermediate' },
    location: { level: 'area', lat: 47.3826, lng: 8.5043 },
    photos: { n: 2, hue: 95 },
    activity: { sport: 'gym', title: 'Test bot · gym session', place: 'Letzigrund' },
  },
  {
    handle: 'remi',
    name: 'Rémi 🤖',
    age: 38,
    gender: 'man',
    here_for: ['hookup', 'tonight'],
    show_in: ['hookup'],
    lang: 'fr',
    fields: { bio: 'Hosts a party nearby and accepts every request (guest group chat).', languages: ['fr', 'en'], build: 'stocky', hosting: 'can_host' },
    location: { level: 'area', lat: 47.3897, lng: 8.4818 },
    photos: { n: 3, hue: 230 },
    party: { title: 'Test bot · Apéro Altstetten', rules: ['safer', 'no_chems'], capacity: 12 },
  },
  {
    handle: 'kenji',
    name: 'Kenji 🤖',
    age: 25,
    gender: 'non_binary',
    here_for: ['chat', 'friends'],
    show_in: ['hookup', 'friends'],
    lang: 'ja',
    fields: { bio: 'Non-binary, read receipts off (you only see Sent), Tonight plan.', languages: ['ja', 'en'] },
    settings: { read_receipts: false },
    plan: { tag: 'drinks_first', text: 'Test bot · drinks in Kreis 5?' },
    location: { level: 'area', lat: 47.3866, lng: 8.5172 },
    photos: { n: 2, hue: 285 },
  },
  {
    handle: 'ghost',
    name: 'Ghost 🤖',
    age: 31,
    gender: 'man',
    here_for: ['hookup', 'chat'],
    show_in: ['hookup'],
    lang: 'en',
    fields: { bio: 'Hidden location: never on Explore. I write first after you chat with another bot.', languages: ['en'] },
    location: { level: 'hidden', ...ALTSTETTEN },
    photos: { n: 1, hue: 0 },
    icebreaker: true,
  },
];
