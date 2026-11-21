// F-17 R-17.15 (#238): release notes shown once after an update (What's new card) and in
// Settings › About › What's new. Curated by hand from CHANGELOG.md, newest first.
// Rules (checked by __tests__/whats-new.test.ts): ids strictly descending, 2–4 lines,
// title ≤ 24 chars, sub ≤ 44 chars, en + fr + de for every line.
// Add a note only when a build brings something people can see or use.

export type Tone = 'hookup' | 'friends' | 'sport' | 'trust' | 'travel' | 'personal';
export type Glyph = 'moments' | 'flame' | 'check' | 'shield' | 'hand' | 'plane' | 'pin' | 'video' | 'pen' | 'spark';
export type Lang = 'en' | 'fr' | 'de';
/** Where a line opens: a stack route or a tab. */
export type Target = { route: string; params?: object };
export type NoteLine = { tone: Tone; glyph: Glyph; to?: Target; text: Record<Lang, [title: string, sub: string]> };
export type Note = { id: number; date: string; lines: NoteLine[] };

const tab = (screen: string): Target => ({ route: 'Tabs', params: { screen } });

export const NOTES: Note[] = [
  {
    id: 7,
    date: '2026-11-21',
    lines: [
      {
        tone: 'hookup',
        glyph: 'spark',
        to: tab('Me'),
        text: {
          en: ['Share your profile', 'Link and QR for your bio, from Me.'],
          fr: ['Partage ton profil', 'Lien et QR pour ta bio, depuis Moi.'],
          de: ['Teile dein Profil', 'Link und QR für deine Bio, unter Ich.'],
        },
      },
      {
        tone: 'trust',
        glyph: 'shield',
        to: tab('Me'),
        text: {
          en: ['Name and blur only', 'The page shows nothing else, no trackers.'],
          fr: ['Juste prénom et flou', 'Rien d’autre sur la page, sans traceur.'],
          de: ['Nur Name und Unschärfe', 'Die Seite zeigt sonst nichts, ohne Tracker.'],
        },
      },
    ],
  },
  {
    id: 6,
    date: '2026-11-21',
    lines: [
      {
        tone: 'trust',
        glyph: 'shield',
        to: { route: 'Devices' },
        text: {
          en: ['Chats to a new phone', 'Link it, check the code, bring them all.'],
          fr: ['Chats sur un nouveau tél', 'Associe-le, vérifie le code, transfère.'],
          de: ['Chats aufs neue Handy', 'Verknüpfen, Code prüfen, mitnehmen.'],
        },
      },
      {
        tone: 'trust',
        glyph: 'check',
        to: { route: 'ChatBackupSettings' },
        text: {
          en: ['Chat backup', 'Opt-in, sealed by your 12 words.'],
          fr: ['Sauvegarde des chats', 'Au choix, scellée par tes 12 mots.'],
          de: ['Chat-Backup', 'Freiwillig, versiegelt mit 12 Wörtern.'],
        },
      },
    ],
  },
  {
    id: 5,
    date: '2026-11-21',
    lines: [
      {
        tone: 'trust',
        glyph: 'spark',
        to: { route: 'DataSaverSettings' },
        text: {
          en: ['Data saver', 'Lighter on mobile data, on by itself.'],
          fr: ['Économiseur de données', 'Plus léger en 4G/5G, tout seul.'],
          de: ['Datensparmodus', 'Sparsam mit mobilen Daten, automatisch.'],
        },
      },
      {
        tone: 'trust',
        glyph: 'check',
        to: tab('Chats'),
        text: {
          en: ['Big media on tap', 'Large chat photos load when you want.'],
          fr: ['Gros médias au toucher', 'Grandes photos du chat à la demande.'],
          de: ['Große Medien per Tipp', 'Große Chat-Fotos laden auf Wunsch.'],
        },
      },
    ],
  },
  {
    id: 4,
    date: '2026-11-21',
    lines: [
      {
        tone: 'personal',
        glyph: 'pin',
        to: tab('Explore'),
        text: {
          en: ['Favorites on the map', 'Star chip: only favorites or friends.'],
          fr: ['Favoris sur la carte', 'Étoile : seulement favoris ou amis.'],
          de: ['Favoriten auf der Karte', 'Stern: nur Favoriten oder Freunde.'],
        },
      },
      {
        tone: 'friends',
        glyph: 'hand',
        to: tab('Chats'),
        text: {
          en: ['Friends get more', 'Albums, Moments, parties, safety, map.'],
          fr: ['Plus pour les amis', 'Albums, Moments, soirées, sécurité, carte.'],
          de: ['Mehr für Freunde', 'Alben, Moments, Partys, Sicherheit, Karte.'],
        },
      },
    ],
  },
  {
    id: 3,
    date: '2026-11-21',
    lines: [
      {
        tone: 'trust',
        glyph: 'pin',
        to: tab('Explore'),
        text: {
          en: ['Calmer map', 'No more zones. Clubs and saunas on demand.'],
          fr: ['Carte plus claire', 'Plus de zones. Clubs et saunas au choix.'],
          de: ['Ruhigere Karte', 'Keine Zonen mehr. Clubs, Saunas nach Wahl.'],
        },
      },
      {
        tone: 'hookup',
        glyph: 'spark',
        to: tab('Explore'),
        text: {
          en: ['Active now, simpler', 'Pull up for everyone, down for the map.'],
          fr: ['Actifs, plus simple', 'Tire vers le haut : tout le monde.'],
          de: ['Aktiv jetzt, einfacher', 'Hochziehen für alle, runter für die Karte.'],
        },
      },
    ],
  },
  {
    id: 2,
    date: '2026-11-21',
    lines: [
      {
        tone: 'hookup',
        glyph: 'moments',
        to: tab('Explore'),
        text: {
          en: ['Moments', 'Photos that vanish after 1, 6 or 24 h.'],
          fr: ['Moments', 'Des photos éphémères : 1, 6 ou 24 h.'],
          de: ['Moments', 'Fotos, die nach 1, 6 oder 24 h verschwinden.'],
        },
      },
      {
        tone: 'friends',
        glyph: 'flame',
        to: tab('Chats'),
        text: {
          en: ['Chats, redone', 'Your Taps up top, “typing…” in the list.'],
          fr: ['Messages, repensés', 'Tes Taps en haut, « écrit… » dans la liste.'],
          de: ['Chats, neu gemacht', 'Deine Taps oben, „schreibt…“ in der Liste.'],
        },
      },
      {
        tone: 'sport',
        glyph: 'check',
        to: tab('Tonight'),
        text: {
          en: ["I'm in, from Tonight", 'Join a plan or request a seat on the card.'],
          fr: ['Ce soir : « Je viens »', 'Rejoins un plan ou demande une place.'],
          de: ['Heute Nacht: Bin dabei', 'Plan beitreten oder Platz anfragen.'],
        },
      },
      {
        tone: 'trust',
        glyph: 'shield',
        to: { route: 'AccountSettings' },
        text: {
          en: ['Your data, all of it', 'One .zip with your photos and albums.'],
          fr: ['Toutes tes données', 'Un seul .zip avec tes photos et albums.'],
          de: ['Alle deine Daten', 'Ein .zip mit deinen Fotos und Alben.'],
        },
      },
    ],
  },
  {
    id: 1,
    date: '2026-11-21',
    lines: [
      {
        tone: 'personal',
        glyph: 'hand',
        text: {
          en: ['Swipe, tap, hold', 'Gestures everywhere, each with a button.'],
          fr: ['Glisse, tape, maintiens', 'Des gestes partout, chacun avec un bouton.'],
          de: ['Wischen, tippen, halten', 'Gesten überall, jede auch mit Button.'],
        },
      },
      {
        tone: 'travel',
        glyph: 'plane',
        to: { route: 'Trips' },
        text: {
          en: ['Travel plans', 'Look around a city before you go.'],
          fr: ['Voyages', 'Explore une ville avant d’y aller.'],
          de: ['Reisepläne', 'Schau dich in einer Stadt vorher um.'],
        },
      },
      {
        tone: 'trust',
        glyph: 'pin',
        to: { route: 'PrivacySettings' },
        text: {
          en: ['Closer distances', 'Show ~50 m if you want. Off by default.'],
          fr: ['Distances plus précises', 'Affiche ~50 m si tu veux. Désactivé.'],
          de: ['Genauere Distanzen', 'Zeig ~50 m, wenn du willst. Standard aus.'],
        },
      },
    ],
  },
];
