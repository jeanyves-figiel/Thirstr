import { getLocales } from 'expo-localization';

// F-24 R-24.10 (#338): Interests labels. IDs come from GET /profile-options (`interest_groups`);
// an ID this build doesn't know shows as its humanised ID. en / fr / de; English is the fallback.
type L = Record<string, string>;

const en: L = {
  techno: 'Techno', house: 'House', pop_music: 'Pop', hip_hop: 'Hip-hop', rock: 'Rock', indie_music: 'Indie', classical_music: 'Classical',
  opera: 'Opera', jazz: 'Jazz', karaoke: 'Karaoke', djing: 'DJing', festivals: 'Festivals',
  clubbing: 'Clubbing', cocktail_bars: 'Cocktail bars', drag_shows: 'Drag shows', ballroom: 'Ballroom', cabaret: 'Cabaret',
  pride_events: 'Pride', eurovision: 'Eurovision', live_gigs: 'Live gigs',
  mountains: 'Mountains', beach: 'Beach', lakes: 'Lake swims', camping: 'Camping', road_trips: 'Road trips', sailing: 'Sailing',
  gardening: 'Gardening', stargazing: 'Stargazing', nature_walks: 'Nature walks',
  video_games: 'Gaming', board_games: 'Board games', tabletop_rpg: 'Tabletop RPG', anime: 'Anime', comics: 'Comics', sci_fi: 'Sci-fi',
  fantasy: 'Fantasy', chess: 'Chess', puzzles: 'Puzzles',
  cinema: 'Cinema', tv_series: 'TV series', reality_tv: 'Reality TV', documentaries: 'Documentaries', horror_films: 'Horror films', podcasts: 'Podcasts',
  cooking: 'Cooking', baking: 'Baking', wine: 'Wine', craft_beer: 'Craft beer', coffee: 'Coffee', brunch: 'Brunch', vegan_food: 'Vegan food',
  street_food: 'Street food', fine_dining: 'Fine dining', bbq: 'BBQ',
  art_galleries: 'Galleries', museums: 'Museums', theatre: 'Theatre', musicals: 'Musicals', photography: 'Photography', books: 'Books',
  poetry: 'Poetry', writing: 'Writing', design: 'Design', fashion: 'Fashion', architecture: 'Architecture', history: 'History',
  tech: 'Tech', coding: 'Coding', science: 'Science', languages_learning: 'Learning languages', philosophy: 'Philosophy', astrology: 'Astrology',
  psychology: 'Psychology',
  travelling: 'Travel', city_breaks: 'City breaks', backpacking: 'Backpacking', gay_cruises: 'Gay cruises', spa_days: 'Spa days',
  dogs: 'Dogs', cats: 'Cats', plants: 'Plants', interior_design: 'Interiors', diy: 'DIY', cars: 'Cars', motorbikes: 'Motorbikes',
  meditation: 'Meditation', healthy_eating: 'Healthy eating', mindfulness: 'Mindfulness', sober_life: 'Sober life',
  lgbtq_activism: 'LGBTQ+ activism', climate: 'Climate', volunteering: 'Volunteering', politics: 'Politics', animal_rights: 'Animal rights',
};

const fr: L = {
  techno: 'Techno', house: 'House', pop_music: 'Pop', hip_hop: 'Hip-hop', rock: 'Rock', indie_music: 'Indé', classical_music: 'Classique',
  opera: 'Opéra', jazz: 'Jazz', karaoke: 'Karaoké', djing: 'Mix / DJ', festivals: 'Festivals',
  clubbing: 'Clubbing', cocktail_bars: 'Bars à cocktails', drag_shows: 'Shows drag', ballroom: 'Ballroom', cabaret: 'Cabaret',
  pride_events: 'Pride', eurovision: 'Eurovision', live_gigs: 'Concerts',
  mountains: 'Montagne', beach: 'Plage', lakes: 'Baignade au lac', camping: 'Camping', road_trips: 'Road trips', sailing: 'Voile',
  gardening: 'Jardinage', stargazing: 'Observer les étoiles', nature_walks: 'Balades nature',
  video_games: 'Jeux vidéo', board_games: 'Jeux de société', tabletop_rpg: 'Jeux de rôle', anime: 'Anime', comics: 'BD / comics', sci_fi: 'SF',
  fantasy: 'Fantasy', chess: 'Échecs', puzzles: 'Puzzles',
  cinema: 'Cinéma', tv_series: 'Séries', reality_tv: 'Téléréalité', documentaries: 'Documentaires', horror_films: 'Films d’horreur', podcasts: 'Podcasts',
  cooking: 'Cuisine', baking: 'Pâtisserie', wine: 'Vin', craft_beer: 'Bière artisanale', coffee: 'Café', brunch: 'Brunch', vegan_food: 'Cuisine vegan',
  street_food: 'Street food', fine_dining: 'Gastronomie', bbq: 'Barbecue',
  art_galleries: 'Galeries', museums: 'Musées', theatre: 'Théâtre', musicals: 'Comédies musicales', photography: 'Photo', books: 'Lecture',
  poetry: 'Poésie', writing: 'Écriture', design: 'Design', fashion: 'Mode', architecture: 'Architecture', history: 'Histoire',
  tech: 'Tech', coding: 'Code', science: 'Sciences', languages_learning: 'Apprendre des langues', philosophy: 'Philo', astrology: 'Astrologie',
  psychology: 'Psycho',
  travelling: 'Voyages', city_breaks: 'City trips', backpacking: 'Sac à dos', gay_cruises: 'Croisières gay', spa_days: 'Spa',
  dogs: 'Chiens', cats: 'Chats', plants: 'Plantes', interior_design: 'Déco', diy: 'Bricolage', cars: 'Voitures', motorbikes: 'Motos',
  meditation: 'Méditation', healthy_eating: 'Manger sain', mindfulness: 'Pleine conscience', sober_life: 'Sobriété',
  lgbtq_activism: 'Militantisme LGBTQ+', climate: 'Climat', volunteering: 'Bénévolat', politics: 'Politique', animal_rights: 'Cause animale',
};

const de: L = {
  techno: 'Techno', house: 'House', pop_music: 'Pop', hip_hop: 'Hip-Hop', rock: 'Rock', indie_music: 'Indie', classical_music: 'Klassik',
  opera: 'Oper', jazz: 'Jazz', karaoke: 'Karaoke', djing: 'Auflegen', festivals: 'Festivals',
  clubbing: 'Clubbing', cocktail_bars: 'Cocktailbars', drag_shows: 'Dragshows', ballroom: 'Ballroom', cabaret: 'Kabarett',
  pride_events: 'Pride', eurovision: 'Eurovision', live_gigs: 'Konzerte',
  mountains: 'Berge', beach: 'Strand', lakes: 'Seebaden', camping: 'Camping', road_trips: 'Roadtrips', sailing: 'Segeln',
  gardening: 'Gärtnern', stargazing: 'Sterne schauen', nature_walks: 'Spaziergänge',
  video_games: 'Gaming', board_games: 'Brettspiele', tabletop_rpg: 'Pen & Paper', anime: 'Anime', comics: 'Comics', sci_fi: 'Sci-Fi',
  fantasy: 'Fantasy', chess: 'Schach', puzzles: 'Rätsel',
  cinema: 'Kino', tv_series: 'Serien', reality_tv: 'Reality-TV', documentaries: 'Dokus', horror_films: 'Horrorfilme', podcasts: 'Podcasts',
  cooking: 'Kochen', baking: 'Backen', wine: 'Wein', craft_beer: 'Craft Beer', coffee: 'Kaffee', brunch: 'Brunch', vegan_food: 'Vegan essen',
  street_food: 'Streetfood', fine_dining: 'Fine Dining', bbq: 'Grillen',
  art_galleries: 'Galerien', museums: 'Museen', theatre: 'Theater', musicals: 'Musicals', photography: 'Fotografie', books: 'Bücher',
  poetry: 'Poesie', writing: 'Schreiben', design: 'Design', fashion: 'Mode', architecture: 'Architektur', history: 'Geschichte',
  tech: 'Tech', coding: 'Programmieren', science: 'Wissenschaft', languages_learning: 'Sprachen lernen', philosophy: 'Philosophie', astrology: 'Astrologie',
  psychology: 'Psychologie',
  travelling: 'Reisen', city_breaks: 'Städtetrips', backpacking: 'Backpacking', gay_cruises: 'Gay-Kreuzfahrten', spa_days: 'Spa-Tage',
  dogs: 'Hunde', cats: 'Katzen', plants: 'Pflanzen', interior_design: 'Einrichten', diy: 'Heimwerken', cars: 'Autos', motorbikes: 'Motorräder',
  meditation: 'Meditation', healthy_eating: 'Gesund essen', mindfulness: 'Achtsamkeit', sober_life: 'Nüchtern leben',
  lgbtq_activism: 'LGBTQ+-Aktivismus', climate: 'Klima', volunteering: 'Ehrenamt', politics: 'Politik', animal_rights: 'Tierschutz',
};

const groupsEn: L = {
  music: 'Music', nights: 'Nights out', outdoors: 'Outdoors', play: 'Games & geek', screen: 'Screen', food: 'Food & drink',
  culture: 'Arts & culture', mind: 'Mind & tech', travel: 'Travel', home: 'Home & pets', wellness: 'Wellness', causes: 'Causes',
};
const groupsFr: L = {
  music: 'Musique', nights: 'Sorties', outdoors: 'Plein air', play: 'Jeux & geek', screen: 'Écrans', food: 'À table',
  culture: 'Arts & culture', mind: 'Esprit & tech', travel: 'Voyage', home: 'Maison & animaux', wellness: 'Bien-être', causes: 'Causes',
};
const groupsDe: L = {
  music: 'Musik', nights: 'Ausgehen', outdoors: 'Draussen', play: 'Spiele & Geek', screen: 'Bildschirm', food: 'Essen & Trinken',
  culture: 'Kunst & Kultur', mind: 'Kopf & Tech', travel: 'Reisen', home: 'Zuhause & Tiere', wellness: 'Wohlbefinden', causes: 'Engagement',
};

export const INTEREST_LABELS = { en, fr, de };
const lang = getLocales()[0]?.languageCode ?? 'en';
const LBL = lang === 'fr' ? fr : lang === 'de' ? de : en;
const GRP = lang === 'fr' ? groupsFr : lang === 'de' ? groupsDe : groupsEn;

export function interestLabel(id: string): string {
  if (LBL[id]) return LBL[id];
  if (en[id]) return en[id];
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const interestGroupLabel = (g: string) => GRP[g] ?? groupsEn[g] ?? g;

const COUNT: Record<string, (n: number, max: number) => string> = {
  en: (n, max) => `${n} of ${max} picked`,
  fr: (n, max) => `${n} sur ${max} choisis`,
  de: (n, max) => `${n} von ${max} gewählt`,
};
export const interestCount = (n: number, max: number) => (COUNT[lang] ?? COUNT.en)(n, max);
